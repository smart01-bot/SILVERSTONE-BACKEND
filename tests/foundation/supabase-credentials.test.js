import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseCredentialProvider } from "../../foundation/supabase-credentials.js";
const provider = (payload, status = 200) =>
  createSupabaseCredentialProvider({
    url: "https://synthetic.example.test",
    publishableKey: "synthetic-key",
    fetchImpl: async () => ({
      ok: status < 400,
      status,
      json: async () => payload,
    }),
  });
test("signup handles bare confirmation users without treating their IDs as authenticated", async () => {
  for (const payload of [
    { id: "unconfirmed" },
    { id: "obfuscated-existing", identities: [] },
    { user: { id: "unconfirmed" }, session: null },
  ]) {
    assert.deepEqual(
      await provider(payload).signUp(
        "agent@example.test",
        "synthetic-password",
      ),
      { requiresEmailConfirmation: true },
    );
  }
});
test("only session responses yield an authenticated identity", async () => {
  const p = provider({
    access_token: "synthetic",
    user: { id: "confirmed", email: "AGENT@example.test" },
  });
  assert.deepEqual(await p.signUp("agent@example.test", "synthetic-password"), {
    id: "confirmed",
    email: "agent@example.test",
  });
  assert.deepEqual(await p.signIn("agent@example.test", "synthetic-password"), {
    id: "confirmed",
    email: "agent@example.test",
  });
  await assert.rejects(
    provider({ user: { id: "unconfirmed" } }).signIn("a", "b"),
    { code: "AUTH_PROVIDER_UNAVAILABLE" },
  );
  await assert.rejects(provider({}).signUp("a", "b"), {
    code: "AUTH_PROVIDER_UNAVAILABLE",
  });
});
test("confirmation, rate limiting and invalid credentials remain distinct", async () => {
  await assert.rejects(
    provider({ error_code: "email_not_confirmed" }, 400).signIn("a", "b"),
    { code: "EMAIL_NOT_CONFIRMED", status: 403 },
  );
  await assert.rejects(provider({}, 429).signUp("a", "b"), {
    code: "AUTH_RATE_LIMITED",
    status: 429,
  });
  await assert.rejects(provider({}, 400).signIn("a", "b"), {
    code: "INVALID_CREDENTIALS",
    status: 401,
  });
});
