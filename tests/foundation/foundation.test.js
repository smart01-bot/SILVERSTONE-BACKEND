import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { embeddedDatabase } from "../../scripts/embedded.js";
import { seedSynthetic, syntheticPassword } from "../../scripts/fixtures.js";
import { migrate } from "../../foundation/migrate.js";
import { createApp } from "../../foundation/app.js";
import { assertLocalDatabase } from "../../foundation/database.js";
const secret = "synthetic-only-secret-at-least-32-characters";

test("isolated PostgreSQL foundation and HTTP authorization", async (t) => {
  const db = await embeddedDatabase();
  t.after(() => db.close());
  await migrate(db);
  await migrate(db);
  const fixtures = await seedSynthetic(db);
  const app = createApp({ db, secret, rateLimit: 1000 });
  const login = async (name) => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: fixtures[name].email, password: syntheticPassword });
    assert.equal(response.status, 200);
    return response.body.data;
  };
  const pending = await login("pending"),
    main = await login("main"),
    other = await login("other-main"),
    sub = await login("sub");
  const bearer = (token) => `Bearer ${token.accessToken}`;
  await t.test(
    "startup health and pending login/me without operational access",
    async () => {
      const health = await request(app).get("/health");
      assert.equal(health.status, 200);
      assert.equal(health.body.data.paymentsEnabled, false);
      const me = await request(app)
        .get("/api/v1/me")
        .set("Authorization", bearer(pending));
      assert.equal(me.status, 200);
      assert.equal(me.body.data.accountStatus, "pending");
      assert.equal(me.body.data.password_hash, undefined);
      for (const path of ["/api/v1/requests", "/api/v1/agents"])
        assert.equal(
          (await request(app).get(path).set("Authorization", bearer(pending)))
            .status,
          403,
        );
    },
  );
  await t.test(
    "registration rejects protected fields; creates pending draft only",
    async () => {
      const body = {
        email: "new@example.test",
        password: syntheticPassword,
        name: "Synthetic new",
        phone: "+255700001000",
      };
      for (const field of [
        "role",
        "accountStatus",
        "mainAgentId",
        "selfieVerified",
        "status",
      ])
        assert.equal(
          (
            await request(app)
              .post("/api/v1/auth/register")
              .send({ ...body, [field]: "admin" })
          ).status,
          400,
        );
      const result = await request(app)
        .post("/api/v1/auth/register")
        .send(body);
      assert.equal(result.status, 201);
      assert.equal(result.body.data.agent.role, "sub-agent");
      assert.equal(result.body.data.agent.applicationStatus, "draft");
      assert.equal(
        (await request(app).post("/api/v1/auth/register").send(body)).status,
        409,
      );
    },
  );
  await t.test(
    "current assignment, role and owner scope are enforced",
    async () => {
      const list = await request(app)
        .get("/api/v1/agents?limit=1")
        .set("Authorization", bearer(main));
      assert.equal(list.status, 200);
      assert.equal(list.body.data.length, 1);
      assert.ok(list.body.page.nextCursor);
      const next = await request(app)
        .get(`/api/v1/agents?cursor=${list.body.page.nextCursor}`)
        .set("Authorization", bearer(main));
      assert.equal(next.body.data.length, 1);
      const target = `/api/v1/agents/${fixtures.sub.id}`;
      assert.equal(
        (await request(app).get(target).set("Authorization", bearer(main)))
          .status,
        200,
      );
      assert.equal(
        (await request(app).get(target).set("Authorization", bearer(other)))
          .status,
        404,
      );
      assert.equal(
        (
          await request(app)
            .get("/api/v1/agents")
            .set("Authorization", bearer(sub))
        ).status,
        403,
      );
      assert.equal(
        (
          await request(app)
            .patch("/api/v1/me")
            .set("Authorization", bearer(sub))
            .send({ role: "main-agent" })
        ).status,
        400,
      );
      await db.query(
        "UPDATE ss_v1.main_agent_assignments SET main_agent_id=$1 WHERE sub_agent_id=$2",
        [fixtures["other-main"].id, fixtures.sub.id],
      );
      assert.equal(
        (await request(app).get(target).set("Authorization", bearer(main)))
          .status,
        404,
      );
      await db.query(
        "UPDATE ss_v1.main_agent_assignments SET main_agent_id=$1 WHERE sub_agent_id=$2",
        [fixtures.main.id, fixtures.sub.id],
      );
    },
  );
  const id = randomUUID();
  await db.query(
    `INSERT INTO ss_v1.transfer_requests(id,sub_agent_id,main_agent_id,source_network,destination_network,amount_tzs,status)
 VALUES ($1,$2,$3,'vodacom','yas',9007199254740993,'awaiting_review')`,
    [id, fixtures.sub.id, fixtures.main.id],
  );
  await t.test("request scope and lossless whole-TZS contract", async () => {
    const own = await request(app)
      .get(`/api/v1/requests/${id}`)
      .set("Authorization", bearer(sub));
    assert.equal(own.status, 200);
    assert.equal(own.body.data.amountTzs, "9007199254740993");
    assert.equal(
      (
        await request(app)
          .get(`/api/v1/requests/${id}`)
          .set("Authorization", bearer(other))
      ).status,
      404,
    );
    assert.equal(
      (
        await request(app)
          .get("/api/v1/requests/invalid")
          .set("Authorization", bearer(sub))
      ).status,
      400,
    );
  });
  await t.test(
    "suspension takes effect with an already-issued access token",
    async () => {
      await db.query(
        "UPDATE ss_v1.agents SET account_status='suspended' WHERE id=$1",
        [fixtures.sub.id],
      );
      assert.equal(
        (
          await request(app)
            .get("/api/v1/requests")
            .set("Authorization", bearer(sub))
        ).status,
        403,
      );
      assert.equal(
        (await request(app).get("/api/v1/me").set("Authorization", bearer(sub)))
          .status,
        200,
      );
      await db.query(
        "UPDATE ss_v1.agents SET account_status='active' WHERE id=$1",
        [fixtures.sub.id],
      );
    },
  );
  await t.test("payment and legacy endpoints cannot execute", async () => {
    for (const path of ["/api/v1/transfers/process", "/api/v1/requests"])
      assert.equal(
        (
          await request(app)
            .post(path)
            .set("Authorization", bearer(sub))
            .send({})
        ).status,
        503,
      );
    assert.equal(
      (
        await request(app)
          .post("/api/transfers/process")
          .set("Authorization", bearer(sub))
          .send({})
      ).status,
      404,
    );
  });
  await t.test(
    "token purpose, issuer, audience, algorithm and expiry fail closed",
    async () => {
      const claims = jwt.decode(sub.accessToken);
      for (const overrides of [
        { purpose: "reset" },
        { iss: "other" },
        { aud: "other" },
        { exp: 1 },
      ]) {
        const token = jwt.sign({ ...claims, ...overrides }, secret, {
          algorithm: "HS256",
        });
        assert.equal(
          (
            await request(app)
              .get("/api/v1/me")
              .set("Authorization", `Bearer ${token}`)
          ).status,
          401,
        );
      }
      const token = jwt.sign(claims, secret, { algorithm: "HS384" });
      assert.equal(
        (
          await request(app)
            .get("/api/v1/me")
            .set("Authorization", `Bearer ${token}`)
        ).status,
        401,
      );
    },
  );
  await t.test(
    "rotation, replay revocation and logout invalidate bearer sessions",
    async () => {
      const fresh = await login("sub");
      const rotated = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: fresh.refreshToken });
      assert.equal(rotated.status, 200);
      assert.equal(
        (
          await request(app)
            .post("/api/v1/auth/refresh")
            .send({ refreshToken: fresh.refreshToken })
        ).status,
        401,
      );
      assert.equal(
        (
          await request(app)
            .get("/api/v1/me")
            .set("Authorization", bearer(rotated.body.data))
        ).status,
        401,
      );
      const logout = await login("sub");
      assert.equal(
        (
          await request(app)
            .post("/api/v1/auth/logout")
            .set("Authorization", bearer(logout))
            .send({})
        ).status,
        200,
      );
      assert.equal(
        (
          await request(app)
            .get("/api/v1/me")
            .set("Authorization", bearer(logout))
        ).status,
        401,
      );
      assert.equal(
        (
          await request(app)
            .post("/api/v1/auth/refresh")
            .send({ refreshToken: logout.refreshToken })
        ).status,
        401,
      );
    },
  );
  await t.test("concurrent refresh replay revokes session", async () => {
    const tokens = await login("sub");
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post("/api/v1/auth/refresh")
          .send({ refreshToken: tokens.refreshToken }),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401]);
    assert.equal(
      (
        await request(app)
          .get("/api/v1/me")
          .set(
            "Authorization",
            bearer(responses.find((r) => r.status === 200).body.data),
          )
      ).status,
      401,
    );
  });
  await t.test(
    "password reauthentication and recovery fail safely",
    async () => {
      assert.equal(
        (
          await request(app)
            .post("/api/v1/auth/reauthenticate")
            .set("Authorization", bearer(pending))
            .send({ password: "wrong" })
        ).status,
        401,
      );
      assert.equal(
        (
          await request(app)
            .post("/api/v1/auth/reauthenticate")
            .set("Authorization", bearer(pending))
            .send({ password: syntheticPassword })
        ).status,
        200,
      );
      const result = await request(app)
        .post("/api/v1/auth/recovery")
        .send({ email: "pending@example.test" });
      assert.equal(result.status, 503);
      assert.equal(result.body.resetToken, undefined);
    },
  );
  await t.test(
    "constraints and transaction rollback prevent invalid data",
    async () => {
      await assert.rejects(
        db.query(
          "UPDATE ss_v1.agents SET account_status='unknown' WHERE id=$1",
          [fixtures.sub.id],
        ),
      );
      await assert.rejects(
        db.query(
          "INSERT INTO ss_v1.main_agent_assignments(sub_agent_id,main_agent_id) VALUES ($1,$2)",
          [fixtures.sub.id, fixtures["other-main"].id],
        ),
      );
      await assert.rejects(
        db.query(
          "INSERT INTO ss_v1.main_agent_assignments(sub_agent_id,main_agent_id) VALUES ($1,$2)",
          [fixtures.main.id, fixtures.sub.id],
        ),
      );
      await assert.rejects(
        db.query(
          "UPDATE ss_v1.transfer_requests SET amount_tzs=-1 WHERE id=$1",
          [id],
        ),
      );
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.query(
            "UPDATE ss_v1.agents SET name='rollback' WHERE id=$1",
            [fixtures.sub.id],
          );
          throw Error("rollback");
        }),
      );
      assert.equal(
        (
          await db.query("SELECT name FROM ss_v1.agents WHERE id=$1", [
            fixtures.sub.id,
          ])
        ).rows[0].name,
        "sub",
      );
    },
  );
  await t.test("errors are structured, bounded and throttled", async () => {
    const bad = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{");
    assert.equal(bad.status, 400);
    assert.ok(bad.body.error.requestId);
    assert.deepEqual(bad.body.error.fieldErrors, {});
    const restricted = createApp({ db, secret, rateLimit: 1 });
    await request(restricted).post("/api/v1/auth/recovery").send({});
    assert.equal(
      (await request(restricted).post("/api/v1/auth/recovery").send({})).status,
      429,
    );
  });
});
test("migrations preserve synthetic legacy data and reject unknown/checksum drift", async (t) => {
  const db = await embeddedDatabase();
  t.after(() => db.close());
  await db.query(
    "CREATE TABLE public.agents(id text PRIMARY KEY,name text); INSERT INTO public.agents VALUES ('legacy','Preserve me')",
  );
  await migrate(db);
  await migrate(db);
  assert.equal(
    (await db.query("SELECT name FROM public.agents")).rows[0].name,
    "Preserve me",
  );
  await db.query("UPDATE ss_v1.schema_migrations SET checksum='tampered'");
  await assert.rejects(migrate(db), /checksum/);
  const unknown = await embeddedDatabase();
  t.after(() => unknown.close());
  await unknown.query("CREATE SCHEMA ss_v1");
  await assert.rejects(migrate(unknown), /Unknown/);
});
test("local database guard refuses live URLs and inherited DATABASE_URL", () => {
  for (const url of [
    "",
    "postgresql://example.com/silverstone_test",
    "postgresql://localhost/production",
    "postgresql://localhost/postgres",
  ])
    assert.throws(() => assertLocalDatabase(url));
  assert.equal(
    assertLocalDatabase("postgresql://127.0.0.1/silverstone_test"),
    "postgresql://127.0.0.1/silverstone_test",
  );
});
