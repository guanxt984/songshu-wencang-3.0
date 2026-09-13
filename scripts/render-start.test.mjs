import assert from 'node:assert/strict';
import test from 'node:test';
const module = await import('./render-start.mjs').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });

test('Render uses its assigned HTTPS origin and a portable verified database certificate', () => {
  assert.equal(typeof module.prepareRenderEnv, 'function');
  const env = module.prepareRenderEnv({ RENDER_EXTERNAL_URL: 'https://squirrel-test.onrender.com',
    DATABASE_URL: 'postgresql://user:password@db.example.test/postgres?sslmode=verify-full&sslrootcert=C%3A%2Fold%2Fsupabase-ca.crt', PORT: '10000' });
  assert.equal(env.APP_ORIGIN, 'https://squirrel-test.onrender.com');
  assert.equal(env.ALLOWED_ORIGINS, env.APP_ORIGIN);
  assert.equal(env.APP_ENV, 'production');
  assert.equal(env.AUTH_PROVIDER, 'github');
  assert.equal(env.HOST, '0.0.0.0');
  const db = new URL(env.DATABASE_URL);
  assert.equal(db.searchParams.get('sslmode'), 'verify-full');
  assert.match(db.searchParams.get('sslrootcert'), /supabase-ca\.crt$/);
  assert.doesNotMatch(db.searchParams.get('sslrootcert'), /old/);
});

test('Render cannot boot with an arbitrary origin or a development database mode', () => {
  assert.equal(typeof module.prepareRenderEnv, 'function');
  for (const APP_ORIGIN of ['http://app.test', 'https://app.test/path', 'https://user:pass@app.test']) {
    assert.throws(() => module.prepareRenderEnv({ APP_ORIGIN, DATABASE_URL: 'postgresql://db/test' }), /RENDER_CONFIG_INVALID/);
  }
});
