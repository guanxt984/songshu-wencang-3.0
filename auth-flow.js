const GUEST_SESSION_KEY = "squirrel-warehouse-guest-session";

export function createAuthFlow({ fetchImpl = fetch, clock = () => Date.now(), guestStorage = browserGuestStorage() } = {}) {
  let state = { status: "loading", email: "", user: null, csrfToken: "", retryUntil: 0, error: "" };

  const update = (patch) => (state = { ...state, ...patch });
  const call = async (path, options = {}) => {
    const response = await fetchImpl(path, { credentials: "same-origin", ...options });
    const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = Object.assign(new Error(payload.error?.message || "服务暂时不可用"), { code: payload.error?.code || "INTERNAL_ERROR" });
      update({ status: state.status === "loading" ? "email" : state.status, error: error.message });
      throw error;
    }
    return payload;
  };

  return {
    getState: () => ({ ...state, retryAfterSeconds: Math.max(0, Math.ceil((state.retryUntil - clock()) / 1000)) }),
    hydrate({ user, csrfToken = "" }) {
      return update({ status: "authenticated", user, csrfToken, error: "" });
    },
    async restore() {
      update({ status: "loading", error: "" });
      if (guestStorage?.getItem(GUEST_SESSION_KEY) === "active") {
        return update({ status: "authenticated", user: guestUser(), csrfToken: "", error: "" });
      }
      try {
        const payload = await call("/api/auth/session");
        return update({ status: "authenticated", user: payload.user, csrfToken: payload.csrfToken, error: "" });
      } catch (error) {
        if (error.code !== "AUTH_REQUIRED") throw error;
        return update({ status: "email", user: null, error: "" });
      }
    },
    enterGuest() {
      guestStorage?.setItem(GUEST_SESSION_KEY, "active");
      return update({ status: "authenticated", user: guestUser(), csrfToken: "", error: "" });
    },
    async requestCode(email) {
      const normalized = String(email || "").trim().toLowerCase();
      update({ status: "sending", email: normalized, error: "" });
      try {
        const payload = await call("/api/auth/email-code", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: normalized }),
        });
        return update({ status: "code", retryUntil: clock() + (payload.retryAfterSeconds || 60) * 1000, error: "" });
      } catch (error) {
        update({ status: "email", error: error.message });
        throw error;
      }
    },
    async resendCode() {
      if (state.retryUntil > clock()) throw Object.assign(new Error("请稍后再重新发送"), { code: "EMAIL_CODE_COOLDOWN" });
      return this.requestCode(state.email);
    },
    async verifyCode(code) {
      update({ status: "verifying", error: "" });
      try {
        const payload = await call("/api/auth/verify", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: state.email, code: String(code || "").trim() }),
        });
        return update({ status: "authenticated", user: payload.user, csrfToken: payload.csrfToken, error: "" });
      } catch (error) {
        update({ status: "code", error: error.message });
        throw error;
      }
    },
    async logout() {
      if (state.user?.isGuest) {
        guestStorage?.removeItem(GUEST_SESSION_KEY);
        return update({ status: "email", email: "", user: null, csrfToken: "", error: "" });
      }
      await call("/api/auth/logout", { method: "POST", headers: { "x-csrf-token": state.csrfToken } });
      return update({ status: "email", email: "", user: null, csrfToken: "", error: "" });
    },
  };
}

function guestUser() {
  return { id: "guest", email: "", isGuest: true };
}

function browserGuestStorage() {
  return typeof localStorage === "undefined" ? null : localStorage;
}
