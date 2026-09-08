import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw authError("EMAIL_INVALID");
  return email;
}

export function createAuthService({ repository, mailer, clock = () => new Date(), randomInt = secureCode, secret }) {
  if (!repository || !mailer || !secret) throw new Error("AUTH_SERVICE_CONFIG_INVALID");

  return {
    async requestEmailCode({ email, ip }) {
      const emailNormalized = normalizeEmail(email);
      const now = clock();
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const id = randomUUID();
      const code = String(randomInt(100000, 1000000)).padStart(6, "0").slice(-6);
      const challenge = {
        id,
        emailNormalized,
        ip,
        codeHash: hashCode(secret, id, code),
        expiresAt: new Date(now.getTime() + 10 * MINUTE),
        failedAttempts: 0,
        consumedAt: null,
        deliveryStatus: "pending",
        createdAt: now,
      };
      await repository.reserveChallenge(challenge, { dayStart, cooldownMs: MINUTE, emailLimit: 10, ipLimit: 30 });
      try {
        await mailer.sendCode({ email: emailNormalized, code, expiresInMinutes: 10 });
        await repository.updateChallenge(id, { deliveryStatus: "sent" });
      } catch {
        await repository.updateChallenge(id, { deliveryStatus: "failed", consumedAt: now });
        throw authError("EMAIL_DELIVERY_UNAVAILABLE");
      }
      return { retryAfterSeconds: 60 };
    },

    async verifyEmailCode({ email, code }) {
      const emailNormalized = normalizeEmail(email);
      const now = clock();
      const challenge = await repository.findLatestChallenge(emailNormalized);
      if (!challenge || challenge.failedAttempts >= 5) throw authError("EMAIL_CODE_INVALID");
      if (now > challenge.expiresAt) {
        await repository.updateChallenge(challenge.id, { consumedAt: now });
        throw authError("EMAIL_CODE_EXPIRED");
      }

      const expected = Buffer.from(challenge.codeHash, "hex");
      const actual = Buffer.from(hashCode(secret, challenge.id, String(code || "")), "hex");
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        await repository.recordFailedAttempt(challenge.id, now, 5);
        throw authError("EMAIL_CODE_INVALID");
      }

      const sessionToken = randomBytes(32).toString("hex");
      const user = await repository.consumeChallengeAndCreateSession({
        challengeId: challenge.id,
        emailNormalized,
        consumedAt: now,
        session: {
        id: randomUUID(),
        tokenHash: hashToken(sessionToken),
        expiresAt: new Date(now.getTime() + 7 * DAY),
        absoluteExpiresAt: new Date(now.getTime() + 30 * DAY),
        revokedAt: null,
        createdAt: now,
        },
      });
      if (!user) throw authError("EMAIL_CODE_INVALID");
      return { sessionToken, user: { id: user.id, email: user.emailNormalized } };
    },

    async getSession(sessionToken) {
      if (!sessionToken) return null;
      const now = clock();
      const tokenHash = hashToken(sessionToken);
      const session = await repository.findSessionByHash(tokenHash);
      if (!session || session.revokedAt || now > session.expiresAt || now > session.absoluteExpiresAt) return null;
      const user = await repository.findUserById(session.userId);
      if (!user || user.status !== "active") return null;
      const expiresAt = new Date(Math.min(now.getTime() + 7 * DAY, session.absoluteExpiresAt.getTime()));
      await repository.touchSession(tokenHash, expiresAt);
      return { userId: user.id, email: user.emailNormalized, expiresAt };
    },

    async logout(sessionToken) {
      if (sessionToken) await repository.revokeSession(hashToken(sessionToken), clock());
    },
  };
}

function secureCode(min, max) {
  const range = max - min;
  return min + (randomBytes(4).readUInt32BE(0) % range);
}

function hashCode(secret, id, code) {
  return createHmac("sha256", secret).update(`${id}:${code}`).digest("hex");
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function authError(code) {
  return Object.assign(new Error(code), { code });
}
