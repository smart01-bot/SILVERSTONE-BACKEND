import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { embeddedDatabase } from "../../scripts/embedded.js";
import { migrate } from "../../foundation/migrate.js";
import { seedSynthetic, syntheticPassword } from "../../scripts/fixtures.js";
import { seedExchangeFixtures } from "../../scripts/exchange-fixtures.js";
import { createApp } from "../../foundation/app.js";
import {
  claimExchangeJob,
  finishExchangeJob,
} from "../../foundation/exchanges.js";

test("exchange lifecycle, reservations, idempotency and durable claims (embedded)", async (t) => {
  const db = await embeddedDatabase();
  t.after(() => db.close());
  await migrate(db);
  const f = await seedSynthetic(db),
    accounts = await seedExchangeFixtures(db, f);
  const app = createApp({
      db,
      secret: "synthetic-exchanges-secret-at-least-32",
      rateLimit: 1000,
    }),
    tokens = {};
  for (const who of Object.keys(f))
    tokens[who] = (
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: f[who].email, password: syntheticPassword })
    ).body.data.accessToken;
  const call = (who, method, path, body, key = randomUUID()) =>
    request(app)
      [method]("/api/v1" + path)
      .set("Authorization", `Bearer ${tokens[who]}`)
      .set("Idempotency-Key", key)
      .send(body);
  const body = {
    sourceAccountId: accounts.sub.vodacom,
    destinationAccountId: accounts.sub.airtel,
    amountTzs: "600000",
    currency: "TZS",
    urgent: false,
  };
  let first, second;
  await t.test(
    "typed accounts and unverified/public protected fields fail closed",
    async () => {
      assert.equal(
        (
          await call("sub", "post", "/me/accounts", {
            networkCode: "yas",
            identifierType: "phone",
            identifier: "abc",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call("sub", "post", "/me/accounts", {
            networkCode: "yas",
            identifierType: "agent",
            identifier: "TEST",
            verificationStatus: "verified",
          })
        ).status,
        400,
      );
      const r = await call("sub", "post", "/me/accounts", {
        networkCode: "yas",
        identifierType: "agent",
        identifier: "TEST",
      });
      assert.equal(r.status, 201);
      assert.equal(r.body.data.verificationStatus, "unverified");
      assert.equal(
        (
          await call("sub", "post", "/requests", {
            ...body,
            sourceAccountId: r.body.data.id,
          })
        ).body.error.code,
        "ACCOUNT_VERIFICATION_REQUIRED",
      );
      assert.equal(
        (
          await call("sub", "post", "/requests", {
            ...body,
            sourceAccountId: accounts["other-sub"].vodacom,
          })
        ).status,
        409,
      );
      assert.equal(
        (await call("sub", "post", "/requests", { ...body, amountTzs: 600000 }))
          .status,
        400,
      );
      assert.equal(
        (
          await call("sub", "post", "/requests", {
            ...body,
            mainAgentId: f.main.id,
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "duplicate concurrent creates return one request and exactly two legs",
    async () => {
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          call("sub", "post", "/requests", body, key),
        ),
      );
      for (const r of results)
        assert.equal(r.status, 201, JSON.stringify(r.body));
      first = results[0].body.data;
      assert.equal(new Set(results.map((r) => r.body.data.id)).size, 1);
      assert.equal(first.legs.length, 2);
      assert.equal(first.status, "awaiting_review");
      await assert.rejects(
        db.query(
          "UPDATE ss_v1.transfer_requests SET amount_tzs=1 WHERE id=$1",
          [first.id],
        ),
        /immutable/,
      );
      assert.equal(
        (
          await call(
            "sub",
            "post",
            "/requests",
            { ...body, amountTzs: "1" },
            key,
          )
        ).body.error.code,
        "IDEMPOTENCY_CONFLICT",
      );
      second = (await call("sub", "post", "/requests", body)).body.data;
      assert.notEqual(first.id, second.id);
      const list = (await call("main", "get", "/requests?limit=1")).body;
      assert.equal(list.data[0].id, first.id);
      assert.ok(list.page.nextCursor);
      assert.equal(
        (await call("main", "get", "/requests?cursor=" + list.page.nextCursor))
          .body.data[0].id,
        second.id,
      );
      assert.equal(
        (await call("other-main", "get", "/requests/" + first.id)).status,
        404,
      );
    },
  );
  await t.test(
    "pending rejected suspended unassigned and wrong-role operations denied",
    async () => {
      for (const who of ["pending", "suspended", "main"])
        assert.equal((await call(who, "post", "/requests", body)).status, 403);
      await db.query(
        "UPDATE ss_v1.agents SET application_status='rejected' WHERE id=$1",
        [f.pending.id],
      );
      assert.equal(
        (await call("pending", "post", "/requests", body)).status,
        403,
      );
      await db.query(
        "DELETE FROM ss_v1.main_agent_assignments WHERE sub_agent_id=$1",
        [f["other-sub"].id],
      );
      assert.equal(
        (await call("other-sub", "post", "/requests", body)).status,
        403,
      );
      assert.equal(
        (
          await call("sub", "post", `/requests/${first.id}/accept`, {
            expectedVersion: 1,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call("other-main", "post", `/requests/${first.id}/accept`, {
            expectedVersion: 1,
          })
        ).status,
        404,
      );
    },
  );
  let winner;
  await t.test(
    "concurrent accepts cannot oversubscribe capacity; duplicate acceptance has one effect",
    async () => {
      const keys = [randomUUID(), randomUUID()];
      const results = await Promise.all(
        [first, second].map((r, i) =>
          call(
            "main",
            "post",
            `/requests/${r.id}/accept`,
            { expectedVersion: 1 },
            keys[i],
          ),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const i = results.findIndex((r) => r.status === 200);
      winner = results[i].body.data;
      assert.equal(results[1 - i].body.error.code, "INSUFFICIENT_CAPACITY");
      assert.equal(
        (
          await call(
            "main",
            "post",
            `/requests/${winner.id}/accept`,
            { expectedVersion: 1 },
            keys[i],
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await db.query(
            "SELECT held_tzs::text held FROM ss_v1.exchange_capacity WHERE account_id=$1",
            [accounts.main.airtel],
          )
        ).rows[0].held,
        "600000",
      );
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM ss_v1.exchange_jobs"))
          .rows[0].n,
        1,
      );
      await assert.rejects(
        db.query(
          "UPDATE ss_v1.main_agent_assignments SET main_agent_id=$1 WHERE sub_agent_id=$2",
          [f["other-main"].id, f.sub.id],
        ),
        /handover/,
      );
    },
  );
  let recovered;
  await t.test(
    "two workers cannot double claim; expiry recovers with a fresh token",
    async () => {
      const claims = await Promise.all([
        claimExchangeJob(db),
        claimExchangeJob(db),
      ]);
      assert.equal(claims.filter(Boolean).length, 1);
      const original = claims.find(Boolean);
      await db.query(
        "UPDATE ss_v1.exchange_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [original.id],
      );
      await assert.rejects(
        finishExchangeJob(db, original),
        (e) => e.code === "STALE_CLAIM",
      );
      recovered = await claimExchangeJob(db);
      assert.equal(recovered.id, original.id);
      assert.notEqual(recovered.claimToken, original.claimToken);
      await assert.rejects(
        finishExchangeJob(db, original),
        (e) => e.code === "STALE_CLAIM",
      );
      assert.equal(
        (
          await call("sub", "post", `/requests/${winner.id}/cancel`, {
            expectedVersion: 2,
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "unknown outcome retains hold, blocks cancellation/reclaim and never settles",
    async () => {
      assert.equal(
        (await finishExchangeJob(db, recovered, "unknown")).status,
        "reconciliation",
      );
      await assert.rejects(
        finishExchangeJob(db, recovered, "unknown"),
        (e) => e.code === "STALE_CLAIM",
      );
      assert.equal(await claimExchangeJob(db), null);
      const r = (await call("sub", "get", "/requests/" + winner.id)).body.data;
      assert.equal(r.status, "needs_attention");
      assert.equal(r.reservation.status, "held");
      assert.ok(r.legs.some((l) => l.status === "unknown"));
      assert.equal(
        (
          await call("sub", "post", `/requests/${winner.id}/cancel`, {
            expectedVersion: r.version,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call(
            "main",
            "post",
            `/requests/${winner.id}/manual-confirmations`,
            {},
          )
        ).status,
        503,
      );
      assert.equal(
        (
          await db.query(
            "SELECT held_tzs::text held FROM ss_v1.exchange_capacity WHERE account_id=$1",
            [accounts.main.airtel],
          )
        ).rows[0].held,
        "600000",
      );
      await assert.rejects(
        db.query("DELETE FROM ss_v1.exchange_history"),
        /Immutable/,
      );
    },
  );
  await t.test(
    "safe cancellation releases once; retries recover failed preparation without money movement",
    async () => {
      const created = (
        await call("sub", "post", "/requests", { ...body, amountTzs: "100000" })
      ).body.data;
      const accepted = await call(
        "main",
        "post",
        `/requests/${created.id}/accept`,
        { expectedVersion: 1 },
      );
      assert.equal(accepted.status, 200);
      let c = await claimExchangeJob(db);
      await finishExchangeJob(db, c, "retry");
      assert.equal(await claimExchangeJob(db), null);
      await db.query(
        "UPDATE ss_v1.exchange_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [c.id],
      );
      c = await claimExchangeJob(db);
      await finishExchangeJob(db, c);
      const key = randomUUID();
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await call(
              "sub",
              "post",
              `/requests/${created.id}/cancel`,
              { expectedVersion: 2 },
              key,
            )
          ).status,
          200,
        );
      assert.equal(
        (
          await db.query(
            "SELECT held_tzs::text held FROM ss_v1.exchange_capacity WHERE account_id=$1",
            [accounts.main.airtel],
          )
        ).rows[0].held,
        "600000",
      );
      assert.equal(
        (
          await call("main", "post", `/requests/${created.id}/accept`, {
            expectedVersion: 3,
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "suspension with an existing token blocks accept and worker preparation",
    async () => {
      const created = (
        await call("sub", "post", "/requests", { ...body, amountTzs: "100000" })
      ).body.data;
      assert.equal(
        (
          await call("main", "post", `/requests/${created.id}/accept`, {
            expectedVersion: 1,
          })
        ).status,
        200,
      );
      await db.query(
        "UPDATE ss_v1.agents SET account_status='suspended' WHERE id=$1",
        [f.sub.id],
      );
      assert.equal((await call("sub", "get", "/requests")).status, 403);
      assert.equal(
        (
          await call("main", "post", `/requests/${second.id}/accept`, {
            expectedVersion: 1,
          })
        ).status,
        403,
      );
      assert.equal(await claimExchangeJob(db), null);
    },
  );
});

test("additive Phase 2 upgrade preserves request, legs, session and private document rows", async (t) => {
  const db = await embeddedDatabase();
  t.after(() => db.close());
  await db.query(
    "CREATE SCHEMA ss_v1; CREATE TABLE ss_v1.schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of ["001-foundation.sql", "002-onboarding.sql"]) {
    const sql = await readFile(
      new URL("../../migrations/" + name, import.meta.url),
      "utf8",
    );
    await db.query(sql);
    await db.query(
      "INSERT INTO ss_v1.schema_migrations(name,checksum) VALUES($1,$2)",
      [name, createHash("sha256").update(sql).digest("hex")],
    );
  }
  const f = await seedSynthetic(db),
    id = randomUUID();
  await db.query(
    "INSERT INTO ss_v1.transfer_requests(id,sub_agent_id,main_agent_id,source_network,destination_network,amount_tzs,status) VALUES($1,$2,$3,'vodacom','airtel',100,'awaiting_review')",
    [id, f.sub.id, f.main.id],
  );
  const session = randomUUID(),
    document = randomUUID(),
    leg = randomUUID();
  await db.query(
    "INSERT INTO ss_v1.sessions(id,agent_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [session, f.sub.id],
  );
  await db.query(
    "INSERT INTO ss_v1.documents(id,agent_id,kind,name,mime,size,sha256,content) VALUES($1,$2,'tin','synthetic.png','image/png',1,'synthetic-hash',$3)",
    [document, f.sub.id, Buffer.from("x")],
  );
  await db.query(
    "INSERT INTO ss_v1.transaction_legs(id,request_id,leg_type) VALUES($1,$2,'origin_in')",
    [leg, id],
  );
  const before = (
    await db.query("SELECT * FROM ss_v1.transfer_requests WHERE id=$1", [id])
  ).rows[0];
  await migrate(db);
  await migrate(db);
  const after = (
    await db.query("SELECT * FROM ss_v1.transfer_requests WHERE id=$1", [id])
  ).rows[0];
  for (const key of Object.keys(before))
    assert.deepEqual(after[key], before[key]);
  for (const [table, key] of [
    ["sessions", session],
    ["documents", document],
    ["transaction_legs", leg],
  ])
    assert.equal(
      (await db.query("SELECT id FROM ss_v1." + table + " WHERE id=$1", [key]))
        .rows[0].id,
      key,
    );
  assert.equal(after.source_account_id, null);
  assert.equal(after.version, 1);
});
