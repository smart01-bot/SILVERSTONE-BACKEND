import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import express from "express";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { embeddedDatabase } from "../../scripts/embedded.js";
import { migrate } from "../../foundation/migrate.js";
import { seedSynthetic, syntheticPassword } from "../../scripts/fixtures.js";
import { createApp } from "../../foundation/app.js";
import { createHostedAuthRouter } from "../../foundation/hosted-auth.js";
import { paymentEndpoint } from "../../foundation/payment-endpoints.js";
import {
  claimPayment,
  finishPayment,
  runPaymentOnce,
  refreshFunding,
} from "../../foundation/payments.js";

test("endpoint validation preserves agent IDs and normalizes mobile wallets", () => {
  assert.equal(
    paymentEndpoint({
      networkCode: "vodacom",
      identifierType: "phone",
      identifier: "0743 428 876",
    }).identifier,
    "+255743428876",
  );
  assert.equal(
    paymentEndpoint({
      networkCode: "yas",
      identifierType: "agent",
      identifier: "0012345",
    }).identifier,
    "0012345",
  );
  for (const identifier of ["+254743428876", "abc", "0743", "+255743428876x"])
    assert.throws(() =>
      paymentEndpoint({
        networkCode: "vodacom",
        identifierType: "phone",
        identifier,
      }),
    );
  assert.throws(() =>
    paymentEndpoint({
      networkCode: "vodacom",
      identifierType: "agent",
      identifier: "1234",
      verified: true,
    }),
  );
});
test("real requests, provider orchestration and recovery (isolated database only)", async (t) => {
  const db = await embeddedDatabase();
  t.after(() => db.close());
  await migrate(db);
  const f = await seedSynthetic(db);
  const sends = [],
    inputs = new Map(),
    observations = new Map();
  const provider = {
    supports: () => true,
    balance: async ({ scope }) => ({
      verified: true,
      scope,
      currency: "TZS",
      availableTzs: "1000000",
    }),
    collect: async (args) => {
      sends.push(args);
      inputs.set(args.reference, args);
      return { status: "confirmed" };
    },
    payout: async (args) => {
      sends.push(args);
      inputs.set(args.reference, args);
      return { status: "confirmed" };
    },
    lookup: async (args) =>
      observations.get(args.reference) || {
        verified: true,
        reference: args.reference,
        scope: args.scope,
        kind: args.kind,
        amountTzs: args.amountTzs,
        currency: "TZS",
        endpoint: args.kind === "collect" ? args.source : args.destination,
        providerReference: "provider-" + args.reference,
        feeTzs: "0",
        status: "confirmed",
      },
    verifyWebhook: async ({ rawBody, headers }) => {
      const actual = createHmac("sha256", "test-only-key")
        .update(rawBody)
        .digest("hex");
      const supplied = headers["x-test-signature"] || "";
      if (
        supplied.length !== actual.length ||
        !timingSafeEqual(Buffer.from(actual), Buffer.from(supplied))
      )
        throw Error("signature");
      return { ...JSON.parse(rawBody), verified: true };
    },
  };
  const providers = { testOnly: provider };
  const app = express();
  app.use(
    createHostedAuthRouter({
      db,
      secret: "payments-test-secret-at-least-32-characters",
      credentials: {},
    }),
  );
  // Sign in via core before mounting the hosted-auth wrapper, which has no credential service in tests.
  const core = createApp({
    db,
    secret: "payments-test-secret-at-least-32-characters",
    rateLimit: 1000,
    providers,
  });
  const tokens = {};
  for (const who of ["sub", "main", "other-sub"])
    tokens[who] = (
      await request(core)
        .post("/api/v1/auth/login")
        .send({ email: f[who].email, password: syntheticPassword })
    ).body.data.accessToken;
  app.use(core);
  const call = (who, method, path, body, key = randomUUID()) =>
    request(app)
      [method]("/api/v1" + path)
      .set("Authorization", "Bearer " + tokens[who])
      .set("Idempotency-Key", key)
      .send(body);
  const payload = {
    source: {
      networkCode: "vodacom",
      identifierType: "phone",
      identifier: "0700000001",
    },
    destination: {
      networkCode: "airtel",
      identifierType: "agent",
      identifier: "0012345",
    },
    amountTzs: "10000",
    currency: "TZS",
  };
  const create = async (body = payload) => {
    const r = await call("sub", "post", "/requests", body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data;
  };
  const accept = async (row) => {
    const r = await call("main", "post", `/requests/${row.id}/accept`, {
      expectedVersion: row.version,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.data;
  };
  const due = () =>
    db.query(
      "UPDATE ss_v1.payment_tasks SET next_at=clock_timestamp()-interval '1 second'",
    );
  const task = async (id, kind = "collect") =>
    (
      await db.query(
        "SELECT * FROM ss_v1.payment_tasks WHERE request_id=$1 AND kind=$2",
        [id, kind],
      )
    ).rows[0];
  const current = async (id) =>
    (await call("sub", "get", "/requests/" + id)).body.data;
  let row,
    funding = randomUUID();
  await t.test(
    "real endpoints survive idempotent retry; outsiders and immutable changes are denied",
    async () => {
      const key = randomUUID();
      const a = await call("sub", "post", "/requests", payload, key);
      assert.equal(a.status, 201, JSON.stringify(a.body));
      row = a.body.data;
      assert.equal(row.accounts.source.identifier, "+255700000001");
      assert.equal(row.accounts.destination.identifier, "0012345");
      assert.equal(row.accounts.source.verificationStatus, "unverified");
      assert.equal(
        (await call("sub", "post", "/requests", payload, key)).body.data.id,
        row.id,
      );
      assert.equal(
        (
          await call(
            "sub",
            "post",
            "/requests",
            { ...payload, amountTzs: "999" },
            key,
          )
        ).status,
        409,
      );
      assert.equal(
        (await call("other-sub", "get", "/requests/" + row.id)).status,
        404,
      );
      await assert.rejects(
        db.query(
          "UPDATE ss_v1.transfer_requests SET account_snapshot='{}' WHERE id=$1",
          [row.id],
        ),
      );
      const response = await call(
        "main",
        "post",
        `/requests/${row.id}/accept`,
        { expectedVersion: 1 },
      );
      assert.equal(response.body.error.code, "PAYMENT_PROVIDER_UNAVAILABLE");
      assert.equal(sends.length, 0);
      assert.equal((await current(row.id)).status, "awaiting_review");
      const cancelled = await create();
      assert.equal(
        (
          await call("sub", "post", `/requests/${cancelled.id}/cancel`, {
            expectedVersion: 1,
          })
        ).status,
        200,
      );
    },
  );
  await db.query(
    "INSERT INTO ss_v1.payment_funding(id,main_agent_id,provider,scope,enabled) VALUES($1,$2,$3,$4,true)",
    [funding, f.main.id, "testOnly", "agency-test"],
  );
  await db.query(
    `INSERT INTO ss_v1.payment_routes(id,funding_id,source_network,destination_network,source_type,destination_type,max_fee_tzs,enabled) VALUES($1,$2,'vodacom','airtel','phone','agent',100,true)`,
    [randomUUID(), funding],
  );
  await t.test(
    "approval requires verified funding; collection confirmation precedes exactly one payout",
    async () => {
      assert.equal(
        (
          await call("main", "post", `/requests/${row.id}/accept`, {
            expectedVersion: 1,
          })
        ).body.error.code,
        "FUNDING_UNAVAILABLE",
      );
      await refreshFunding(db, funding, providers);
      await accept(row);
      assert.equal((await current(row.id)).reservation.amountTzs, "10100");
      await runPaymentOnce(db, providers);
      assert.equal(sends.length, 1);
      assert.equal(sends[0].source.identifier, "+255700000001");
      assert.equal(
        await task(row.id, "payout"),
        undefined,
        "submission response cannot authorize payout",
      );
      await due();
      await runPaymentOnce(db, providers);
      assert.ok(await task(row.id, "payout"));
      assert.equal(sends.length, 1);
      await runPaymentOnce(db, providers);
      assert.equal(sends.length, 2);
      assert.equal(sends[1].destination.identifier, "0012345");
      await due();
      await runPaymentOnce(db, providers);
      assert.equal((await current(row.id)).status, "completed");
      assert.equal((await current(row.id)).reservation.status, "consumed");
      await runPaymentOnce(db, providers);
      assert.equal(sends.length, 2);
      const pool = (
        await db.query("SELECT * FROM ss_v1.payment_funding WHERE id=$1", [
          funding,
        ])
      ).rows[0];
      assert.equal(String(pool.held_tzs), "0");
      assert.equal(String(pool.balance_tzs), "989900");
    },
  );
  await t.test(
    "raw authenticated callback wakes lookup; duplicate events and late callbacks do not pay twice",
    async () => {
      const c = await task(row.id);
      const proof = { eventId: "event-1", reference: c.id, scope: c.scope };
      const body = JSON.stringify(proof);
      const url = "/api/v1/payment-events/testOnly";
      assert.equal(
        (
          await request(app)
            .post(url)
            .set("Content-Type", "application/json")
            .send(body)
        ).status,
        401,
      );
      const signature = createHmac("sha256", "test-only-key")
        .update(body)
        .digest("hex");
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await request(app)
              .post(url)
              .set("Content-Type", "application/json")
              .set("x-test-signature", signature)
              .send(body)
          ).status,
          202,
        );
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM ss_v1.payment_webhooks"))
          .rows[0].n,
        1,
      );
      await runPaymentOnce(db, providers);
      assert.equal(sends.length, 2);
      assert.equal((await current(row.id)).status, "completed");
    },
  );
  await t.test(
    "crash after dispatch commitment only looks up; stale worker cannot finalize",
    async () => {
      const r = await create();
      await accept(r);
      const old = await claimPayment(db, providers);
      assert.equal(old.lookupOnly, false);
      await db.query(
        "UPDATE ss_v1.payment_tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [old.id],
      );
      const replacement = await claimPayment(db, providers);
      assert.equal(replacement.lookupOnly, true);
      assert.equal(await finishPayment(db, old, {}), false);
      await finishPayment(db, replacement, {
        verified: false,
        status: "not_found",
      });
      assert.equal(sends.length, 2);
      assert.equal((await current(r.id)).status, "needs_attention");
      assert.equal((await current(r.id)).reservation.status, "held");
      assert.equal(await task(r.id, "payout"), undefined);
      assert.equal(
        (
          await call("sub", "post", `/requests/${r.id}/cancel`, {
            expectedVersion: (await current(r.id)).version,
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "collection mismatch cannot trigger payout and payout failure retains funding",
    async () => {
      const r = await create();
      await accept(r);
      await runPaymentOnce(db, providers);
      const c = await task(r.id);
      const input = inputs.get(c.id);
      observations.set(c.id, {
        ...(await provider.lookup(input)),
        amountTzs: "999",
      });
      await due();
      await runPaymentOnce(db, providers);
      assert.equal((await current(r.id)).status, "needs_attention");
      assert.equal(await task(r.id, "payout"), undefined);
      const r2 = await create();
      await accept(r2);
      await runPaymentOnce(db, providers);
      await due();
      await runPaymentOnce(db, providers);
      await runPaymentOnce(db, providers);
      const p = await task(r2.id, "payout");
      observations.set(p.id, {
        ...(await provider.lookup(inputs.get(p.id))),
        status: "failed",
      });
      await due();
      await runPaymentOnce(db, providers);
      assert.equal((await current(r2.id)).status, "needs_attention");
      assert.equal((await current(r2.id)).reservation.status, "held");
    },
  );
  await t.test(
    "insufficient capacity cannot oversubscribe and cancellation before dispatch releases hold",
    async () => {
      const r = await create({ ...payload, amountTzs: "999999" });
      assert.equal(
        (
          await call("main", "post", `/requests/${r.id}/accept`, {
            expectedVersion: 1,
          })
        ).body.error.code,
        "FUNDING_UNAVAILABLE",
      );
      const c = await create();
      const accepted = await accept(c);
      const before = BigInt(
        (
          await db.query(
            "SELECT held_tzs FROM ss_v1.payment_funding WHERE id=$1",
            [funding],
          )
        ).rows[0].held_tzs,
      );
      assert.equal(
        (
          await call("sub", "post", `/requests/${c.id}/cancel`, {
            expectedVersion: accepted.version,
          })
        ).status,
        200,
      );
      assert.equal(
        BigInt(
          (
            await db.query(
              "SELECT held_tzs FROM ss_v1.payment_funding WHERE id=$1",
              [funding],
            )
          ).rows[0].held_tzs,
        ),
        before - 10100n,
      );
      await assert.rejects(
        refreshFunding(db, funding, providers),
        (e) => e.code === "FUNDING_BUSY",
      );
    },
  );
});
