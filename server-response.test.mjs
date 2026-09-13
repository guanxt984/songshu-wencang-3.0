import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pathModule from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { writeWebResponse } from "./api/node-response.js";
import * as serverModule from "./server.mjs";

const { createGracefulShutdown, selectApiComposition } = serverModule;

test('production startup can bind the external interface required by the hosting platform', async () => {
  let receivedHost;
  await serverModule.startConfiguredServer({ composition: { handle: async () => new Response() }, port: 10000,
    host: '0.0.0.0', createApplicationServerFactory: () => ({}),
    listenServer: async (_server, _port, host) => { receivedHost = host; },
    registerGracefulShutdownFactory: () => () => {}, log: () => {},
  });
  assert.equal(receivedHost, '0.0.0.0');
});

test("server preserves the peer socket address on the internal API request", async (t) => {
  let receivedAddress;
  const server = serverModule.createApplicationServer({
    apiHandler: async (request) => {
      receivedAddress = request.socket?.remoteAddress;
      return new Response(null, { status: 204 });
    },
  });
  await listenOnLoopback(server);
  t.after(() => closeServer(server));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/probe`);

  assert.equal(response.status, 204);
  assert.match(receivedAddress, /^(?:::ffff:)?127\.0\.0\.1$/);
});

test("static server keeps the application shell, modules, assets, and SPA routes available", async (t) => {
  const root = await createStaticFixture(t);
  const server = serverModule.createApplicationServer({ apiHandler: async () => new Response("Not found", { status: 404 }), root });
  await listenOnLoopback(server);
  t.after(() => closeServer(server));

  for (const [path, expectedBody] of [
    ["/", "public index"],
    ["/index.html", "public index"],
    ["/styles.css", "public styles"],
    ["/app.js", "public app"],
    ["/auth-flow.js", "public auth"],
    ["/organizer.js", "public organizer"],
    ["/warehouse-management.js", "public warehouse"],
    ["/example-warehouses.js", "public examples"],
    ["/assets/illustrations/logo.png", "public asset"],
    ["/warehouses/example", "public index"],
  ]) {
    const response = await requestServer(server, path);
    assert.equal(response.status, 200, path);
    assert.equal(response.body, expectedBody, path);
  }
});

test("static server denies private workspace files and traversal encodings", async (t) => {
  const root = await createStaticFixture(t);
  const server = serverModule.createApplicationServer({ apiHandler: async () => new Response("Not found", { status: 404 }), root });
  await listenOnLoopback(server);
  t.after(() => closeServer(server));

  for (const path of [
    "/.env",
    "/.env.example",
    "/package.json",
    "/package-lock.json",
    "/api/production-api.js",
    "/server.mjs",
    "/docs/spec.md",
    "/node_modules/pkg/index.js",
    "/../package.json",
    "/%2e%2e/package.json",
    "/assets/%2e%2e/.env",
    "/assets%2f..%2f.env",
    "/assets%5c..%5c.env",
    "/assets/logo.png%00.js",
  ]) {
    const response = await requestServer(server, path);
    assert.equal(response.status, 404, path);
    assert.notEqual(response.body, "private", path);
  }
});

test("legacy development server applies the same public-file boundary", async () => {
  const requestLegacy = await loadLegacyDevelopmentHandler();
  assert.equal((await requestLegacy("/app.js")).status, 200);
  assert.match((await requestLegacy("/warehouses/example")).body, /index\.html$/i);
  for (const path of ["/.env", "/.env.example", "/package.json", "/api/production-api.js", "/server.mjs", "/%2e%2e/package.json", "/assets%5c..%5c.env"]) {
    assert.equal((await requestLegacy(path)).status, 404, path);
  }
});

test("node response forwards multiple set-cookie headers separately", async () => {
  const headers = new Headers();
  headers.append("set-cookie", "session=abc; Path=/; HttpOnly");
  headers.append("set-cookie", "csrf=xyz; Path=/");
  const captured = {};
  const nodeResponse = {
    set statusCode(value) { captured.status = value; },
    setHeader(name, value) { captured[name] = value; },
    end() { captured.ended = true; },
  };
  await writeWebResponse(nodeResponse, new Response("ok", { status: 200, headers }));
  assert.deepEqual(captured["set-cookie"], ["session=abc; Path=/; HttpOnly", "csrf=xyz; Path=/"]);
});

test("server selects production composition before every other mode and fails closed", () => {
  const calls = [];
  const production = (options) => { calls.push(["production", options]); return { handle() {}, close() {} }; };
  const local = (options) => { calls.push(["local", options]); return { handle() {} }; };

  selectApiComposition({
    env: { APP_ENV: "production", LOCAL_DEVELOPMENT_AUTH: "true" },
    mailer: { sendCode() {} },
    createProductionApiFactory: production,
    createLocalDevelopmentApiFactory: local,
  });
  selectApiComposition({
    env: { APP_ENV: "development", DATABASE_URL: "postgresql://database.example.test/app" },
    createProductionApiFactory: production,
    createLocalDevelopmentApiFactory: local,
  });
  selectApiComposition({
    env: { APP_ENV: "development", LOCAL_DEVELOPMENT_AUTH: "true" },
    port: 5180,
    createProductionApiFactory: production,
    createLocalDevelopmentApiFactory: local,
  });

  assert.deepEqual(calls.map(([mode]) => mode), ["production", "production", "local"]);
  assert.deepEqual(calls[2][1], { allowedOrigins: ["http://127.0.0.1:5180", "http://localhost:5180"] });
  assert.throws(() => selectApiComposition({ env: { APP_ENV: "development" } }), { message: "API_CONFIGURATION_INVALID" });
  for (const appEnvironment of [undefined, "", "   "]) {
    const env = { LOCAL_DEVELOPMENT_AUTH: "true" };
    if (appEnvironment !== undefined) env.APP_ENV = appEnvironment;
    assert.throws(() => selectApiComposition({ env }), { message: "API_CONFIGURATION_INVALID" });
  }
});

test("graceful shutdown closes HTTP before persistent resources and exits once", async () => {
  const events = [];
  const shutdown = createGracefulShutdown({
    server: { close(callback) { events.push("server"); callback(); } },
    close: async () => { events.push("composition"); },
    exit: (code) => { events.push(`exit:${code}`); },
  });
  await shutdown();
  await shutdown();
  assert.deepEqual(events, ["server", "composition", "exit:0"]);
});

test("graceful shutdown still releases persistent resources when HTTP close fails", async () => {
  const events = [];
  const shutdown = createGracefulShutdown({
    server: { close(callback) { events.push("server"); callback(new Error("close failed")); } },
    close: async () => { events.push("composition"); },
    exit: (code) => { events.push(`exit:${code}`); },
  });
  await shutdown();
  assert.deepEqual(events, ["server", "composition", "exit:1"]);
});

test("database probe failure closes the composition before any HTTP server listens and stays secret-safe", async () => {
  const events = [];
  await assert.rejects(
    () => serverModule.startConfiguredServer({
      composition: {
        handle() {},
        ready: async () => {
          events.push("probe");
          throw new Error("postgresql://db-user:database-password@db.example.test/app");
        },
        close: async () => { events.push("close"); },
      },
      port: 5173,
      createApplicationServerFactory: () => { events.push("server"); return {}; },
      listenServer: async () => { events.push("listen"); },
      registerGracefulShutdownFactory: () => { events.push("shutdown"); },
      log: () => { events.push("log"); },
    }),
    (error) => {
      assert.equal(error.message, "API_STARTUP_FAILED");
      assert.doesNotMatch(error.message, /database-password|db\.example/);
      return true;
    },
  );
  assert.deepEqual(events, ["probe", "close"]);
});

test("server listens only after the PostgreSQL composition probe succeeds", async () => {
  const events = [];
  const composition = {
    handle() {},
    ready: async () => { events.push("probe"); },
    close: async () => { events.push("close"); },
  };
  const server = {};
  const result = await serverModule.startConfiguredServer({
    composition,
    port: 5173,
    createApplicationServerFactory: () => { events.push("server"); return server; },
    listenServer: async (receivedServer, port) => { events.push(`listen:${port}`); assert.equal(receivedServer, server); },
    registerGracefulShutdownFactory: ({ server: receivedServer, close }) => {
      events.push("shutdown");
      assert.equal(receivedServer, server);
      assert.equal(close, composition.close);
      return "shutdown";
    },
    log: () => { events.push("log"); },
  });
  assert.equal(result.server, server);
  assert.equal(result.composition, composition);
  assert.equal(result.shutdown, "shutdown");
  assert.deepEqual(events, ["probe", "server", "listen:5173", "shutdown", "log"]);
});

function listenOnLoopback(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function createStaticFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "nestnote-static-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ["assets/illustrations", "api", "docs", "node_modules/pkg"]) {
    await mkdir(join(root, directory), { recursive: true });
  }
  for (const [path, content] of [
    ["index.html", "public index"],
    ["styles.css", "public styles"],
    ["app.js", "public app"],
    ["auth-flow.js", "public auth"],
    ["organizer.js", "public organizer"],
    ["warehouse-management.js", "public warehouse"],
    ["example-warehouses.js", "public examples"],
    ["assets/illustrations/logo.png", "public asset"],
    [".env", "private"],
    [".env.example", "private"],
    ["package.json", "private"],
    ["package-lock.json", "private"],
    ["api/production-api.js", "private"],
    ["server.mjs", "private"],
    ["docs/spec.md", "private"],
    ["node_modules/pkg/index.js", "private"],
  ]) await writeFile(join(root, path), content);
  return root;
}

function requestServer(server, path) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port: server.address().port, path }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function loadLegacyDevelopmentHandler() {
  const source = await readFile(new URL("./dev-server.cjs", import.meta.url), "utf8");
  let handler;
  const root = join(tmpdir(), "nestnote-legacy-public");
  const existing = new Set([
    join(root, "index.html"),
    join(root, "app.js"),
    join(root, ".env"),
    join(root, ".env.example"),
    join(root, "package.json"),
    join(root, "api", "production-api.js"),
    join(root, "server.mjs"),
  ]);
  const fakeFs = {
    existsSync: (path) => existing.has(path),
    realpathSync: (path) => path,
    statSync: () => ({ isFile: () => true }),
    createReadStream: (path) => ({ pipe: (response) => response.end(path) }),
  };
  runInNewContext(source, {
    URL,
    console: { log() {} },
    process: { env: { PORT: "0" }, cwd: () => root },
    require(specifier) {
      if (specifier === "fs") return fakeFs;
      if (specifier === "http") return { createServer(received) { handler = received; return { listen(_port, _host, ready) { ready(); } }; } };
      if (specifier === "path") return pathModule;
      throw new Error(`Unexpected require: ${specifier}`);
    },
  });
  return (path) => new Promise((resolve) => {
    const result = { status: 200, body: "" };
    handler({ url: path, headers: { host: "127.0.0.1" } }, {
      writeHead(status) { result.status = status; },
      end(body = "") { result.body = String(body); resolve(result); },
    });
  });
}
