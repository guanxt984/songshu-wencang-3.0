import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');

export function createGithubOAuth({ env = {}, repository, fetchImpl = fetch, clock = Date.now } = {}) {
  const origin = env.APP_ORIGIN;
  try {
    const url = new URL(origin);
    const local = env.APP_ENV === 'development' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.origin !== origin || (!local && url.protocol !== 'https:') ||
      !env.GITHUB_CLIENT_ID?.trim() || !env.GITHUB_CLIENT_SECRET?.trim()) throw new Error();
  } catch { throw new Error('GITHUB_CONFIG_INVALID'); }
  const secure = env.APP_ENV === 'production';
  const callbackUrl = `${origin}/api/auth/github/callback`;
  const stateCookie = (state, maxAge) => `nestnote_oauth=${state}; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  function redirect(location, cookies = []) {
    const headers = new Headers({ location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    for (const value of cookies) headers.append('set-cookie', value);
    return new Response(null, { status: 302, headers });
  }
  async function fetchJson(url, options = {}) {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('GITHUB_UNAVAILABLE');
    return response.json();
  }
  return {
    async handle(request) {
      const url = new URL(request.url);
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });
      try {
        if (url.pathname === '/api/auth/github') {
          const state = randomBytes(32).toString('hex');
          const verifier = randomBytes(32).toString('base64url');
          await repository.saveState(hash(state), verifier, clock() + 600_000);
          const target = new URL('https://github.com/login/oauth/authorize');
          target.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callbackUrl,
            scope: '', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
          return redirect(target.href, [stateCookie(state, 600)]);
        }
        if (url.pathname !== '/api/auth/github/callback') return new Response(null, { status: 404 });
        const state = url.searchParams.get('state') || '';
        const cookie = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('nestnote_oauth='))?.slice('nestnote_oauth='.length) || '';
        if (!/^[a-f0-9]{64}$/.test(state) || cookie.length !== state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) throw new Error();
        const verifier = await repository.consumeState(hash(state));
        const code = url.searchParams.get('code');
        if (!verifier || !code || code.length > 1024 || url.searchParams.has('error')) throw new Error();
        const token = await fetchJson('https://github.com/login/oauth/access_token', {
          method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
            code, redirect_uri: callbackUrl, code_verifier: verifier }).toString(),
        });
        if (typeof token.access_token !== 'string' || !token.access_token || token.error) throw new Error();
        const profile = await fetchJson('https://api.github.com/user', {
          headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'Squirrel-Warehouse' },
        });
        if (!Number.isSafeInteger(profile.id) || profile.id <= 0 || typeof profile.login !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(profile.login)) throw new Error();
        const session = await repository.createLogin({ id: String(profile.id), login: profile.login });
        return redirect('/?login=success', [stateCookie('', 0),
          `nestnote_session=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure ? '; Secure' : ''}`]);
      } catch {
        return redirect('/?login=failed', [stateCookie('', 0)]);
      }
    },
  };
}
