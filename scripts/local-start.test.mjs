import assert from 'node:assert/strict';
import test from 'node:test';

const module = await import('./local-start.mjs').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

test('local startup uses the same GitHub and PostgreSQL composition as production', () => {
  assert.equal(typeof module.prepareLocalEnv, 'function');
  const env = module.prepareLocalEnv({
    PORT: '5180',
    DATABASE_URL: 'postgresql://user:password@db.example.test/postgres',
    GITHUB_CLIENT_ID: 'local-client',
    GITHUB_CLIENT_SECRET: 'local-secret',
    AUTH_HASH_SECRET: 'hash-secret',
    CSRF_TOKEN_SECRET: 'csrf-secret',
  });

  assert.equal(env.APP_ENV, 'development');
  assert.equal(env.AUTH_PROVIDER, 'github');
  assert.equal(env.LOCAL_DEVELOPMENT_AUTH, 'false');
  assert.equal(env.HOST, '127.0.0.1');
  assert.equal(env.APP_ORIGIN, 'http://127.0.0.1:5180');
  assert.equal(env.ALLOWED_ORIGINS, 'http://127.0.0.1:5180,http://localhost:5180');
});

test('local startup rejects missing GitHub or database configuration before binding a port', () => {
  const complete = {
    PORT: '5180', DATABASE_URL: 'postgresql://db.example.test/app',
    GITHUB_CLIENT_ID: 'client', GITHUB_CLIENT_SECRET: 'secret',
    AUTH_HASH_SECRET: 'hash', CSRF_TOKEN_SECRET: 'csrf',
  };
  for (const missing of ['DATABASE_URL', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'AUTH_HASH_SECRET', 'CSRF_TOKEN_SECRET']) {
    assert.throws(() => module.prepareLocalEnv({ ...complete, [missing]: '' }), /LOCAL_CONFIG_INVALID/);
  }
});
