import { Pool } from "pg";

const defaultPoolOptions = {
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 10_000,
};

export function createPostgresDatabase({ connectionString, poolOptions = {}, PoolClass = Pool, logger = console } = {}) {
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    throw new TypeError("connectionString is required");
  }

  const pool = new PoolClass({
    connectionString,
    max: 5,
    ...poolOptions,
    ...defaultPoolOptions,
  });
  pool.on("error", () => {
    try {
      logger?.error?.("POSTGRES_POOL_ERROR");
    } catch {
      // A logging failure must not turn an already handled background pool error into an uncaught exception.
    }
  });
  let closePromise;

  return {
    query(text, values) {
      return pool.query(text, values);
    },
    async withTransaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close() {
      if (!closePromise) closePromise = pool.end();
      return closePromise;
    },
  };
}
