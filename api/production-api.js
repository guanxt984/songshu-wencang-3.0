import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { createAuthService } from "./auth-service.js";
import { createApiHandler } from "./http-handler.js";
import { createPostgresAuthRepository } from "./postgres-auth-repository.js";
import { createPostgresDatabase } from "./postgres-database.js";
import { createPostgresWarehouseRepository } from "./postgres-warehouse-repository.js";
import { createWarehouseService } from "./warehouse-service.js";
import { createGithubOAuth } from "./github-oauth.js";
import { createGithubRepository } from "./github-postgres.js";

const LOCAL_VERIFICATION_CODE = "123456";

export function readProductionConfig(env = {}) {
  const appEnvironment = readAppEnvironment(env.APP_ENV);
  const databaseUrl = required(env.DATABASE_URL);
  const authHashSecret = required(env.AUTH_HASH_SECRET);
  const csrfTokenSecret = required(env.CSRF_TOKEN_SECRET);
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS, { production: appEnvironment === "production" });

  if (!appEnvironment || !databaseUrl || !authHashSecret || !csrfTokenSecret || allowedOrigins.length === 0 ||
    (appEnvironment === "production" && env.LOCAL_DEVELOPMENT_AUTH === "true")) {
    throw configurationError();
  }

  return { appEnvironment, allowedOrigins };
}

export function createProductionApi({ env = {}, PoolClass, mailer } = {}) {
  const config = readProductionConfig(env);
  if (env.AUTH_PROVIDER && !['github', 'email'].includes(env.AUTH_PROVIDER)) throw new Error('PRODUCTION_CONFIG_INVALID');
  const githubMode = env.AUTH_PROVIDER === 'github';
  const developmentVerification = config.appEnvironment === "development";
  const configuredMailer = githubMode ? { sendCode: async () => { throw new Error('EMAIL_DISABLED'); } } : mailer || (developmentVerification ? localDevelopmentMailer : null);
  if (!configuredMailer || typeof configuredMailer.sendCode !== "function") throw new Error("PRODUCTION_MAILER_REQUIRED");

  // Validate OAuth and same-origin routing before opening a database pool.
  if (githubMode) {
    createGithubOAuth({ env });
    if (!config.allowedOrigins.includes(env.APP_ORIGIN)) throw new Error('GITHUB_CONFIG_INVALID');
  }

  const database = createPostgresDatabase({
    connectionString: env.DATABASE_URL,
    ...(PoolClass ? { PoolClass } : {}),
  });
  const authService = createAuthService({
    repository: createPostgresAuthRepository({ database }),
    mailer: configuredMailer,
    secret: env.AUTH_HASH_SECRET,
    ...(developmentVerification && !githubMode ? { randomInt: () => Number(LOCAL_VERIFICATION_CODE) } : {}),
  });
  const warehouseService = createWarehouseService({
    repository: createPostgresWarehouseRepository({ database }),
    idGenerator: () => randomUUID(),
  });

  const github = githubMode ? createGithubOAuth({ env, repository: createGithubRepository({ database }) }) : null;
  const apiHandler = createApiHandler({
      authService,
      warehouseService,
      allowedOrigins: config.allowedOrigins,
      secureCookies: config.appEnvironment === "production",
      resolveClientIp: resolveSocketClientIp,
    });
  return {
    async handle(request) {
      const path = new URL(request.url).pathname;
      let response;
      if (path === '/api/auth/config' && request.method === 'GET') response = Response.json({ provider: githubMode ? 'github' : 'email' });
      else if (path === '/api/health' && request.method === 'GET') {
        try { await database.query('SELECT 1'); response = Response.json({ status: 'ok' }); }
        catch { response = Response.json({ status: 'unavailable' }, { status: 503 }); }
      } else if (github && ['/api/auth/github', '/api/auth/github/callback'].includes(path)) response = await github.handle(request);
      else if (github && ['/api/auth/email-code', '/api/auth/verify'].includes(path)) response = new Response(null, { status: 404 });
      else response = await apiHandler(request);
      response.headers.set('cache-control', 'no-store');
      return response;
    },
    ready: () => database.query("SELECT 1"),
    close: () => database.close(),
  };
}

export function resolveSocketClientIp(request) {
  for (const address of [request?.socket?.remoteAddress, request?.connection?.remoteAddress]) {
    if (typeof address === "string" && isIP(address)) return address;
  }
  return "0.0.0.0";
}

function readAppEnvironment(value) {
  if (typeof value !== "string") return null;
  const environment = value.trim().toLowerCase();
  return environment === "development" || environment === "production" ? environment : null;
}

function required(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseAllowedOrigins(value, { production }) {
  if (typeof value !== "string" || !value.trim()) return [];
  const origins = value.split(",").map((entry) => entry.trim());
  if (origins.some((origin) => !origin || origin.includes("*"))) throw configurationError();
  try {
    const normalized = origins.map((origin) => {
      const url = new URL(origin);
      if (url.origin !== origin || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
        (production && url.protocol !== "https:")) throw configurationError();
      return url.origin;
    });
    if (new Set(normalized).size !== normalized.length) throw configurationError();
    return normalized;
  } catch (error) {
    if (error?.message === "PRODUCTION_CONFIG_INVALID") throw error;
    throw configurationError();
  }
}

const localDevelopmentMailer = { sendCode: async () => {} };

function configurationError() {
  return new Error("PRODUCTION_CONFIG_INVALID");
}
