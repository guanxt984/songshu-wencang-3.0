import { randomUUID } from "node:crypto";

const WAREHOUSE_COLUMNS = "id, user_id, name, position, schema_version, revision, status, active_ai_job_id, snapshot, created_at, updated_at";
const SAFE_ERROR_CODES = new Set([
  "WAREHOUSE_LIMIT_REACHED",
  "WAREHOUSE_NOT_EMPTY",
  "VALIDATION_FAILED",
  "AUTH_REQUIRED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export function createPostgresWarehouseRepository({ database } = {}) {
  if (!database || typeof database.query !== "function" || typeof database.withTransaction !== "function") {
    throw new TypeError("database with query and withTransaction is required");
  }

  return {
    async listWithOrderRevision(userId) {
      return safe(async () => {
        const result = await database.query(
          `SELECT u.warehouse_order_revision, w.${WAREHOUSE_COLUMNS.replaceAll(", ", ", w.")}
           FROM users u LEFT JOIN warehouses w ON w.user_id = u.id
           WHERE u.id = $1 ORDER BY w.position`,
          [userId],
        );
        if (!result.rows[0]) return { revision: 0, warehouses: [] };
        return {
          revision: number(result.rows[0].warehouse_order_revision),
          warehouses: result.rows.filter((row) => row.id !== null).map(mapWarehouse),
        };
      });
    },

    async list(userId) {
      return safe(async () => {
        const result = await database.query(
          `SELECT ${WAREHOUSE_COLUMNS} FROM warehouses WHERE user_id = $1 ORDER BY position`,
          [userId],
        );
        return result.rows.map(mapWarehouse);
      });
    },

    async get(userId, id) {
      if (!isWarehouseId(id)) return null;
      return safe(async () => {
        const result = await database.query(
          `SELECT ${WAREHOUSE_COLUMNS} FROM warehouses WHERE user_id = $1 AND id = $2`,
          [userId, id],
        );
        return result.rows[0] ? mapWarehouse(result.rows[0]) : null;
      });
    },

    async create(userId, record) {
      return safe(async () => database.withTransaction(async (client) => {
        await lockOwner(client, userId);
        const count = await client.query("SELECT count(*)::integer AS count FROM warehouses WHERE user_id = $1 AND official_template_key IS NULL", [userId]);
        if (number(count.rows[0]?.count) >= 10) throw repositoryError("WAREHOUSE_LIMIT_REACHED");
        const position = await nextPosition(client, userId);
        const inserted = await client.query(
          `INSERT INTO warehouses (user_id, id, name, position, schema_version, revision, status, active_ai_job_id, snapshot, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz, $11::timestamptz)
           RETURNING ${WAREHOUSE_COLUMNS}`,
          warehouseValues(userId, record, position),
        );
        await advanceOrderRevision(client, userId);
        return mapWarehouse(inserted.rows[0]);
      }));
    },

    async updateIfRevision(userId, id, revision, patch) {
      if (!isWarehouseId(id)) return { outcome: "not_found" };
      return safe(async () => database.withTransaction(async (client) => {
        const current = await client.query(
          `SELECT ${WAREHOUSE_COLUMNS} FROM warehouses WHERE user_id = $1 AND id = $2 FOR UPDATE`,
          [userId, id],
        );
        const warehouse = current.rows[0];
        if (!warehouse) return { outcome: "not_found" };
        if (warehouse.status !== "ready") return { outcome: "organizing" };
        if (number(warehouse.revision) !== revision) return { outcome: "conflict" };
        const snapshot = clone(patch.snapshot);
        const updated = await client.query(
          `UPDATE warehouses SET name = $3, schema_version = $4, snapshot = $5::jsonb, updated_at = $6::timestamptz, revision = revision + 1
           WHERE user_id = $1 AND id = $2 RETURNING ${WAREHOUSE_COLUMNS}`,
          [userId, id, warehouseName(snapshot), schemaVersion(snapshot), JSON.stringify(snapshot), patch.updatedAt],
        );
        return { outcome: "updated", warehouse: mapWarehouse(updated.rows[0]) };
      }));
    },

    async deleteReadyIfRevision(userId, id, revision) {
      if (!isWarehouseId(id)) return "not_found";
      return safe(async () => database.withTransaction(async (client) => {
        await lockOwner(client, userId);
        const current = await client.query(
          `SELECT ${WAREHOUSE_COLUMNS} FROM warehouses WHERE user_id = $1 AND id = $2 FOR UPDATE`,
          [userId, id],
        );
        const warehouse = current.rows[0];
        if (!warehouse) return "not_found";
        if (warehouse.status !== "ready") return "organizing";
        if (number(warehouse.revision) !== revision) return "conflict";
        await client.query("SET CONSTRAINTS warehouses_user_id_position_key DEFERRED");
        await client.query("DELETE FROM warehouses WHERE user_id = $1 AND id = $2", [userId, id]);
        await client.query(
          `WITH ordered AS (
             SELECT id, row_number() OVER (ORDER BY position) - 1 AS position
             FROM warehouses WHERE user_id = $1
           )
           UPDATE warehouses SET position = ordered.position FROM ordered
           WHERE warehouses.id = ordered.id AND warehouses.user_id = $1`,
          [userId],
        );
        await advanceOrderRevision(client, userId);
        return "deleted";
      }));
    },

    async getOrderRevision(userId) {
      return safe(async () => {
        const result = await database.query("SELECT warehouse_order_revision FROM users WHERE id = $1", [userId]);
        return result.rows[0] ? number(result.rows[0].warehouse_order_revision) : 0;
      });
    },

    async reorderIfRevision(userId, revision, ids) {
      return safe(async () => database.withTransaction(async (client) => {
        const owner = await lockOwner(client, userId);
        if (number(owner.warehouse_order_revision) !== revision) return { outcome: "conflict" };
        const current = await client.query(
          `SELECT ${WAREHOUSE_COLUMNS} FROM warehouses WHERE user_id = $1 ORDER BY position FOR UPDATE`,
          [userId],
        );
        if (current.rows.some((warehouse) => warehouse.status !== "ready")) return { outcome: "organizing" };
        const currentIds = current.rows.map((warehouse) => warehouse.id);
        if (!sameIdSet(currentIds, ids)) throw repositoryError("VALIDATION_FAILED");
        await client.query("SET CONSTRAINTS warehouses_user_id_position_key DEFERRED");
        await client.query(
          `UPDATE warehouses SET position = source.ordinality - 1
           FROM unnest($2::uuid[]) WITH ORDINALITY AS source(id, ordinality)
           WHERE warehouses.user_id = $1 AND warehouses.id = source.id`,
          [userId, ids],
        );
        const advanced = await advanceOrderRevision(client, userId);
        const ordered = await client.query(
          `SELECT ${WAREHOUSE_COLUMNS} FROM warehouses WHERE user_id = $1 ORDER BY position`,
          [userId],
        );
        return { outcome: "updated", revision: number(advanced.warehouse_order_revision), warehouses: ordered.rows.map(mapWarehouse) };
      }));
    },

    async getImportBatch(userId, idempotencyKey) {
      return safe(async () => {
        const result = await database.query(
          "SELECT source_fingerprint, result FROM import_batches WHERE user_id = $1 AND idempotency_key = $2 AND status = 'succeeded'",
          [userId, idempotencyKey],
        );
        return result.rows[0] ? mapBatch(result.rows[0]) : null;
      });
    },

    async importEmptyBatch(userId, idempotencyKey, fingerprint, records, resultBuilder) {
      return safe(async () => database.withTransaction(async (client) => {
        await lockOwner(client, userId);
        const existing = await client.query(
          "SELECT source_fingerprint, result FROM import_batches WHERE user_id = $1 AND idempotency_key = $2 AND status = 'succeeded' FOR UPDATE",
          [userId, idempotencyKey],
        );
        if (existing.rows[0]) {
          const batch = mapBatch(existing.rows[0]);
          if (batch.fingerprint !== fingerprint) throw repositoryError("VALIDATION_FAILED");
          return batch;
        }
        const count = await client.query("SELECT count(*)::integer AS count FROM warehouses WHERE user_id = $1 AND official_template_key IS NULL", [userId]);
        if (number(count.rows[0]?.count) !== 0) throw repositoryError("WAREHOUSE_NOT_EMPTY");
        if (!Array.isArray(records) || records.length === 0) throw repositoryError("VALIDATION_FAILED");
        if (records.length > 10) throw repositoryError("WAREHOUSE_LIMIT_REACHED");
        const firstPosition = await nextPosition(client, userId);
        const stored = [];
        for (const [offset, record] of records.entries()) {
          const position = firstPosition + offset;
          const inserted = await client.query(
            `INSERT INTO warehouses (user_id, id, name, position, schema_version, revision, status, active_ai_job_id, snapshot, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz, $11::timestamptz)
             RETURNING ${WAREHOUSE_COLUMNS}`,
            warehouseValues(userId, record, position),
          );
          stored.push(mapWarehouse(inserted.rows[0]));
        }
        await advanceOrderRevision(client, userId);
        const result = resultBuilder(clone(stored));
        const insertedBatch = await client.query(
          `INSERT INTO import_batches (user_id, idempotency_key, source_fingerprint, result, status, id, completed_at)
           VALUES ($1, $2, $3, $4::jsonb, 'succeeded', $5, now())
           RETURNING source_fingerprint, result`,
          [userId, idempotencyKey, fingerprint, JSON.stringify(result), randomUUID()],
        );
        return mapBatch(insertedBatch.rows[0]);
      }));
    },
  };
}

async function lockOwner(client, userId) {
  const result = await client.query("SELECT warehouse_order_revision FROM users WHERE id = $1 FOR UPDATE", [userId]);
  if (!result.rows[0]) throw repositoryError("AUTH_REQUIRED");
  return result.rows[0];
}

async function nextPosition(client, userId) {
  const result = await client.query(
    "SELECT COALESCE(max(position) + 1, 0)::integer AS position FROM warehouses WHERE user_id = $1",
    [userId],
  );
  return number(result.rows[0]?.position);
}

async function advanceOrderRevision(client, userId) {
  const result = await client.query(
    "UPDATE users SET warehouse_order_revision = warehouse_order_revision + 1 WHERE id = $1 RETURNING warehouse_order_revision",
    [userId],
  );
  return result.rows[0];
}

function warehouseValues(userId, record, position) {
  const snapshot = clone(record.snapshot);
  return [
    userId, record.id, warehouseName(snapshot), position, schemaVersion(snapshot), record.revision,
    record.status, record.activeAiJobId ?? null, JSON.stringify(snapshot), record.createdAt, record.updatedAt,
  ];
}

function warehouseName(snapshot) {
  return snapshot.name;
}

function schemaVersion(snapshot) {
  return snapshot.schema_version ?? snapshot.schemaVersion ?? 1;
}

function mapWarehouse(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    position: number(row.position),
    schemaVersion: number(row.schema_version),
    revision: number(row.revision),
    status: row.status,
    activeAiJobId: row.active_ai_job_id,
    snapshot: clone(row.snapshot),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function mapBatch(row) {
  return { fingerprint: row.source_fingerprint, result: clone(row.result) };
}

function sameIdSet(currentIds, ids) {
  return Array.isArray(ids) && currentIds.length === ids.length &&
    new Set(ids).size === ids.length && ids.every((id) => currentIds.includes(id));
}

function isWarehouseId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function date(value) {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function number(value) {
  return Number(value || 0);
}

function clone(value) {
  return structuredClone(value);
}

async function safe(work) {
  try {
    return await work();
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

function mapDatabaseError(error) {
  if (error && SAFE_ERROR_CODES.has(error.code)) return error;
  if (error?.code === "23505" || error?.code === "23514") return repositoryError("VALIDATION_FAILED");
  if (error?.code === "23503") return repositoryError("AUTH_REQUIRED");
  if (error?.code === "57014" || isTimeout(error)) return repositoryError("SERVICE_UNAVAILABLE");
  return repositoryError("INTERNAL_ERROR");
}

function isTimeout(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "ETIMEDOUT" || message === "timeout exceeded when trying to connect" ||
    message === "connection terminated due to connection timeout";
}

function repositoryError(code) {
  return Object.assign(new Error(code), { code });
}
