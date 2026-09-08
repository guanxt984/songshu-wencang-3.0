import { randomUUID } from "node:crypto";

const DAY = 24 * 60 * 60_000;
const MAX_TRANSACTION_ATTEMPTS = 3;
const SAFE_ERROR_CODES = new Set([
  "EMAIL_CODE_COOLDOWN",
  "EMAIL_CODE_DAILY_LIMIT",
  "IP_CODE_DAILY_LIMIT",
  "VALIDATION_FAILED",
  "AUTH_REQUIRED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export function createPostgresAuthRepository({ database } = {}) {
  if (!database || typeof database.query !== "function" || typeof database.withTransaction !== "function") {
    throw new TypeError("database with query and withTransaction is required");
  }

  return {
    async reserveChallenge(challenge, limits) {
      return retryTransaction(async () => database.withTransaction(async (client) => {
        await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`email:${challenge.emailNormalized}`]);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 1))", [`ip:${challenge.ip}`]);

        const latest = await client.query(
          "SELECT created_at FROM email_challenges WHERE email_normalized = $1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1",
          [challenge.emailNormalized],
        );
        const latestCreatedAt = latest.rows[0] && date(latest.rows[0].created_at);
        if (latestCreatedAt && challenge.createdAt.getTime() - latestCreatedAt.getTime() < limits.cooldownMs) {
          throw repositoryError("EMAIL_CODE_COOLDOWN");
        }

        const dayEnd = new Date(limits.dayStart.getTime() + DAY);
        const emailCount = await client.query(
          "SELECT count(*)::integer AS count FROM email_challenges WHERE email_normalized = $1 AND delivery_status <> 'failed' AND created_at >= $2::timestamptz AND created_at < $3::timestamptz",
          [challenge.emailNormalized, limits.dayStart, dayEnd],
        );
        if (Number(emailCount.rows[0]?.count || 0) >= limits.emailLimit) throw repositoryError("EMAIL_CODE_DAILY_LIMIT");

        const ipCount = await client.query(
          "SELECT count(*)::integer AS count FROM email_challenges WHERE request_ip = $1::inet AND delivery_status <> 'failed' AND created_at >= $2::timestamptz AND created_at < $3::timestamptz",
          [challenge.ip, limits.dayStart, dayEnd],
        );
        if (Number(ipCount.rows[0]?.count || 0) >= limits.ipLimit) throw repositoryError("IP_CODE_DAILY_LIMIT");

        await client.query(
          "UPDATE email_challenges SET consumed_at = $2::timestamptz WHERE email_normalized = $1 AND consumed_at IS NULL",
          [challenge.emailNormalized, challenge.createdAt],
        );
        const inserted = await client.query(
          "INSERT INTO email_challenges (id, email_normalized, request_ip, code_hash, expires_at, failed_attempts, consumed_at, delivery_status, created_at) VALUES ($1, $2, $3::inet, $4, $5::timestamptz, $6, $7::timestamptz, $8, $9::timestamptz) RETURNING id, email_normalized, request_ip, code_hash, expires_at, failed_attempts, consumed_at, delivery_status, created_at",
          [challenge.id, challenge.emailNormalized, challenge.ip, challenge.codeHash, challenge.expiresAt,
            challenge.failedAttempts, challenge.consumedAt, challenge.deliveryStatus, challenge.createdAt],
        );
        return mapChallenge(inserted.rows[0]);
      }));
    },

    async findLatestChallenge(emailNormalized) {
      return safe(async () => {
        const result = await database.query(
          "SELECT id, email_normalized, request_ip, code_hash, expires_at, failed_attempts, consumed_at, delivery_status, created_at FROM email_challenges WHERE email_normalized = $1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1",
          [emailNormalized],
        );
        return result.rows[0] ? mapChallenge(result.rows[0]) : null;
      });
    },

    async updateChallenge(id, patch) {
      const columns = [];
      const values = [id];
      if (Object.hasOwn(patch, "deliveryStatus")) {
        columns.push(`delivery_status = $${values.length + 1}`);
        values.push(patch.deliveryStatus);
      }
      if (Object.hasOwn(patch, "consumedAt")) {
        columns.push(`consumed_at = $${values.length + 1}::timestamptz`);
        values.push(patch.consumedAt);
      }
      if (columns.length === 0 || Object.keys(patch).some((key) => key !== "deliveryStatus" && key !== "consumedAt")) {
        throw repositoryError("VALIDATION_FAILED");
      }
      return safe(async () => {
        const result = await database.query(
          `UPDATE email_challenges SET ${columns.join(", ")} WHERE id = $1 RETURNING id, email_normalized, request_ip, code_hash, expires_at, failed_attempts, consumed_at, delivery_status, created_at`,
          values,
        );
        return result.rows[0] ? mapChallenge(result.rows[0]) : null;
      });
    },

    async consumeChallengeIfActive(id, consumedAt) {
      return safe(async () => {
        const result = await database.query(
          "UPDATE email_challenges SET consumed_at = $2::timestamptz WHERE id = $1 AND consumed_at IS NULL AND failed_attempts < 5 AND expires_at >= $2::timestamptz RETURNING id",
          [id, consumedAt],
        );
        return result.rows.length > 0;
      });
    },

    async recordFailedAttempt(id, failedAt, maximumAttempts) {
      return safe(async () => {
        const result = await database.query(
          "UPDATE email_challenges SET failed_attempts = failed_attempts + 1, consumed_at = CASE WHEN failed_attempts + 1 >= $3 THEN $2::timestamptz ELSE consumed_at END WHERE id = $1 AND consumed_at IS NULL AND failed_attempts < $3 RETURNING failed_attempts, consumed_at",
          [id, failedAt, maximumAttempts],
        );
        if (!result.rows[0]) return null;
        return { failedAttempts: Number(result.rows[0].failed_attempts), consumed: result.rows[0].consumed_at !== null };
      });
    },

    async findOrCreateUser(emailNormalized, now) {
      return safe(async () => mapActiveUser(await upsertUser(database, emailNormalized, now)));
    },

    async createSession(session) {
      return safe(async () => mapSession(await insertSession(database, session)));
    },

    async touchSession(tokenHash, expiresAt) {
      return safe(async () => {
        const result = await database.query(
          "UPDATE sessions SET expires_at = LEAST($2::timestamptz, absolute_expires_at) WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id, user_id, token_hash, expires_at, absolute_expires_at, revoked_at",
          [tokenHash, expiresAt],
        );
        return result.rows[0] ? mapSession(result.rows[0]) : null;
      });
    },

    async findSessionByHash(tokenHash) {
      return safe(async () => {
        const result = await database.query(
          "SELECT id, user_id, token_hash, expires_at, absolute_expires_at, revoked_at FROM sessions WHERE token_hash = $1",
          [tokenHash],
        );
        return result.rows[0] ? mapSession(result.rows[0]) : null;
      });
    },

    async revokeSession(tokenHash, revokedAt) {
      return safe(async () => {
        await database.query("UPDATE sessions SET revoked_at = $2::timestamptz WHERE token_hash = $1", [tokenHash, revokedAt]);
      });
    },

    async findUserById(id) {
      return safe(async () => {
        const result = await database.query("SELECT id, email_normalized, status, created_at FROM users WHERE id = $1", [id]);
        return result.rows[0] ? mapUser(result.rows[0]) : null;
      });
    },

    async consumeChallengeAndCreateSession({ challengeId, emailNormalized, consumedAt, session }) {
      return safe(async () => database.withTransaction(async (client) => {
        const consumed = await client.query(
          "UPDATE email_challenges SET consumed_at = $2::timestamptz WHERE id = $1 AND consumed_at IS NULL AND email_normalized = $3 AND failed_attempts < 5 AND expires_at >= $2::timestamptz RETURNING id",
          [challengeId, consumedAt, emailNormalized],
        );
        if (!consumed.rows[0]) return null;
        const user = mapActiveUser(await upsertUser(client, emailNormalized, consumedAt));
        await insertSession(client, { ...session, userId: user.id });
        return user;
      }));
    },
  };
}

async function upsertUser(executor, emailNormalized, now) {
  const result = await executor.query(
    "INSERT INTO users (id, email_normalized, status, created_at) VALUES ($1, $2, 'active', $3::timestamptz) ON CONFLICT (email_normalized) DO UPDATE SET email_normalized = EXCLUDED.email_normalized RETURNING id, email_normalized, status, created_at",
    [randomUUID(), emailNormalized, now],
  );
  return result.rows[0];
}

async function insertSession(executor, session) {
  const result = await executor.query(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, absolute_expires_at, revoked_at, created_at) VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz, $7::timestamptz) RETURNING id, user_id, token_hash, expires_at, absolute_expires_at, revoked_at",
    [session.id, session.userId, session.tokenHash, session.expiresAt, session.absoluteExpiresAt, session.revokedAt, session.createdAt],
  );
  return result.rows[0];
}

async function retryTransaction(work) {
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!isRetryable(error) || attempt === MAX_TRANSACTION_ATTEMPTS - 1) throw mapDatabaseError(error);
    }
  }
}

async function safe(work) {
  try {
    return await work();
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

function mapChallenge(row) {
  return {
    id: row.id,
    emailNormalized: row.email_normalized,
    ip: row.request_ip,
    codeHash: row.code_hash,
    expiresAt: date(row.expires_at),
    failedAttempts: Number(row.failed_attempts),
    consumedAt: row.consumed_at === null ? null : date(row.consumed_at),
    deliveryStatus: row.delivery_status,
    createdAt: date(row.created_at),
  };
}

function mapSession(row) {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: date(row.expires_at),
    absoluteExpiresAt: date(row.absolute_expires_at),
    revokedAt: row.revoked_at === null ? null : date(row.revoked_at),
  };
}

function mapUser(row) {
  return { id: row.id, emailNormalized: row.email_normalized, status: row.status, createdAt: date(row.created_at) };
}

function mapActiveUser(row) {
  const user = mapUser(row);
  if (user.status !== "active") throw repositoryError("AUTH_REQUIRED");
  return user;
}

function date(value) {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function isRetryable(error) {
  return error && (error.code === "40001" || error.code === "40P01");
}

function mapDatabaseError(error) {
  if (error && SAFE_ERROR_CODES.has(error.code)) return error;
  if (error?.code === "23505" && error.constraint === "email_challenges_one_active_per_email") return repositoryError("EMAIL_CODE_COOLDOWN");
  if (error?.code === "23514" && error.constraint === "email_challenges_failed_attempts_v2") return repositoryError("VALIDATION_FAILED");
  if (error?.code === "57014" || isRetryable(error)) return repositoryError("SERVICE_UNAVAILABLE");
  return repositoryError("INTERNAL_ERROR");
}

function repositoryError(code) {
  return Object.assign(new Error(code), { code });
}
