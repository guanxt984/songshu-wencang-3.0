import assert from "node:assert/strict";
import test from "node:test";

import { writeWebResponse } from "./api/node-response.js";

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
