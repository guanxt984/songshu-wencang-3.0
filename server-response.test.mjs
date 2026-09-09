import assert from "node:assert/strict";
import test from "node:test";

import { writeWebResponse } from "./api/node-response.js";
import { createGracefulShutdown, selectApiComposition } from "./server.mjs";

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
