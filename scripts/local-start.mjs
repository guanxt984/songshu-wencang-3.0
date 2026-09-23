import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresDatabase } from '../api/postgres-database.js';
import { createGithubOAuth } from '../api/github-oauth.js';
import { readProductionConfig } from '../api/production-api.js';
import { runMigrations } from './migrate.js';
import { startServer } from '../server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function prepareLocalEnv(source = process.env) {
  try {
    const port = Number(source.PORT || 5173);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
    for (const key of ['DATABASE_URL', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'AUTH_HASH_SECRET', 'CSRF_TOKEN_SECRET']) {
      if (typeof source[key] !== 'string' || !source[key].trim()) throw new Error();
    }
    const database = new URL(source.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error();
    const origin = `http://127.0.0.1:${port}`;
    return {
      ...source,
      PORT: String(port),
      APP_ENV: 'development',
      AUTH_PROVIDER: 'github',
      LOCAL_DEVELOPMENT_AUTH: 'false',
      HOST: '127.0.0.1',
      APP_ORIGIN: origin,
      ALLOWED_ORIGINS: `${origin},http://localhost:${port}`,
    };
  } catch {
    throw new Error('LOCAL_CONFIG_INVALID');
  }
}

async function main() {
  const env = prepareLocalEnv();
  readProductionConfig(env);
  createGithubOAuth({ env });
  const database = createPostgresDatabase({ connectionString: env.DATABASE_URL });
  try {
    const result = await runMigrations({ database, migrationsDirectory: resolve(root, 'db/migrations') });
    console.log(`Applied ${result.applied.length} migration(s).`);
  } finally {
    await database.close();
  }
  await startServer({ env, root });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('LOCAL_STARTUP_FAILED: configure PostgreSQL and a local GitHub OAuth callback'); process.exitCode = 1; });
}
