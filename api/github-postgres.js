import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { OFFICIAL_WAREHOUSE_SEED_VERSION, officialWarehouseTemplates } from '../example-warehouses.js';

export function createGithubRepository({ database }) {
  return {
    async saveState(stateHash, verifier, expiresAt) {
      await database.query('DELETE FROM github_login_states WHERE expires_at <= now()');
      await database.query('INSERT INTO github_login_states (state_hash, verifier, expires_at) VALUES ($1, $2, $3)', [stateHash, verifier, new Date(expiresAt)]);
    },
    async consumeState(stateHash) {
      const result = await database.query('DELETE FROM github_login_states WHERE state_hash = $1 RETURNING verifier, expires_at > now() AS valid', [stateHash]);
      return result.rows[0]?.valid ? result.rows[0].verifier : null;
    },
    async createLogin({ id, login }) {
      if (!/^[1-9][0-9]*$/.test(id) || !/^[a-zA-Z0-9-]{1,39}$/.test(login)) throw new Error('GITHUB_IDENTITY_INVALID');
      const token = randomBytes(32).toString('hex');
      await database.withTransaction(async client => {
        // The namespace cannot be submitted through email login; never link by an unverified email or mutable login name.
        const result = await client.query(
          `INSERT INTO users (id, email_normalized, github_id, github_login) VALUES ($1, $2, $3, $4)
           ON CONFLICT (github_id) DO UPDATE SET github_login = EXCLUDED.github_login
           RETURNING id, status, official_seed_version`, [randomUUID(), `github:${id}`, id, login]);
        const user = result.rows[0];
        if (user.status !== 'active') throw new Error('AUTH_REQUIRED');
        if (Number(user.official_seed_version || 0) < OFFICIAL_WAREHOUSE_SEED_VERSION) {
          await addOfficialWarehouses(client, user.id);
        }
        await client.query(
          `INSERT INTO sessions (id, user_id, token_hash, expires_at, absolute_expires_at)
           VALUES ($1, $2, $3, now() + interval '7 days', now() + interval '30 days')`,
          [randomUUID(), user.id, createHash('sha256').update(token).digest('hex')]);
      });
      return token;
    },
  };
}

async function addOfficialWarehouses(client, userId) {
  const positionResult = await client.query(
    'SELECT COALESCE(max(position) + 1, 0)::integer AS position FROM warehouses WHERE user_id = $1',
    [userId],
  );
  let position = Number(positionResult.rows[0]?.position || 0);
  let insertedCount = 0;
  const now = new Date();
  for (const template of officialWarehouseTemplates) {
    const result = await client.query(
      `INSERT INTO warehouses (user_id, id, name, official_template_key, position, schema_version, revision, status, active_ai_job_id, snapshot, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, 0, 'ready', NULL, $6::jsonb, $7::timestamptz, $7::timestamptz)
       ON CONFLICT (user_id, official_template_key) WHERE official_template_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [userId, randomUUID(), template.snapshot.name, template.key, position, JSON.stringify(template.snapshot), now],
    );
    if (result.rows.length) {
      position += 1;
      insertedCount += 1;
    }
  }
  await client.query(
    `UPDATE users SET official_seed_version = $2,
       warehouse_order_revision = warehouse_order_revision + $3
     WHERE id = $1`,
    [userId, OFFICIAL_WAREHOUSE_SEED_VERSION, insertedCount],
  );
}
