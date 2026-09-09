import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createPostgresAuthRepository } from "./postgres-auth-repository.js";
import { createPostgresTestContext } from "./postgres-test-support.js";

const now = new Date("2026-09-09T12:00:00Z");

test("PostgreSQL test context explains missing TEST_DATABASE_URL", async () => {
  await assert.rejects(
    () => createPostgresTestContext({ connectionString: "" }),
    { code: "POSTGRES_TEST_DATABASE_UNAVAILABLE", message: "POSTGRES_TEST_DATABASE_UNAVAILABLE: TEST_DATABASE_URL is required" },
  );
});

test("PostgreSQL test context refuses a database that is not explicitly a test database", async () => {
  let closed = false;
  const database = {
    async query(text) {
      assert.match(text, /SELECT current_database\(\) AS name/);
      return { rows: [{ name: "warehouse_production" }] };
    },
    async close() { closed = true; },
  };
  await assert.rejects(
    () => createPostgresTestContext({ connectionString: "configured-production-connection", databaseFactory: () => database }),
    { code: "POSTGRES_TEST_DATABASE_UNSAFE", message: "POSTGRES_TEST_DATABASE_UNSAFE: database name must end with _test" },
  );
  assert.equal(closed, true);
});

test("PostgreSQL test context truncates only the static application table list", async () => {
  const calls = [];
  const database = {
    async query(text) {
      calls.push(text.replace(/\s+/g, " ").trim());
      if (/current_database/.test(text)) return { rows: [{ name: "warehouse_test" }] };
      return { rows: [] };
    },
    async close() {},
  };
  const context = await createPostgresTestContext({
    connectionString: "configured-test-connection",
    databaseFactory: () => database,
    runMigrations: async () => ({ applied: [] }),
  });
  await context.reset();
  assert.equal(calls.at(-1), "TRUNCATE TABLE account_deletion_jobs, usage_daily, ai_jobs, import_batches, warehouses, sessions, email_challenges, beta_access, users RESTART IDENTITY CASCADE");
  await context.close();
});

test("PostgreSQL authentication repositories preserve atomic auth behavior", async (t) => {
  const first = await openContextOrSkip(t);
  if (!first) return;
  const second = await createPostgresTestContext();
  t.after(async () => { await Promise.all([first.close(), second.close()]); });

  await first.reset();
  const authA = createPostgresAuthRepository({ database: first.database });
  const authB = createPostgresAuthRepository({ database: second.database });

  await t.test("concurrent code requests leave one active challenge", async () => {
    await second.reset();
    const challengeA = challengeFor("concurrent@example.com", "203.0.113.11");
    const challengeB = { ...challengeFor("concurrent@example.com", "203.0.113.11"), id: randomUUID() };
    const results = await Promise.allSettled([
      authA.reserveChallenge(challengeA, limits()),
      authB.reserveChallenge(challengeB, limits()),
    ]);
    assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
    const active = await second.database.query("SELECT count(*)::integer AS count FROM email_challenges WHERE email_normalized = $1 AND consumed_at IS NULL", [challengeA.emailNormalized]);
    assert.equal(Number(active.rows[0].count), 1);
  });

  await t.test("concurrent verification consumes a challenge only once", async () => {
    await second.reset();
    const challenge = challengeFor("verify@example.com", "203.0.113.12");
    await authA.reserveChallenge(challenge, limits());
    const results = await Promise.all([
      authA.consumeChallengeAndCreateSession({ challengeId: challenge.id, emailNormalized: challenge.emailNormalized, consumedAt: now, session: sessionFor(undefined, "verify-a") }),
      authB.consumeChallengeAndCreateSession({ challengeId: challenge.id, emailNormalized: challenge.emailNormalized, consumedAt: now, session: sessionFor(undefined, "verify-b") }),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    const sessions = await second.database.query("SELECT count(*)::integer AS count FROM sessions");
    assert.equal(Number(sessions.rows[0].count), 1);
  });

  await t.test("five concurrent wrong attempts invalidate the challenge", async () => {
    await second.reset();
    const challenge = challengeFor("attempts@example.com", "203.0.113.13");
    await authA.reserveChallenge(challenge, limits());
    await Promise.all(Array.from({ length: 5 }, () => authB.recordFailedAttempt(challenge.id, now, 5)));
    const stored = await second.database.query("SELECT failed_attempts, consumed_at FROM email_challenges WHERE id = $1", [challenge.id]);
    assert.equal(Number(stored.rows[0].failed_attempts), 5);
    assert.notEqual(stored.rows[0].consumed_at, null);
  });

  await t.test("session renewal never exceeds absolute_expires_at", async () => {
    await second.reset();
    const user = await authB.findOrCreateUser("renew@example.com", now);
    const session = sessionFor(user.id, "renew-hash");
    await authB.createSession(session);
    const renewed = await authA.touchSession("renew-hash", new Date(session.absoluteExpiresAt.getTime() + 60_000));
    assert.deepEqual(renewed.expiresAt, session.absoluteExpiresAt);
  });

  await t.test("user and session survive pool recreation", async () => {
    await second.reset();
    const user = await authA.findOrCreateUser("persist@example.com", now);
    await authA.createSession(sessionFor(user.id, "persist-hash"));
    await first.close();
    const persisted = await authB.findSessionByHash("persist-hash");
    assert.equal(persisted.userId, user.id);
    assert.equal((await authB.findUserById(user.id)).emailNormalized, "persist@example.com");
  });
});

async function openContextOrSkip(t) {
  try {
    return await createPostgresTestContext();
  } catch (error) {
    if (error?.code === "POSTGRES_TEST_DATABASE_UNAVAILABLE") {
      t.skip(error.message);
      return null;
    }
    throw error;
  }
}

function limits() {
  return { dayStart: new Date("2026-09-09T00:00:00Z"), cooldownMs: 60_000, emailLimit: 10, ipLimit: 30 };
}

function challengeFor(emailNormalized, ip) {
  return {
    id: randomUUID(), emailNormalized, ip, codeHash: `hash-${randomUUID()}`,
    expiresAt: new Date(now.getTime() + 10 * 60_000), failedAttempts: 0, consumedAt: null,
    deliveryStatus: "sent", createdAt: now,
  };
}

function sessionFor(userId, tokenHash) {
  return {
    id: randomUUID(), userId, tokenHash,
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
    absoluteExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    revokedAt: null, createdAt: now,
  };
}
