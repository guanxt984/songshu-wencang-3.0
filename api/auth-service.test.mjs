import assert from "node:assert/strict";
import test from "node:test";

import { createAuthService, normalizeEmail } from "./auth-service.js";
import { createMemoryAuthRepository } from "./memory-auth-repository.js";

function setup() {
  let now = new Date("2026-09-01T00:00:00.000Z");
  const sent = [];
  const repository = createMemoryAuthRepository();
  const service = createAuthService({
    repository,
    mailer: { sendCode: async (message) => sent.push(message) },
    clock: () => new Date(now),
    randomInt: () => 123456,
    secret: "test-only-secret",
  });
  return { repository, service, sent, advance(ms) { now = new Date(now.getTime() + ms); } };
}

test("normalizeEmail trims and lowercases a valid address", () => {
  assert.equal(normalizeEmail("  User.Name@Example.COM "), "user.name@example.com");
  assert.throws(() => normalizeEmail("not-an-email"), /EMAIL_INVALID/);
});

test("requestEmailCode sends a six digit code while storing only its hash", async () => {
  const { repository, service, sent } = setup();
  const result = await service.requestEmailCode({ email: "USER@example.com", ip: "203.0.113.10" });
  const challenge = repository.inspectChallenges()[0];

  assert.equal(result.retryAfterSeconds, 60);
  assert.equal(sent[0].code, "123456");
  assert.equal(challenge.emailNormalized, "user@example.com");
  assert.equal("code" in challenge, false);
  assert.notEqual(challenge.codeHash, "123456");
});

test("email delivery failure invalidates the challenge and permits an immediate retry", async () => {
  let attempts = 0;
  const repository = createMemoryAuthRepository();
  const service = createAuthService({
    repository,
    mailer: { async sendCode() { attempts += 1; if (attempts === 1) throw new Error("provider down"); } },
    clock: () => new Date("2026-09-01T00:00:00.000Z"),
    randomInt: () => 123456,
    secret: "test-only-secret",
  });

  await assert.rejects(() => service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.10" }), /EMAIL_DELIVERY_UNAVAILABLE/);
  assert.equal(repository.inspectChallenges()[0].deliveryStatus, "failed");
  await service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.10" });
  assert.equal(attempts, 2);
});

test("requestEmailCode enforces cooldown and daily email and IP limits", async () => {
  const { service, advance } = setup();
  await service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.10" });
  await assert.rejects(() => service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.10" }), /EMAIL_CODE_COOLDOWN/);

  for (let index = 1; index < 10; index += 1) {
    advance(60_000);
    await service.requestEmailCode({ email: "a@example.com", ip: `203.0.113.${10 + index}` });
  }
  advance(60_000);
  await assert.rejects(() => service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.99" }), /EMAIL_CODE_DAILY_LIMIT/);

  const second = setup();
  for (let index = 0; index < 30; index += 1) {
    await second.service.requestEmailCode({ email: `u${index}@example.com`, ip: "198.51.100.7" });
  }
  await assert.rejects(() => second.service.requestEmailCode({ email: "overflow@example.com", ip: "198.51.100.7" }), /IP_CODE_DAILY_LIMIT/);
});

test("verifyEmailCode consumes a challenge once and returns only a raw session token", async () => {
  const { repository, service } = setup();
  await service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.10" });
  const result = await service.verifyEmailCode({ email: "a@example.com", code: "123456" });

  assert.match(result.sessionToken, /^[a-f0-9]{64}$/);
  assert.equal(repository.inspectSessions()[0].tokenHash === result.sessionToken, false);
  assert.equal((await service.getSession(result.sessionToken)).email, "a@example.com");
  await assert.rejects(() => service.verifyEmailCode({ email: "a@example.com", code: "123456" }), /EMAIL_CODE_INVALID/);
});

test("verification expires after ten minutes and invalidates after five failures", async () => {
  const expired = setup();
  await expired.service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.10" });
  expired.advance(10 * 60_000 + 1);
  await assert.rejects(() => expired.service.verifyEmailCode({ email: "a@example.com", code: "123456" }), /EMAIL_CODE_EXPIRED/);

  const failed = setup();
  await failed.service.requestEmailCode({ email: "b@example.com", ip: "203.0.113.11" });
  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(() => failed.service.verifyEmailCode({ email: "b@example.com", code: "000000" }), /EMAIL_CODE_INVALID/);
  }
  await assert.rejects(() => failed.service.verifyEmailCode({ email: "b@example.com", code: "123456" }), /EMAIL_CODE_INVALID/);
});

test("issuing a new code permanently invalidates every older active code", async () => {
  let nextCode = 111111;
  const repository = createMemoryAuthRepository();
  let now = new Date("2026-09-01T00:00:00.000Z");
  const service = createAuthService({
    repository,
    mailer: { sendCode: async () => {} },
    clock: () => new Date(now),
    randomInt: () => nextCode,
    secret: "test-only-secret",
  });
  await service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.10" });
  now = new Date(now.getTime() + 60_000);
  nextCode = 222222;
  await service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.10" });
  await service.verifyEmailCode({ email: "a@example.com", code: "222222" });
  await assert.rejects(() => service.verifyEmailCode({ email: "a@example.com", code: "111111" }), /EMAIL_CODE_INVALID/);
});

test("concurrent requests reserve only one active challenge", async () => {
  const { service } = setup();
  const results = await Promise.allSettled([
    service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.10" }),
    service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.10" }),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.match(results.find(({ status }) => status === "rejected").reason.message, /EMAIL_CODE_COOLDOWN/);
});

test("concurrent verification consumes one code exactly once", async () => {
  const { service } = setup();
  await service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.10" });
  const results = await Promise.allSettled([
    service.verifyEmailCode({ email: "a@example.com", code: "123456" }),
    service.verifyEmailCode({ email: "a@example.com", code: "123456" }),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.match(results.find(({ status }) => status === "rejected").reason.message, /EMAIL_CODE_INVALID/);
});

test("concurrent wrong codes atomically reach the five-attempt lockout", async () => {
  const baseRepository = createMemoryAuthRepository();
  const repository = {
    ...baseRepository,
    async findLatestChallenge(email) {
      const challenge = await baseRepository.findLatestChallenge(email);
      return challenge ? structuredClone(challenge) : null;
    },
  };
  const service = createAuthService({
    repository,
    mailer: { sendCode: async () => {} },
    clock: () => new Date("2026-09-01T00:00:00.000Z"),
    randomInt: () => 123456,
    secret: "test-only-secret",
  });
  await service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.10" });
  const results = await Promise.allSettled(Array.from({ length: 5 }, () =>
    service.verifyEmailCode({ email: "a@example.com", code: "000000" })));
  assert.equal(results.every(({ status }) => status === "rejected"), true);
  await assert.rejects(() => service.verifyEmailCode({ email: "a@example.com", code: "123456" }), /EMAIL_CODE_INVALID/);
});

test("sessions renew on activity but never extend beyond thirty days", async () => {
  const { service, advance } = setup();
  await service.requestEmailCode({ email: "a@example.com", ip: "203.0.113.10" });
  const { sessionToken } = await service.verifyEmailCode({ email: "a@example.com", code: "123456" });

  advance(6 * 24 * 60 * 60_000);
  assert.ok(await service.getSession(sessionToken));
  advance(6 * 24 * 60 * 60_000);
  assert.ok(await service.getSession(sessionToken));
  advance(18 * 24 * 60 * 60_000 + 1);
  assert.equal(await service.getSession(sessionToken), null);

  const fresh = setup();
  await fresh.service.requestEmailCode({ email: "b@example.com", ip: "203.0.113.11" });
  const login = await fresh.service.verifyEmailCode({ email: "b@example.com", code: "123456" });
  await fresh.service.logout(login.sessionToken);
  assert.equal(await fresh.service.getSession(login.sessionToken), null);
});
