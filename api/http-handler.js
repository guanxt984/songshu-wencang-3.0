import { randomBytes } from "node:crypto";

const MAX_BODY_BYTES = 1024 * 1024;
const ERROR_STATUS = {
  EMAIL_INVALID: 422,
  EMAIL_CODE_COOLDOWN: 429,
  EMAIL_CODE_DAILY_LIMIT: 429,
  IP_CODE_DAILY_LIMIT: 429,
  EMAIL_CODE_INVALID: 422,
  EMAIL_CODE_EXPIRED: 422,
  EMAIL_DELIVERY_UNAVAILABLE: 503,
  AUTH_REQUIRED: 401,
  ORIGIN_INVALID: 403,
  CSRF_INVALID: 403,
  REQUEST_TOO_LARGE: 413,
  VALIDATION_FAILED: 422,
  WAREHOUSE_NOT_FOUND: 404,
  WAREHOUSE_NOT_EMPTY: 409,
  WAREHOUSE_LIMIT_REACHED: 409,
  WAREHOUSE_ORGANIZING: 409,
  REVISION_CONFLICT: 409,
};
const PUBLIC_ERROR_CODES = new Set(Object.keys(ERROR_STATUS));

export function createApiHandler({ authService, warehouseService, allowedOrigins = [], secureCookies = true, sessionCookieName = "nestnote_session", resolveClientIp = () => "unknown" }) {
  const trustedOrigins = new Set(allowedOrigins);

  return async function handle(request) {
    try {
      const url = new URL(request.url);
      const route = `${request.method} ${url.pathname}`;
      if (request.method !== "GET" && !trustedOrigins.has(request.headers.get("origin"))) {
        return errorResponse("ORIGIN_INVALID");
      }

      if (route === "POST /api/auth/email-code") {
        const body = await readJson(request);
        const result = await authService.requestEmailCode({ email: body.email, ip: resolveClientIp(request) });
        return json(result, 202);
      }

      if (route === "POST /api/auth/verify") {
        const body = await readJson(request);
        const result = await authService.verifyEmailCode({ email: body.email, code: body.code });
        const csrfToken = randomBytes(16).toString("hex");
        const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
        headers.append("set-cookie", cookie(sessionCookieName, result.sessionToken, { httpOnly: true, secure: secureCookies, maxAge: 7 * 24 * 60 * 60 }));
        headers.append("set-cookie", cookie("nestnote_csrf", csrfToken, { httpOnly: false, secure: secureCookies }));
        return new Response(JSON.stringify({ user: result.user, csrfToken }), { status: 200, headers });
      }

      if (route === "GET /api/auth/session") {
        const cookies = parseCookies(request.headers.get("cookie"));
        const sessionToken = cookies[sessionCookieName];
        const session = await authService.getSession(sessionToken);
        if (!session) return errorResponse("AUTH_REQUIRED");
        const csrfToken = randomBytes(16).toString("hex");
        const response = json({ user: { id: session.userId, email: session.email }, csrfToken });
        response.headers.append("set-cookie", cookie(sessionCookieName, sessionToken, { httpOnly: true, secure: secureCookies, maxAge: 7 * 24 * 60 * 60 }));
        response.headers.append("set-cookie", cookie("nestnote_csrf", csrfToken, { httpOnly: false, secure: secureCookies, maxAge: 7 * 24 * 60 * 60 }));
        return response;
      }

      if (route === "POST /api/auth/logout") {
        const cookies = parseCookies(request.headers.get("cookie"));
        const csrf = request.headers.get("x-csrf-token");
        if (!csrf || !cookies.nestnote_csrf || csrf !== cookies.nestnote_csrf) return errorResponse("CSRF_INVALID");
        await authService.logout(cookies[sessionCookieName]);
        const headers = new Headers();
        headers.append("set-cookie", cookie(sessionCookieName, "", { httpOnly: true, secure: secureCookies, maxAge: 0 }));
        headers.append("set-cookie", cookie("nestnote_csrf", "", { httpOnly: false, secure: secureCookies, maxAge: 0 }));
        return new Response(null, { status: 204, headers });
      }

      if (url.pathname === "/api/warehouses" || url.pathname === "/api/warehouses/order" || url.pathname === "/api/import" || /^\/api\/warehouses\/[^/]+$/.test(url.pathname)) {
        const cookies = parseCookies(request.headers.get("cookie"));
        const session = await authService.getSession(cookies[sessionCookieName]);
        if (!session) return errorResponse("AUTH_REQUIRED");
        if (request.method !== "GET" && !hasValidCsrf(request, cookies)) return errorResponse("CSRF_INVALID");

        if (route === "GET /api/warehouses") return json(await warehouseService.listWarehouses(session.userId));
        if (route === "POST /api/warehouses") {
          const body = await readJson(request);
          return json(await warehouseService.createWarehouse(session.userId, body.snapshot), 201);
        }
        if (route === "PUT /api/warehouses/order") return json(await warehouseService.reorderWarehouses(session.userId, await readJson(request)));
        if (route === "POST /api/import") return json(await warehouseService.importWarehouses(session.userId, await readJson(request)));

        let id;
        try {
          id = decodeURIComponent(url.pathname.slice("/api/warehouses/".length));
        } catch {
          return errorResponse("VALIDATION_FAILED");
        }
        if (request.method === "GET") return json(await warehouseService.getWarehouse(session.userId, id));
        if (request.method === "PUT") return json(await warehouseService.saveWarehouse(session.userId, id, await readJson(request)));
        if (request.method === "DELETE") {
          await warehouseService.deleteWarehouse(session.userId, id, await readJson(request));
          return new Response(null, { status: 204 });
        }
      }

      return errorResponse("NOT_FOUND", 404, "接口不存在");
    } catch (error) {
      return PUBLIC_ERROR_CODES.has(error.code) ? errorResponse(error.code) : errorResponse("INTERNAL_ERROR", 500, "服务暂时不可用");
    }
  };
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) throw apiError("REQUEST_TOO_LARGE");
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw apiError("REQUEST_TOO_LARGE");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value;
  } catch {
    throw apiError("VALIDATION_FAILED");
  }
}

function parseCookies(header = "") {
  return Object.fromEntries(String(header || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function hasValidCsrf(request, cookies) {
  const token = request.headers.get("x-csrf-token");
  return Boolean(token && cookies.nestnote_csrf && token === cookies.nestnote_csrf);
}

function cookie(name, value, { httpOnly, secure, maxAge } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function errorResponse(code, status = ERROR_STATUS[code] || 500, message = safeMessage(code)) {
  return json({ error: { code, message } }, status);
}

function safeMessage(code) {
  return ({
    EMAIL_INVALID: "请输入有效的邮箱地址",
    EMAIL_CODE_COOLDOWN: "验证码发送过于频繁，请稍后再试",
    EMAIL_CODE_DAILY_LIMIT: "该邮箱今日验证码发送次数已达上限",
    IP_CODE_DAILY_LIMIT: "当前网络今日验证码发送次数已达上限",
    EMAIL_CODE_INVALID: "验证码不正确或已失效",
    EMAIL_CODE_EXPIRED: "验证码已过期，请重新获取",
    EMAIL_DELIVERY_UNAVAILABLE: "验证码暂时无法发送，请稍后重试",
    AUTH_REQUIRED: "登录状态已失效，请重新登录",
    ORIGIN_INVALID: "请求来源不受信任",
    CSRF_INVALID: "请求验证失败，请刷新后重试",
    REQUEST_TOO_LARGE: "请求内容过大",
    VALIDATION_FAILED: "提交内容格式不正确",
    WAREHOUSE_NOT_FOUND: "松鼠仓不存在",
    WAREHOUSE_NOT_EMPTY: "仅可在云端松鼠仓为空时导入",
    WAREHOUSE_LIMIT_REACHED: "每个账号最多创建 10 个松鼠仓",
    WAREHOUSE_ORGANIZING: "松鼠仓正在重新整理，请稍后刷新",
    REVISION_CONFLICT: "内容已在其他设备更新",
  })[code] || "服务暂时不可用";
}

function apiError(code) {
  return Object.assign(new Error(code), { code });
}
