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

  function providerError(response, payload, invalidMessage) {
    if (payload?.error_code === "email_not_confirmed")
      return new ApiError(
        403,
        "EMAIL_NOT_CONFIRMED",
        "Confirm your email before signing in. Check your inbox and spam folder.",
      );
    if (response.status === 429)
      return new ApiError(
        429,
        "AUTH_RATE_LIMITED",
        "Too many authentication attempts. Please wait before trying again.",
      );
    if (payload?.error_code === "user_already_exists")
      return new ApiError(
        409,
        "ACCOUNT_CONFLICT",
        "An account with these details already exists. Sign in or recover your password.",
      );
    if (payload?.error_code === "weak_password")
      return new ApiError(
        400,
        "INVALID_PASSWORD",
        "Choose a stronger password and try again.",
      );
    const invalid = response.status === 400 || response.status === 401;
    return new ApiError(
      invalid ? 401 : 503,
      invalid ? "INVALID_CREDENTIALS" : "AUTH_PROVIDER_UNAVAILABLE",
      invalid
        ? invalidMessage
        : "Authentication service temporarily unavailable.",
    );
  }

  async function request(path, body, invalidMessage) {
    const { response, payload } = await post(path, body);
    if (!response.ok) throw providerError(response, payload, invalidMessage);
    if (!payload?.user?.id || !payload.access_token)
      throw new ApiError(
        503,
        "AUTH_PROVIDER_UNAVAILABLE",
        "Authentication service temporarily unavailable.",
      );
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
      const { response, payload } = await post("signup", { email, password });
      if (!response.ok)
        throw providerError(
          response,
          payload,
          "Unable to create this account with those credentials.",
        );
      // GoTrue returns a bare user while awaiting confirmation, including obfuscated
      // users for existing accounts. Never link that ID or issue a Silverstone session.
      if ((payload?.id || payload?.user?.id) && !payload.access_token)
        return { requiresEmailConfirmation: true };
      if (!payload?.user?.id || !payload.access_token)
        throw new ApiError(
          503,
          "AUTH_PROVIDER_UNAVAILABLE",
          "Authentication service temporarily unavailable.",
        );
      return {
        id: payload.user.id,
        email: String(payload.user.email || "").toLowerCase(),
      };
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
