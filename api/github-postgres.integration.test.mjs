import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createPostgresTestContext } from './postgres-test-support.js';
import { createPostgresAuthRepository } from './postgres-auth-repository.js';
import { createAuthService } from './auth-service.js';
import { createProductionApi } from './production-api.js';
import { createApplicationServer } from '../server.mjs';

test('GitHub PostgreSQL identities persist, isolate users, reject blocked users and consume state once', async () => {
  const module = await import('./github-postgres.js').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof module.createGithubRepository, 'function', 'persistent GitHub repository must exist');
  const context = await createPostgresTestContext();
  try {
    await context.reset();
    const repo = module.createGithubRepository({ database: context.database });
    const auth = createAuthService({ repository: createPostgresAuthRepository({ database: context.database }), mailer: {}, secret: 'test-secret' });
    await repo.saveState('a'.repeat(64), 'verifier', Date.now() + 60_000);
    assert.deepEqual((await Promise.all([repo.consumeState('a'.repeat(64)), repo.consumeState('a'.repeat(64))])).sort(), ['verifier', null].sort());
    await repo.saveState('b'.repeat(64), 'expired', Date.now() - 1000);
    assert.equal(await repo.consumeState('b'.repeat(64)), null);
    const firstToken = await repo.createLogin({ id: '123', login: 'first-name' });
    const first = await auth.getSession(firstToken);
    assert.equal(first.displayName, 'first-name');
    const changed = await auth.getSession(await repo.createLogin({ id: '123', login: 'new-name' }));
    assert.equal(changed.userId, first.userId);
    assert.equal(changed.displayName, 'new-name');
    const second = await auth.getSession(await repo.createLogin({ id: '456', login: 'first-name' }));
    assert.notEqual(second.userId, first.userId);
    const tokens = await context.database.query('SELECT token_hash FROM sessions WHERE user_id = $1', [first.userId]);
    assert.ok(tokens.rows.some(row => row.token_hash === createHash('sha256').update(firstToken).digest('hex')));
    await context.database.query("UPDATE users SET status = 'deleted' WHERE id = $1", [first.userId]);
    await assert.rejects(() => repo.createLogin({ id: '123', login: 'new-name' }));
    assert.equal(await auth.getSession(firstToken), null);
    await auth.logout(await repo.createLogin({ id: '456', login: 'second' }));
  } finally { await context.close(); }
});

test('ten GitHub accounts can save concurrently over HTTP and recover isolated data after restart', async () => {
  const { createGithubRepository } = await import('./github-postgres.js');
  const context = await createPostgresTestContext();
  let server; let api;
  try {
    await context.reset();
    const repo = createGithubRepository({ database: context.database });
    server = createApplicationServer({ apiHandler: request => api.handle(request) });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const env = { APP_ENV: 'development', AUTH_PROVIDER: 'github', APP_ORIGIN: origin, ALLOWED_ORIGINS: origin,
      DATABASE_URL: process.env.TEST_DATABASE_URL, AUTH_HASH_SECRET: 'test-secret', CSRF_TOKEN_SECRET: 'test-csrf',
      GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-client-secret' };
    api = createProductionApi({ env });
    const accounts = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
      const token = await repo.createLogin({ id: String(1000 + index), login: `user-${index}` });
      const response = await fetch(origin + '/api/auth/session', { headers: { cookie: `nestnote_session=${token}` } });
      assert.equal(response.status, 200);
      const data = await response.json();
      const headers = { origin, 'content-type': 'application/json', 'x-csrf-token': data.csrfToken,
        cookie: `nestnote_session=${token}; nestnote_csrf=${data.csrfToken}` };
      const snapshot = { schema_version: 1, name: `Account ${index}`, shelves: [], pinecones: [], document: { title: `Account ${index}`, sections: [] } };
      const created = await fetch(origin + '/api/warehouses', { method: 'POST', headers, body: JSON.stringify({ snapshot }) });
      assert.equal(created.status, 201);
      return { headers, warehouse: await created.json(), token, snapshot };
    }));
    await api.close(); api = createProductionApi({ env }); await api.ready();
    await Promise.all(accounts.map(async (account, index) => {
      const response = await fetch(origin + `/api/warehouses/${account.warehouse.id}`, { headers: account.headers });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).snapshot, account.snapshot);
      const other = accounts[(index + 1) % accounts.length];
      assert.equal((await fetch(origin + `/api/warehouses/${other.warehouse.id}`, { headers: account.headers })).status, 404);
      assert.equal((await fetch(origin + '/api/auth/logout', { method: 'POST', headers: account.headers })).status, 204);
      assert.equal((await fetch(origin + '/api/auth/session', { headers: account.headers })).status, 401);
    }));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (api) await api.close();
    await context.reset(); await context.close();
  }
});
