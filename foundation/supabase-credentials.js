import { ApiError } from "./errors.js";

function normalizeBaseUrl(url) {
  if (!url) return null;
  return String(url).replace(/\/+$/, "");
}

export function createSupabaseCredentialProvider({
  url,
  publishableKey,
  fetchImpl = globalThis.fetch,
} = {}) {
  const baseUrl = normalizeBaseUrl(url);
  if (!baseUrl || !publishableKey) return null;
  if (typeof fetchImpl !== "function")
    throw new Error("A fetch implementation is required for Supabase Auth.");

  async function post(path, body) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/auth/v1/${path}`, {
        method: "POST",
        headers: {
          apikey: publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ApiError(
        503,
        "AUTH_PROVIDER_UNAVAILABLE",
        "Authentication service temporarily unavailable.",
      );
    }

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      // Keep provider responses out of API errors.
    }
    return { response, payload };
  }

  async function request(path, body, invalidMessage) {
    const { response, payload } = await post(path, body);

    if (!response.ok || !payload?.user?.id) {
      const status = response.status === 400 || response.status === 401 ? 401 : 503;
      throw new ApiError(
        status,
        status === 401 ? "INVALID_CREDENTIALS" : "AUTH_PROVIDER_UNAVAILABLE",
        status === 401
          ? invalidMessage
          : "Authentication service temporarily unavailable.",
      );
    }

    return {
      id: payload.user.id,
      email: String(payload.user.email || "").toLowerCase(),
    };
  }

  return {
    async signIn(email, password) {
      return request(
        "token?grant_type=password",
        { email, password },
        "Incorrect email or password.",
      );
    },
    async signUp(email, password) {
      return request(
        "signup",
        { email, password },
        "Unable to create this account with those credentials.",
      );
    },
    async recover(email) {
      const { response } = await post("recover", { email });
      if (!response.ok)
        throw new ApiError(
          503,
          "AUTH_PROVIDER_UNAVAILABLE",
          "Unable to send a recovery email right now. Please try again later.",
        );
      return { accepted: true };
    },
  };
}
