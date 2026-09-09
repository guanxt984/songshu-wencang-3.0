const { createReadStream, existsSync, realpathSync, statSync } = require("fs");
const { createServer } = require("http");
const { extname, join, resolve, sep } = require("path");

const port = Number(process.env.PORT || 5173);
const root = realpathSync(resolve(process.cwd()));
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".ttf": "font/ttf",
};
const publicRootFiles = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "auth-flow.js",
  "organizer.js",
  "warehouse-management.js",
  "example-warehouses.js",
]);
const publicAssetExtensions = new Set([".png", ".ttf"]);
const privateRouteRoots = new Set(["api", "contracts", "db", "docs", "node_modules", "scripts", ".superpowers"]);

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const filePath = resolvePublicFile(url.pathname);

  if (!filePath) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Listening on http://127.0.0.1:${port}`);
});

function resolvePublicFile(pathname) {
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
  else if (publicRootFiles.has(relative)) publicRelative = relative;
  else if (segments[0] === "assets" && segments.length > 1 && publicAssetExtensions.has(extname(relative).toLowerCase())) {
    publicRelative = relative;
  } else if (!privateRouteRoots.has(segments[0]) && segments.every((segment) => !extname(segment))) {
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
