import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { embeddedDatabase } from "../../scripts/embedded.js";
import { migrate } from "../../foundation/migrate.js";
import { createApp } from "../../foundation/app.js";
import { createHostedAuthRouter } from "../../foundation/hosted-auth.js";
import { ApiError } from "../../foundation/errors.js";

const secret = "hosted-auth-test-secret-at-least-32-characters";
const password = "HostedPassphrase123!";

function fakeCredentials() {
  const users = new Map();
  const recoveries = [];
  return {
    recoveries,
    async signUp(email, suppliedPassword) {
      if (users.has(email))
        throw new ApiError(409, "ACCOUNT_CONFLICT", "Account already exists.");
      const user = { id: randomUUID(), email, password: suppliedPassword };
      users.set(email, user);
      return { id: user.id, email };
    },
    async signIn(email, suppliedPassword) {
      const user = users.get(email);
      if (!user || user.password !== suppliedPassword)
        throw new ApiError(
          401,
          "INVALID_CREDENTIALS",
          "Incorrect email or password.",
        );
      return { id: user.id, email };
    },
    async recover(email) {
      recoveries.push(email);
      return { accepted: true };
    },
  };
}

function bearer(session) {
  return `Bearer ${session.accessToken}`;
}

test("hosted Supabase credential bridge preserves Silverstone state and sessions", async (t) => {
  const db = await embeddedDatabase();
  t.after(() => db.close());
  await migrate(db);

  const credentials = fakeCredentials();
  const app = express();
  app.use(createHostedAuthRouter({ db, secret, credentials }));
  app.use(createApp({ db, secret, rateLimit: 1000 }));

  const registration = await request(app).post("/api/v1/auth/register").send({
    email: "hosted@example.test",
    password,
    name: "Hosted Agent",
    phone: "+255700002001",
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.body.data.agent.accountStatus, "pending");
  assert.equal(registration.body.data.agent.applicationStatus, "draft");

  const recovery = await request(app).post("/api/v1/auth/recovery").send({
    email: "HOSTED@example.test",
  });
  assert.equal(recovery.status, 200);
  assert.equal(recovery.body.data.accepted, true);
  assert.deepEqual(credentials.recoveries, ["hosted@example.test"]);

  const invalidRecovery = await request(app)
    .post("/api/v1/auth/recovery")
    .send({
      email: "not-an-email",
    });
  assert.equal(invalidRecovery.status, 400);

  const stored = (
    await db.query(
      "SELECT id,password_hash,auth_user_id,auth_source FROM ss_v1.agents WHERE email=$1",
      ["hosted@example.test"],
    )
  ).rows[0];
  assert.equal(stored.auth_source, "supabase");
  assert.ok(stored.auth_user_id);
  assert.equal(stored.password_hash, null);

  const wrong = await request(app).post("/api/v1/auth/login").send({
    email: "hosted@example.test",
    password: "wrong-password",
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error.code, "INVALID_CREDENTIALS");

  const pending = await request(app).post("/api/v1/auth/login").send({
    email: "hosted@example.test",
    password,
  });
  assert.equal(pending.status, 200);
  assert.equal(
    (
      await request(app)
        .get("/api/v1/provider-status")
        .set("Authorization", bearer(pending.body.data))
    ).status,
    403,
  );

  const goodReauth = await request(app)
    .post("/api/v1/auth/reauthenticate")
    .set("Authorization", bearer(pending.body.data))
    .send({ password });
  assert.equal(goodReauth.status, 200);
  assert.equal(goodReauth.body.data.verified, true);

  const badReauth = await request(app)
    .post("/api/v1/auth/reauthenticate")
    .set("Authorization", bearer(pending.body.data))
    .send({ password: "wrong-password" });
  assert.equal(badReauth.status, 401);
  assert.equal(badReauth.body.error.code, "INVALID_CREDENTIALS");

  const invalidSession = await request(app)
    .post("/api/v1/auth/reauthenticate")
    .set("Authorization", "Bearer not-a-token")
    .send({ password });
  assert.equal(invalidSession.status, 401);
  assert.equal(invalidSession.body.error.code, "INVALID_SESSION");

  await db.query(
    "UPDATE ss_v1.agents SET account_status='active', application_status='approved' WHERE id=$1",
    [stored.id],
  );
  const approved = await request(app).post("/api/v1/auth/login").send({
    email: "hosted@example.test",
    password,
  });
  assert.equal(approved.status, 200);
  assert.equal(
    (
      await request(app)
        .get("/api/v1/provider-status")
        .set("Authorization", bearer(approved.body.data))
    ).status,
    200,
  );

  await db.query(
    "UPDATE ss_v1.agents SET account_status='suspended' WHERE id=$1",
    [stored.id],
  );
  assert.equal(
    (
      await request(app)
        .get("/api/v1/provider-status")
        .set("Authorization", bearer(approved.body.data))
    ).status,
    403,
  );

  await db.query(
    "UPDATE ss_v1.agents SET account_status='closed' WHERE id=$1",
    [stored.id],
  );
  const closed = await request(app).post("/api/v1/auth/login").send({
    email: "hosted@example.test",
    password,
  });
  assert.equal(closed.status, 401);
  assert.equal(closed.body.error.code, "INVALID_CREDENTIALS");
});

test("confirmation creates no app session; verified retry repairs partial registration", async (t) => {
  const db = await embeddedDatabase();
  t.after(() => db.close());
  await migrate(db);
  let exists = false,
    confirmed = false,
    signups = 0;
  const identity = { id: randomUUID(), email: "confirmation@example.test" };
  const credentials = {
    async signIn(email, supplied) {
      if (!exists || supplied !== password)
        throw new ApiError(
          401,
          "INVALID_CREDENTIALS",
          "Incorrect credentials.",
        );
      if (!confirmed)
        throw new ApiError(403, "EMAIL_NOT_CONFIRMED", "Confirm email.");
      return identity;
    },
    async signUp() {
      exists = true;
      signups++;
      return { requiresEmailConfirmation: true };
    },
  };
  const app = express();
  app.use(createHostedAuthRouter({ db, secret, credentials }));
  const body = {
    email: identity.email,
    password,
    name: "Synthetic Applicant",
    phone: "+255700002099",
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await request(app).post("/api/v1/auth/register").send(body);
    assert.equal(result.status, 202);
    assert.deepEqual(result.body.data, { requiresEmailConfirmation: true });
  }
  assert.equal(signups, 1);
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM ss_v1.agents")).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM ss_v1.sessions")).rows[0].n,
    0,
  );
  const unconfirmed = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: identity.email, password });
  assert.equal(unconfirmed.body.error.code, "EMAIL_NOT_CONFIRMED");
  confirmed = true;
  const incomplete = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: identity.email, password });
  assert.equal(incomplete.body.error.code, "REGISTRATION_REQUIRED");
  // Wrong credentials must not claim an existing Supabase identity.
  const wrong = await request(app)
    .post("/api/v1/auth/register")
    .send({ ...body, password: "DifferentSyntheticPassword" });
  assert.equal(wrong.status, 202);
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM ss_v1.agents")).rows[0].n,
    0,
  );
  const completed = await request(app).post("/api/v1/auth/register").send(body);
  assert.equal(completed.status, 201);
  assert.equal(completed.body.data.agent.accountStatus, "pending");
  assert.equal(
    (await db.query("SELECT auth_user_id FROM ss_v1.agents")).rows[0]
      .auth_user_id,
    identity.id,
  );
  const duplicate = await request(app)
    .post("/api/v1/auth/register")
    .send({ ...body, email: "different@example.test" });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "ACCOUNT_CONFLICT");
});
