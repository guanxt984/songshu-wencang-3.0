import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresDatabase } from '../api/postgres-database.js';
import { readProductionConfig } from '../api/production-api.js';
import { createGithubOAuth } from '../api/github-oauth.js';
import { runMigrations } from './migrate.js';
import { startServer } from '../server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function prepareRenderEnv(source = process.env) {
  try {
    const origin = source.APP_ORIGIN || source.RENDER_EXTERNAL_URL;
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error();
    const database = new URL(source.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error();
    database.searchParams.set('sslmode', 'verify-full');
    database.searchParams.set('sslrootcert', resolve(root, 'supabase-ca.crt'));
    return { ...source, APP_ENV: 'production', AUTH_PROVIDER: 'github', LOCAL_DEVELOPMENT_AUTH: 'false',
      HOST: '0.0.0.0', APP_ORIGIN: origin, ALLOWED_ORIGINS: origin, DATABASE_URL: database.href };
  } catch { throw new Error('RENDER_CONFIG_INVALID'); }
}

async function main() {
  const env = prepareRenderEnv();
  readProductionConfig(env);
  createGithubOAuth({ env });
  const database = createPostgresDatabase({ connectionString: env.DATABASE_URL });
  try {
    const result = await runMigrations({ database, migrationsDirectory: resolve(root, 'db/migrations') });
    console.log(`Applied ${result.applied.length} migration(s).`);
  } finally { await database.close(); }
  await startServer({ env, root });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('RENDER_STARTUP_FAILED: check server configuration and database access'); process.exitCode = 1; });
}
