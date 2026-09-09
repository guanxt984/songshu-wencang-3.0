import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalDevelopmentApi } from "./api/local-development.js";
import { writeWebResponse } from "./api/node-response.js";
import { createProductionApi } from "./api/production-api.js";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".ttf": "font/ttf",
};
const PUBLIC_ROOT_FILES = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "auth-flow.js",
  "organizer.js",
  "warehouse-management.js",
  "example-warehouses.js",
]);
const PUBLIC_ASSET_EXTENSIONS = new Set([".png", ".ttf"]);
const PRIVATE_ROUTE_ROOTS = new Set(["api", "contracts", "db", "docs", "node_modules", "scripts", ".superpowers"]);

export function selectApiComposition({
  env = process.env,
  port = 5173,
  mailer,
  createProductionApiFactory = createProductionApi,
  createLocalDevelopmentApiFactory = createLocalDevelopmentApi,
} = {}) {
  const appEnvironment = readAppEnvironment(env.APP_ENV);
  if (!appEnvironment) throw new Error("API_CONFIGURATION_INVALID");
  if (appEnvironment === "production" || env.DATABASE_URL) {
    return createProductionApiFactory({ env, mailer });
  }
  if (appEnvironment === "development" && env.LOCAL_DEVELOPMENT_AUTH === "true") {
    return createLocalDevelopmentApiFactory({
      allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    });
  }
  throw new Error("API_CONFIGURATION_INVALID");
}

export function createApplicationServer({ apiHandler, root = process.cwd() } = {}) {
  if (typeof apiHandler !== "function") throw new TypeError("apiHandler is required");
  const resolvedRoot = realpathSync(resolve(root));
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      try {
        writeWebResponse(response, await apiHandler(await toWebRequest(request)));
      } catch {
        writeWebResponse(response, unavailableResponse());
      }
      return;
    }
    const filePath = resolvePublicFile(resolvedRoot, url.pathname);
    if (!filePath) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

function resolvePublicFile(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.includes("\\") || decoded.includes("\0")) return null;
  const relative = decoded.slice(1);
  const segments = relative ? relative.split("/") : [];
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) return null;

  let publicRelative;
  if (!relative) publicRelative = "index.html";
  else if (PUBLIC_ROOT_FILES.has(relative)) publicRelative = relative;
  else if (segments[0] === "assets" && segments.length > 1 && PUBLIC_ASSET_EXTENSIONS.has(extname(relative).toLowerCase())) {
    publicRelative = relative;
  } else if (!PRIVATE_ROUTE_ROOTS.has(segments[0]) && segments.every((segment) => !extname(segment))) {
    publicRelative = "index.html";
  } else {
    return null;
  }

  const candidate = join(root, ...publicRelative.split("/"));
  if (!existsSync(candidate)) return null;
  try {
    const realCandidate = realpathSync(candidate);
    if (realCandidate !== root && !realCandidate.startsWith(`${root}${sep}`)) return null;
    return statSync(realCandidate).isFile() ? realCandidate : null;
  } catch {
    return null;
  }
}

export function createGracefulShutdown({ server, close, exit = process.exit } = {}) {
  if (!server || typeof server.close !== "function" || typeof close !== "function") throw new TypeError("server and close are required");
  let stopping = false;
  return async function shutdown() {
    if (stopping) return;
    stopping = true;
    let failed = false;
    try {
      await closeServer(server);
    } catch {
      failed = true;
    }
    try {
      await close();
    } catch {
      failed = true;
    }
    exit(failed ? 1 : 0);
  };
}

export function registerGracefulShutdown(options) {
  const shutdown = createGracefulShutdown(options);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return shutdown;
}

export async function startServer({ env = process.env, mailer, root = process.cwd() } = {}) {
  const port = Number(env.PORT || 5173);
  const composition = selectApiComposition({ env, port, mailer });
  return startConfiguredServer({ composition, port, root });
}

export async function startConfiguredServer({
  composition,
  port,
  root = process.cwd(),
  createApplicationServerFactory = createApplicationServer,
  listenServer = listen,
  registerGracefulShutdownFactory = registerGracefulShutdown,
  log = console.log,
} = {}) {
  if (!composition || typeof composition.handle !== "function") throw new Error("API_STARTUP_FAILED");
  try {
    if (typeof composition.ready === "function") await composition.ready();
  } catch {
    await closeQuietly(composition);
    throw new Error("API_STARTUP_FAILED");
  }

  let server;
  try {
    server = createApplicationServerFactory({ apiHandler: composition.handle, root });
    await listenServer(server, port);
  } catch {
    await closeQuietly(composition);
    throw new Error("API_STARTUP_FAILED");
  }
  const shutdown = registerGracefulShutdownFactory({ server, close: composition.close || (async () => {}) });
  log(`Listening on http://127.0.0.1:${port}`);
  return { server, composition, shutdown };
}

async function toWebRequest(request) {
  const bodyChunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error("REQUEST_TOO_LARGE"), { code: "REQUEST_TOO_LARGE" });
    bodyChunks.push(chunk);
  }
  const body = bodyChunks.length ? Buffer.concat(bodyChunks) : undefined;
  const webRequest = new Request(`http://${request.headers.host}${request.url}`, {
    method: request.method,
    headers: request.headers,
    body,
    ...(body ? { duplex: "half" } : {}),
  });
  Object.defineProperties(webRequest, {
    socket: { value: { remoteAddress: request.socket?.remoteAddress } },
    connection: { value: { remoteAddress: request.connection?.remoteAddress } },
  });
  return webRequest;
}

function unavailableResponse() {
  return new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" } }), {
    status: 500,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", resolveListen);
  });
}

function readAppEnvironment(value) {
  if (typeof value !== "string") return null;
  const environment = value.trim().toLowerCase();
  return environment === "development" || environment === "production" ? environment : null;
}

async function closeQuietly(composition) {
  try {
    if (typeof composition.close === "function") await composition.close();
  } catch {
    // Startup failures remain stable and must not expose connection details.
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch(() => {
    console.error("API_CONFIGURATION_INVALID");
    process.exitCode = 1;
  });
}
