import { randomUUID } from "node:crypto";

export function createMemoryAuthRepository() {
  const challenges = [];
  const users = [];
  const sessions = [];

  return {
    reserveChallenge(challenge, { dayStart, cooldownMs, emailLimit, ipLimit }) {
      const countable = challenges.filter((item) => item.deliveryStatus !== "failed");
      const latest = challenges
        .filter((item) => item.emailNormalized === challenge.emailNormalized && !item.consumedAt)
        .sort((left, right) => right.createdAt - left.createdAt)[0];
      if (latest && challenge.createdAt - latest.createdAt < cooldownMs) throw repositoryError("EMAIL_CODE_COOLDOWN");
      if (countable.filter((item) => item.emailNormalized === challenge.emailNormalized && item.createdAt >= dayStart).length >= emailLimit) {
        throw repositoryError("EMAIL_CODE_DAILY_LIMIT");
      }
      if (countable.filter((item) => item.ip === challenge.ip && item.createdAt >= dayStart).length >= ipLimit) {
        throw repositoryError("IP_CODE_DAILY_LIMIT");
      }
      for (const item of challenges) {
        if (item.emailNormalized === challenge.emailNormalized && !item.consumedAt) item.consumedAt = challenge.createdAt;
      }
      challenges.push({ ...challenge });
      return challenge;
    },
    countChallengesByEmailSince(emailNormalized, since) {
      return challenges.filter((item) => item.emailNormalized === emailNormalized && item.createdAt >= since).length;
    },
    countChallengesByIpSince(ip, since) {
      return challenges.filter((item) => item.ip === ip && item.createdAt >= since).length;
    },
    findLatestChallenge(emailNormalized) {
      return challenges
        .filter((item) => item.emailNormalized === emailNormalized && !item.consumedAt)
        .sort((left, right) => right.createdAt - left.createdAt)[0] || null;
    },
    createChallenge(challenge) {
      challenges.push({ ...challenge });
      return challenge;
    },
    updateChallenge(id, patch) {
      const item = challenges.find((candidate) => candidate.id === id);
      if (item) Object.assign(item, patch);
      return item || null;
    },
    consumeChallengeIfActive(id, consumedAt) {
      const item = challenges.find((candidate) => candidate.id === id);
      if (!item || item.consumedAt) return false;
      item.consumedAt = consumedAt;
      return true;
    },
    recordFailedAttempt(id, failedAt, maximumAttempts) {
      const item = challenges.find((candidate) => candidate.id === id);
      if (!item || item.consumedAt) return null;
      item.failedAttempts += 1;
      if (item.failedAttempts >= maximumAttempts) item.consumedAt = failedAt;
      return { failedAttempts: item.failedAttempts, consumed: Boolean(item.consumedAt) };
    },
    findOrCreateUser(emailNormalized, now) {
      let user = users.find((candidate) => candidate.emailNormalized === emailNormalized);
      if (!user) {
        user = { id: randomUUID(), emailNormalized, status: "active", createdAt: now };
        users.push(user);
      }
      return user;
    },
    createSession(session) {
      sessions.push({ ...session });
      return session;
    },
    touchSession(tokenHash, expiresAt) {
      const session = sessions.find((candidate) => candidate.tokenHash === tokenHash);
      if (session) session.expiresAt = expiresAt;
      return session || null;
    },
    findSessionByHash(tokenHash) {
      return sessions.find((candidate) => candidate.tokenHash === tokenHash) || null;
    },
    revokeSession(tokenHash, revokedAt) {
      const session = sessions.find((candidate) => candidate.tokenHash === tokenHash);
      if (session) session.revokedAt = revokedAt;
    },
    findUserById(id) {
      return users.find((candidate) => candidate.id === id) || null;
    },
    inspectChallenges() {
      return structuredClone(challenges);
    },
    inspectSessions() {
      return structuredClone(sessions);
    },
  };
}

function repositoryError(code) {
  return Object.assign(new Error(code), { code });
}
