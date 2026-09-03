import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { createLocalDevelopmentApi } from "./api/local-development.js";
import { writeWebResponse } from "./api/node-response.js";

const port = Number(process.env.PORT || 5173);
const root = process.cwd();
// The local static server deliberately does not emulate production auth.
// A production FC entrypoint must inject PostgreSQL and email adapters.
const isLocalDevelopment = process.env.LOCAL_DEVELOPMENT_AUTH === "true";
const localApi = isLocalDevelopment ? createLocalDevelopmentApi({
  allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
}) : null;
const apiHandler = localApi?.handle || null;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ttf": "font/ttf",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    if (!apiHandler) {
      writeWebResponse(response, new Response(JSON.stringify({ error: { code: "SERVICE_NOT_CONFIGURED", message: "本地认证服务尚未配置" } }), {
        status: 503,
        headers: { "content-type": "application/json; charset=utf-8" },
      }));
      return;
    }
    try {
      writeWebResponse(response, await apiHandler(await toWebRequest(request)));
    } catch {
      writeWebResponse(response, new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" } }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      }));
    }
    return;
  }
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requested));

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(response);
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(port, "127.0.0.1", () => {
  console.log(`Listening on http://127.0.0.1:${port}`);
});

async function toWebRequest(request) {
  const bodyChunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error("REQUEST_TOO_LARGE"), { code: "REQUEST_TOO_LARGE" });
    bodyChunks.push(chunk);
  }
  const body = bodyChunks.length ? Buffer.concat(bodyChunks) : undefined;
  return new Request(`http://${request.headers.host}${request.url}`, {
    method: request.method,
    headers: request.headers,
    body,
    ...(body ? { duplex: "half" } : {}),
  });
}
