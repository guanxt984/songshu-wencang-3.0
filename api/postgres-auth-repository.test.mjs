import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresAuthRepository } from "./postgres-auth-repository.js";

const now = new Date("2026-09-08T12:00:00Z");
const limits = { dayStart: new Date("2026-09-08T00:00:00Z"), cooldownMs: 60_000, emailLimit: 10, ipLimit: 30 };
const challenge = {
  id: "challenge-id", emailNormalized: "a@example.com", ip: "203.0.113.10", codeHash: "code-hash",
  expiresAt: new Date("2026-09-08T12:10:00Z"), failedAttempts: 0, consumedAt: null,
  deliveryStatus: "pending", createdAt: now,
};
const challengeRow = {
  id: "challenge-id", email_normalized: "a@example.com", request_ip: "203.0.113.10", code_hash: "code-hash",
  expires_at: "2026-09-08T12:10:00Z", failed_attempts: 0, consumed_at: null,
  delivery_status: "pending", created_at: "2026-09-08T12:00:00Z",
};
const sessionRow = {
  id: "session-id", user_id: "user-id", token_hash: "hash-value", expires_at: "2026-09-09T00:00:00Z",
  absolute_expires_at: "2026-10-08T00:00:00Z", revoked_at: null,
};
const userRow = { id: "user-id", email_normalized: "a@example.com", status: "active", created_at: now };
const session = {
  id: "session-id", tokenHash: "hash-value", expiresAt: new Date(sessionRow.expires_at),
  absoluteExpiresAt: new Date(sessionRow.absolute_expires_at), revokedAt: null, createdAt: now,
};

function setup(responses = []) {
  const database = {
    calls: [], transactions: 0, commits: 0, rollbacks: 0,
    async query(text, values = []) {
      database.calls.push({ text: text.replace(/\s+/g, " ").trim(), values, inTransaction: false });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return { rows: response || [] };
    },
    async withTransaction(work) {
      database.transactions += 1;
      try {
        const result = await work({ async query(text, values) {
          try { return await database.query(text, values); }
          finally { database.calls.at(-1).inTransaction = true; }
        } });
        database.commits += 1;
        return result;
      } catch (error) { database.rollbacks += 1; throw error; }
    },
  };
  return { database, repository: createPostgresAuthRepository({ database }) };
}

test("session lookup parameterizes the hash and maps nullable timestamps", async () => {
  const { database, repository } = setup([[sessionRow], []]);
  assert.deepEqual(await repository.findSessionByHash("hash-value"), {
    id: "session-id", userId: "user-id", tokenHash: "hash-value",
    expiresAt: new Date("2026-09-09T00:00:00Z"), absoluteExpiresAt: new Date("2026-10-08T00:00:00Z"), revokedAt: null,
  });
  assert.match(database.calls[0].text, /WHERE token_hash = \$1/);
  assert.deepEqual(database.calls[0].values, ["hash-value"]);
  assert.equal(await repository.findSessionByHash("missing"), null);
});

test("latest challenge lookup excludes consumed rows and maps the complete challenge", async () => {
  const { database, repository } = setup([[challengeRow], []]);
  assert.deepEqual(await repository.findLatestChallenge("a@example.com"), challenge);
  assert.match(database.calls[0].text, /WHERE email_normalized = \$1 AND consumed_at IS NULL ORDER BY created_at DESC/);
  assert.deepEqual(database.calls[0].values, ["a@example.com"]);
  assert.equal(await repository.findLatestChallenge("missing@example.com"), null);
});

test("reservation locks email and IP in a serializable transaction before checking quotas and inserting", async () => {
  const { database, repository } = setup([[], [], [], [], [{ count: "9" }], [{ count: "29" }], [], [challengeRow]]);
  assert.deepEqual(await repository.reserveChallenge(challenge, limits), challenge);
  assert.equal(database.transactions, 1);
  assert.equal(database.commits, 1);
  assert.ok(database.calls.every((call) => call.inTransaction));
  assert.match(database.calls[0].text, /SET TRANSACTION ISOLATION LEVEL SERIALIZABLE/);
  assert.match(database.calls[1].text, /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/);
  assert.deepEqual(database.calls[1].values, ["email:a@example.com"]);
  assert.match(database.calls[2].text, /pg_advisory_xact_lock\(hashtextextended\(\$1, 1\)\)/);
  assert.deepEqual(database.calls[2].values, ["ip:203.0.113.10"]);
  for (const index of [4, 5]) {
    assert.match(database.calls[index].text, /delivery_status <> 'failed'/);
    assert.match(database.calls[index].text, /created_at >= \$2::timestamptz AND created_at < \$3::timestamptz/);
    assert.deepEqual(database.calls[index].values.slice(1), [limits.dayStart, new Date("2026-09-09T00:00:00Z")]);
  }
  assert.match(database.calls[4].text, /email_normalized = \$1/);
  assert.match(database.calls[5].text, /request_ip = \$1::inet/);
  assert.match(database.calls[6].text, /UPDATE email_challenges SET consumed_at = \$2::timestamptz WHERE email_normalized = \$1 AND consumed_at IS NULL/);
  assert.deepEqual(database.calls[6].values, ["a@example.com", now]);
  assert.match(database.calls[7].text, /INSERT INTO email_challenges/);
  assert.deepEqual(database.calls[7].values, [challenge.id, challenge.emailNormalized, challenge.ip, challenge.codeHash,
    challenge.expiresAt, 0, null, "pending", now]);
});

for (const [name, rows, code] of [
  ["cooldown", [[{ ...challengeRow, created_at: new Date(now - 59_999) }]], "EMAIL_CODE_COOLDOWN"],
  ["email daily limit", [[], [{ count: "10" }]], "EMAIL_CODE_DAILY_LIMIT"],
  ["IP daily limit", [[], [{ count: "0" }], [{ count: "30" }]], "IP_CODE_DAILY_LIMIT"],
]) {
  test(`reservation rejects ${name} before invalidating or creating challenges`, async () => {
    const { database, repository } = setup([[], [], [], ...rows]);
    await assert.rejects(repository.reserveChallenge(challenge, limits), { code });
    assert.equal(database.transactions, 1);
    assert.equal(database.rollbacks, 1);
    assert.ok(database.calls.every(({ text }) => !/INSERT|UPDATE/.test(text)));
  });
}

test("reservation permits the exact cooldown boundary", async () => {
  const { repository } = setup([[], [], [], [{ ...challengeRow, created_at: new Date(now - 60_000) }],
    [{ count: "0" }], [{ count: "0" }], [], [challengeRow]]);
  assert.deepEqual(await repository.reserveChallenge(challenge, limits), challenge);
});

test("reservation retries a serialization failure with a fresh transaction", async () => {
  const conflict = Object.assign(new Error("serialization details"), { code: "40001" });
  const { database, repository } = setup([conflict, [], [], [], [], [{ count: "0" }], [{ count: "0" }], [], [challengeRow]]);
  assert.deepEqual(await repository.reserveChallenge(challenge, limits), challenge);
  assert.equal(database.transactions, 2);
  assert.equal(database.rollbacks, 1);
});

test("reservation bounds deadlock retries and strips database details", async () => {
  const conflict = Object.assign(new Error("sensitive deadlock details"), { code: "40P01" });
  const { database, repository } = setup([conflict, conflict, conflict]);
  await assert.rejects(repository.reserveChallenge(challenge, limits), { code: "SERVICE_UNAVAILABLE", message: "SERVICE_UNAVAILABLE" });
  assert.equal(database.transactions, 3);
});

for (const [driverCode, constraint, expected] of [
  ["23505", "email_challenges_one_active_per_email", "EMAIL_CODE_COOLDOWN"],
  ["23514", "email_challenges_failed_attempts_v2", "VALIDATION_FAILED"],
  ["23505", "email_challenges_pkey", "INTERNAL_ERROR"],
  ["57014", undefined, "SERVICE_UNAVAILABLE"],
]) {
  test(`reservation maps ${driverCode}/${constraint} to a safe stable error`, async () => {
    const error = Object.assign(new Error("SQL and credentials"), { code: driverCode, constraint });
    const { repository } = setup([[], [], [], [], [{ count: "0" }], [{ count: "0" }], [], error]);
    await assert.rejects(repository.reserveChallenge(challenge, limits), { code: expected, message: expected });
  });
}

test("delivery updates parameterize fields and preserve omitted values", async () => {
  const { database, repository } = setup([[{ ...challengeRow, delivery_status: "failed", consumed_at: now }], [challengeRow]]);
  const updated = await repository.updateChallenge("challenge-id", { deliveryStatus: "failed", consumedAt: now });
  assert.equal(updated.deliveryStatus, "failed");
  assert.deepEqual(updated.consumedAt, now);
  assert.deepEqual(database.calls[0].values, ["challenge-id", "failed", now]);
  await repository.updateChallenge("challenge-id", { deliveryStatus: "sent" });
  assert.doesNotMatch(database.calls[1].text.split("RETURNING")[0], /consumed_at =/);
  assert.deepEqual(database.calls[1].values, ["challenge-id", "sent"]);
  await assert.rejects(repository.updateChallenge("challenge-id", { "delivery_status = 'sent'; --": "bad" }), { code: "VALIDATION_FAILED" });
});

test("consumption uses one conditional update with expiry and attempt guards", async () => {
  const { database, repository } = setup([[{ id: "challenge-id" }], []]);
  assert.equal(await repository.consumeChallengeIfActive("challenge-id", now), true);
  assert.equal(await repository.consumeChallengeIfActive("challenge-id", now), false);
  assert.equal(database.transactions, 0);
  assert.match(database.calls[0].text, /UPDATE email_challenges SET consumed_at = \$2::timestamptz WHERE id = \$1 AND consumed_at IS NULL AND failed_attempts < 5 AND expires_at >= \$2::timestamptz RETURNING/);
  assert.deepEqual(database.calls[0].values, ["challenge-id", now]);
});

test("failed attempts increment atomically and consume the fifth failure without exceeding the cap", async () => {
  const { database, repository } = setup([[{ failed_attempts: 5, consumed_at: now }], [], [{ failed_attempts: 1, consumed_at: null }]]);
  assert.deepEqual(await repository.recordFailedAttempt("challenge-id", now, 5), { failedAttempts: 5, consumed: true });
  assert.equal(await repository.recordFailedAttempt("challenge-id", now, 5), null);
  assert.deepEqual(await repository.recordFailedAttempt("challenge-id", now, 5), { failedAttempts: 1, consumed: false });
  assert.equal(database.transactions, 0);
  assert.match(database.calls[0].text, /failed_attempts = failed_attempts \+ 1/);
  assert.match(database.calls[0].text, /CASE WHEN failed_attempts \+ 1 >= \$3 THEN \$2::timestamptz ELSE consumed_at END/);
  assert.match(database.calls[0].text, /WHERE id = \$1 AND consumed_at IS NULL AND failed_attempts < \$3/);
  assert.deepEqual(database.calls[0].values, ["challenge-id", now, 5]);
});

test("user upsert resolves email conflicts and rejects inactive users", async () => {
  const { database, repository } = setup([[userRow], [{ ...userRow, status: "deleting" }], [{ ...userRow, status: "deleted" }]]);
  assert.deepEqual(await repository.findOrCreateUser("a@example.com", now), {
    id: "user-id", emailNormalized: "a@example.com", status: "active", createdAt: now,
  });
  assert.match(database.calls[0].text, /ON CONFLICT \(email_normalized\) DO UPDATE SET email_normalized = EXCLUDED.email_normalized RETURNING/);
  assert.match(database.calls[0].values[0], /^[a-f0-9-]{36}$/);
  assert.deepEqual(database.calls[0].values.slice(1), ["a@example.com", now]);
  await assert.rejects(repository.findOrCreateUser("a@example.com", now), { code: "AUTH_REQUIRED" });
  await assert.rejects(repository.findOrCreateUser("a@example.com", now), { code: "AUTH_REQUIRED" });
});

test("user lookup parameterizes the ID and returns null for a missing user", async () => {
  const { database, repository } = setup([[userRow], []]);
  assert.equal((await repository.findUserById("user-id")).emailNormalized, "a@example.com");
  assert.match(database.calls[0].text, /WHERE id = \$1/);
  assert.deepEqual(database.calls[0].values, ["user-id"]);
  assert.equal(await repository.findUserById("missing"), null);
});

test("session writes parameterize values and renewal respects revocation and the absolute deadline", async () => {
  const { database, repository } = setup([[sessionRow], [sessionRow], []]);
  assert.equal((await repository.createSession({ ...session, userId: "user-id" })).tokenHash, "hash-value");
  assert.deepEqual(database.calls[0].values, ["session-id", "user-id", "hash-value", session.expiresAt,
    session.absoluteExpiresAt, null, now]);
  assert.equal((await repository.touchSession("hash-value", session.expiresAt)).id, "session-id");
  assert.match(database.calls[1].text, /LEAST\(\$2::timestamptz, absolute_expires_at\)/);
  assert.match(database.calls[1].text, /WHERE token_hash = \$1 AND revoked_at IS NULL/);
  assert.deepEqual(database.calls[1].values, ["hash-value", session.expiresAt]);
  await repository.revokeSession("hash-value", now);
  assert.match(database.calls[2].text, /SET revoked_at = \$2::timestamptz WHERE token_hash = \$1/);
  assert.deepEqual(database.calls[2].values, ["hash-value", now]);
});

test("atomic login consumes, upserts the active user, and creates the session in one transaction", async () => {
  const { database, repository } = setup([[{ id: "challenge-id" }], [userRow], [sessionRow]]);
  const user = await repository.consumeChallengeAndCreateSession({ challengeId: "challenge-id", emailNormalized: "a@example.com", consumedAt: now, session });
  assert.equal(user.id, "user-id");
  assert.equal(database.transactions, 1);
  assert.equal(database.commits, 1);
  assert.ok(database.calls.every((call) => call.inTransaction));
  assert.match(database.calls[0].text, /AND email_normalized = \$3/);
  assert.deepEqual(database.calls[0].values, ["challenge-id", now, "a@example.com"]);
  assert.match(database.calls[1].text, /INSERT INTO users/);
  assert.match(database.calls[2].text, /INSERT INTO sessions/);
  assert.equal(database.calls[2].values[1], "user-id");
});

test("atomic login stops when the challenge is no longer active", async () => {
  const { database, repository } = setup([[]]);
  assert.equal(await repository.consumeChallengeAndCreateSession({ challengeId: "challenge-id", emailNormalized: "a@example.com", consumedAt: now, session }), null);
  assert.equal(database.calls.length, 1);
});

for (const failure of ["inactive user", "session insert"]) {
  test(`atomic login rolls back challenge consumption on ${failure} failure`, async () => {
    const responses = failure === "inactive user"
      ? [[{ id: "challenge-id" }], [{ ...userRow, status: "deleted" }]]
      : [[{ id: "challenge-id" }], [userRow], new Error("sensitive database failure")];
    const { database, repository } = setup(responses);
    const code = failure === "inactive user" ? "AUTH_REQUIRED" : "INTERNAL_ERROR";
    await assert.rejects(repository.consumeChallengeAndCreateSession({ challengeId: "challenge-id", emailNormalized: "a@example.com", consumedAt: now, session }), { code, message: code });
    assert.equal(database.rollbacks, 1);
    assert.equal(database.commits, 0);
  });
}
