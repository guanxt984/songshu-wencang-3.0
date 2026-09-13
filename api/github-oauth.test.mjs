import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const module = await import('./github-oauth.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const env = { APP_ENV: 'production', APP_ORIGIN: 'https://app.example.test', GITHUB_CLIENT_ID: 'client', GITHUB_CLIENT_SECRET: 'secret' };
function fixture() {
  assert.equal(typeof module.createGithubOAuth, 'function', 'GitHub login implementation must exist');
  let now = 1_800_000_000_000;
  const states = new Map();
  const logins = [];
  const requests = [];
  let identity = { id: 123, login: 'squirrel' };
  let fail = false;
  const repository = {
    async saveState(key, verifier, expiresAt) { states.set(key, { verifier, expiresAt }); },
    async consumeState(key) {
      const value = states.get(key); states.delete(key);
      return value && value.expiresAt > now ? value.verifier : null;
    },
    async createLogin(profile) { logins.push(profile); return 'app-session'; },
  };
  const oauth = module.createGithubOAuth({ env, repository, clock: () => now, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    if (fail) throw new Error('upstream-secret-token');
    return Response.json(url.endsWith('/access_token') ? { access_token: 'github-secret-token' } : identity);
  } });
  return { oauth, logins, requests, states, expire() { now += 601_000; }, fail() { fail = true; }, identity(value) { identity = value; } };
}
async function begin(f) {
  const response = await f.oauth.handle(new Request(`${env.APP_ORIGIN}/api/auth/github`));
  assert.equal(response.status, 302);
  return { response, url: new URL(response.headers.get('location')), cookie: response.headers.getSetCookie()[0].split(';')[0] };
}
function callback(state, cookie) {
  return new Request(`${env.APP_ORIGIN}/api/auth/github/callback?state=${encodeURIComponent(state)}&code=temporary-code`, { headers: cookie ? { cookie } : {} });
}

test('GitHub login binds a secure browser cookie to one-time state and PKCE', async () => {
  const f = fixture(); const { response, url, cookie } = await begin(f);
  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(url.searchParams.get('scope'), '');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example.test/api/auth/github/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /Secure/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const finished = await f.oauth.handle(callback(url.searchParams.get('state'), cookie));
  assert.equal(finished.status, 302);
  assert.equal(finished.headers.get('location'), '/?login=success');
  assert.match(finished.headers.get('set-cookie'), /nestnote_session=app-session/);
  assert.doesNotMatch(finished.headers.get('set-cookie'), /github-secret-token/);
  assert.deepEqual(f.logins, [{ id: '123', login: 'squirrel' }]);
  const body = new URLSearchParams(f.requests[0].options.body);
  assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), url.searchParams.get('code_challenge'));
  const replay = await f.oauth.handle(callback(url.searchParams.get('state'), cookie));
  assert.equal(replay.headers.get('location'), '/?login=failed');
  assert.equal(f.logins.length, 1);
});

test('GitHub callback rejects missing, mismatched and expired browser state before token exchange', async () => {
  for (const kind of ['missing', 'mismatch', 'expired']) {
    const f = fixture(); const { url, cookie } = await begin(f);
    if (kind === 'expired') f.expire();
    const response = await f.oauth.handle(callback(kind === 'mismatch' ? 'forged' : url.searchParams.get('state'), kind === 'missing' ? '' : cookie));
    assert.equal(response.headers.get('location'), '/?login=failed');
    assert.equal(f.requests.length, 0);
  }
});

test('provider failure and invalid identity never create a session or leak provider details', async () => {
  for (const kind of ['network', 'identity']) {
    const f = fixture(); const { url, cookie } = await begin(f);
    if (kind === 'network') f.fail(); else f.identity({ id: 'untrusted', login: 'name' });
    const response = await f.oauth.handle(callback(url.searchParams.get('state'), cookie));
    assert.equal(response.headers.get('location'), '/?login=failed');
    assert.equal(f.logins.length, 0);
    assert.doesNotMatch(await response.text(), /secret/);
    assert.doesNotMatch(response.headers.get('set-cookie'), /nestnote_session/);
  }
});

test('GitHub configuration requires credentials and an exact HTTPS app origin', () => {
  assert.equal(typeof module.createGithubOAuth, 'function');
  for (const patch of [{ GITHUB_CLIENT_ID: '' }, { GITHUB_CLIENT_SECRET: '' }, { APP_ORIGIN: 'http://app.example.test' }, { APP_ORIGIN: 'https://app.example.test/path' }]) {
    assert.throws(() => module.createGithubOAuth({ env: { ...env, ...patch }, repository: {} }), /GITHUB_CONFIG_INVALID/);
  }
});
