import { createHash, randomBytes, randomUUID } from 'node:crypto';

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
           RETURNING id, status`, [randomUUID(), `github:${id}`, id, login]);
        const user = result.rows[0];
        if (user.status !== 'active') throw new Error('AUTH_REQUIRED');
        await client.query(
          `INSERT INTO sessions (id, user_id, token_hash, expires_at, absolute_expires_at)
           VALUES ($1, $2, $3, now() + interval '7 days', now() + interval '30 days')`,
          [randomUUID(), user.id, createHash('sha256').update(token).digest('hex')]);
      });
      return token;
    },
  };
}
