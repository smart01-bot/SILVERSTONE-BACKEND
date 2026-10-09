import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { embeddedDatabase } from "../../scripts/embedded.js";
import { syntheticEvidenceHarness } from "../../scripts/synthetic-provider-evidence.js";
import { migrate } from "../../foundation/migrate.js";
import { createApp } from "../../foundation/app.js";
import { disabledProvider } from "../../foundation/provider-boundary.js";
import { seedSynthetic, syntheticPassword } from "../../scripts/fixtures.js";
import { seedExchangeFixtures } from "../../scripts/exchange-fixtures.js";
import {
  claimExchangeJob,
  finishExchangeJob,
} from "../../foundation/exchanges.js";

async function fixture(t) {
  const db = await embeddedDatabase();
  t.after(() => db.close());
  await migrate(db);
  const f = await seedSynthetic(db),
    accounts = await seedExchangeFixtures(db, f);
  const app = createApp({
    db,
    secret: "synthetic-provider-tests-secret-at-least32",
    rateLimit: 1000,
  });
  const tokens = {};
  for (const who of ["sub", "main", "other-main", "pending"])
    tokens[who] = (
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: f[who].email, password: syntheticPassword })
    ).body.data.accessToken;
  const call = (who, method, path, body) =>
    request(app)
      [method]("/api/v1" + path)
      .set("Authorization", "Bearer " + tokens[who])
      .set("Idempotency-Key", randomUUID())
      .send(body);
  const harness = syntheticEvidenceHarness(db);
  async function prepare() {
    const created = await call("sub", "post", "/requests", {
      sourceAccountId: accounts.sub.vodacom,
      destinationAccountId: accounts.sub.airtel,
      amountTzs: "100",
      currency: "TZS",
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const r = created.body.data;
    assert.equal(
      (
        await call("main", "post", `/requests/${r.id}/accept`, {
          expectedVersion: 1,
        })
      ).status,
      200,
    );
    const claim = await claimExchangeJob(db);
    return { r, claim };
  }
  const event = (a, status = "acknowledged", override = {}) => ({
    provider: "synthetic_fixture",
    scope: "embedded_test",
    eventKey: randomUUID(),
    reference: a.reference,
    requestId: a.request_id,
    legId: a.leg_id,
    amountTzs: String(a.amount_tzs),
    currency: a.currency,
    networkCode: a.network_code,
    fromAccountId: a.from_account_id,
    toAccountId: a.to_account_id,
    status,
    ...override,
  });
  return { db, f, app, call, harness, prepare, event };
}

test("provider boundary and synthetic evidence invariants (embedded, no external protocol)", async (t) => {
  const { db, f, app, call, harness, prepare, event } = await fixture(t);
  let a, firstClaim;
  await t.test(
    "no enabled transport or callback, regardless of app authentication or forged headers",
    async () => {
      assert.throws(() => syntheticEvidenceHarness({}), /Embedded synthetic/);
      for (const op of [
        "collect",
        "payout",
        "lookup",
        "reverse",
        "verifyCallback",
      ])
        await assert.rejects(disabledProvider[op]({}), {
          code: "PROVIDER_UNCONFIGURED",
        });
      for (const token of [null, "forged-token"]) {
        let req = request(app)
          .post("/api/v1/provider-events/synthetic_fixture")
          .set("Digest", "forged");
        if (token) req = req.set("Authorization", "Bearer " + token);
        const r = await req.send({ status: "confirmed" });
        assert.equal(r.status, 503);
        assert.equal(r.body.error.code, "PROVIDER_UNCONFIGURED");
      }
      const p = (await call("sub", "get", "/provider-status")).body.data;
      assert.equal(p.executionEnabled, false);
      assert.equal(p.callbackEnabled, false);
      assert.deepEqual(p.providerFees, { status: "unknown", amountTzs: null });
      assert.equal(
        (await call("pending", "get", "/provider-status")).status,
        403,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM ss_v1.provider_event_inbox",
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "attempt requires current lease; duplicate claim use cannot create another attempt",
    async () => {
      const { claim } = await prepare();
      await db.query(
        "UPDATE ss_v1.exchange_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [claim.id],
      );
      await assert.rejects(harness.prepare(claim), { code: "STALE_CLAIM" });
      firstClaim = await claimExchangeJob(db);
      await assert.rejects(harness.prepare(claim), { code: "STALE_CLAIM" });
      a = await harness.prepare(firstClaim);
      await assert.rejects(harness.prepare(firstClaim), {
        code: "STALE_CLAIM",
      });
      await assert.rejects(finishExchangeJob(db, firstClaim, "retry"), {
        code: "STALE_CLAIM",
      });
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM ss_v1.provider_attempts"))
          .rows[0].n,
        1,
      );
      assert.equal(a.reference, a.idempotency_key);
    },
  );
  await t.test(
    "timeout/crash after preparation retains unknown hold and cannot requeue or cancel",
    async () => {
      // Recreate the service without delivering any response/event.
      syntheticEvidenceHarness(db);
      assert.equal(await claimExchangeJob(db), null);
      const r = (await call("sub", "get", "/requests/" + a.request_id)).body
        .data;
      assert.equal(r.status, "needs_attention");
      assert.equal(r.reservation.status, "held");
      assert.equal(r.providerEvidence[0].evidenceStatus, "unknown");
      assert.equal(r.providerEvidence[0].actualSettlementVerified, false);
      assert.equal(
        (
          await call("sub", "post", `/requests/${r.id}/cancel`, {
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
            `/requests/${r.id}/manual-confirmations`,
            {},
          )
        ).status,
        503,
      );
      assert.equal(
        (await call("other-main", "get", "/requests/" + r.id)).status,
        404,
      );
      assert.equal("claimToken" in r.providerEvidence[0], false);
    },
  );
  await t.test(
    "duplicate intake persists one immutable event; changed payload with same key conflicts",
    async () => {
      const e = event(a);
      const ids = await Promise.all(
        Array.from({ length: 5 }, () => harness.receive(e)),
      );
      assert.equal(new Set(ids).size, 1);
      await assert.rejects(harness.receive({ ...e, status: "confirmed" }), {
        code: "EVENT_KEY_CONFLICT",
      });
      const fresh = syntheticEvidenceHarness(db);
      const results = await Promise.all(ids.map((id) => fresh.apply(id)));
      assert.ok(results.every((r) => r.disposition === "applied"));
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM ss_v1.provider_event_results",
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await db.query(
            "SELECT status FROM ss_v1.transaction_legs WHERE id=$1",
            [a.leg_id],
          )
        ).rows[0].status,
        "unknown",
      );
    },
  );
  await t.test(
    "wrong scope, amount, currency, network, accounts, request, leg and reference cannot apply",
    async () => {
      for (const delta of [
        { scope: "production" },
        { provider: "real_provider" },
      ])
        await assert.rejects(harness.receive(event(a, "confirmed", delta)), {
          code: "INVALID_INPUT",
        });
      for (const delta of [
        { amountTzs: "101" },
        { currency: "USD" },
        { networkCode: "airtel" },
        { fromAccountId: randomUUID() },
        { toAccountId: randomUUID() },
        { requestId: randomUUID() },
        { legId: randomUUID() },
        { reference: "missing" },
      ]) {
        const id = await harness.receive(event(a, "confirmed", delta));
        assert.equal((await harness.apply(id)).disposition, "rejected");
      }
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM ss_v1.provider_evidence_effects",
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "event result, state, history and effect roll back together on failure, then retry once",
    async () => {
      const id = await harness.receive(event(a, "confirmed"));
      const broken = {
        ...db,
        transaction: (fn) =>
          db.transaction((tx) =>
            fn({
              query: async (sql, values) => {
                if (sql.startsWith("INSERT INTO ss_v1.provider_event_results"))
                  throw Error("injected commit-path failure");
                return tx.query(sql, values);
              },
            }),
          ),
      };
      await assert.rejects(
        syntheticEvidenceHarness(broken).apply(id),
        /injected/,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM ss_v1.provider_event_results WHERE event_id=$1",
            [id],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM ss_v1.provider_evidence_effects",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(
            "SELECT status FROM ss_v1.provider_evidence_state WHERE attempt_id=$1",
            [a.id],
          )
        ).rows[0].status,
        "acknowledged",
      );
      assert.equal((await harness.apply(id)).disposition, "applied");
      await harness.apply(id);
      const more = await Promise.all(
        Array.from({ length: 4 }, () => harness.receive(event(a, "confirmed"))),
      );
      await Promise.all(more.map((id) => harness.apply(id)));
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM ss_v1.provider_evidence_effects WHERE effect='synthetic_confirmation'",
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "acknowledgements/timeouts cannot regress confirmation; contradictory failure needs review",
    async () => {
      for (const status of ["acknowledged", "unknown"])
        assert.equal(
          (await harness.apply(await harness.receive(event(a, status))))
            .disposition,
          "ignored",
        );
      assert.equal(
        (await harness.apply(await harness.receive(event(a, "failed"))))
          .disposition,
        "conflict",
      );
      const r = (await call("main", "get", "/requests/" + a.request_id)).body
        .data;
      assert.equal(r.providerEvidence[0].evidenceStatus, "confirmed");
      assert.equal(r.providerEvidence[0].reconciliationRequired, true);
      assert.equal(r.status, "needs_attention");
      assert.equal(r.reservation.status, "held");
      assert.ok(r.legs.every((l) => l.status !== "confirmed"));
    },
  );
  await t.test(
    "reversal is append-only, once per attempt; late confirmations never undo it",
    async () => {
      const ids = await Promise.all([
        harness.receive(event(a, "reversed")),
        harness.receive(event(a, "reversed")),
      ]);
      await Promise.all(ids.map((id) => harness.apply(id)));
      await harness.apply(await harness.receive(event(a, "confirmed")));
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM ss_v1.provider_evidence_effects WHERE effect='synthetic_reversal'",
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await db.query(
            "SELECT status FROM ss_v1.provider_evidence_state WHERE attempt_id=$1",
            [a.id],
          )
        ).rows[0].status,
        "reversed",
      );
      assert.equal(
        (await call("sub", "get", "/requests/" + a.request_id)).body.data
          .reservation.status,
        "held",
      );
      for (const table of [
        "provider_attempts",
        "provider_event_inbox",
        "provider_event_results",
        "provider_evidence_effects",
      ])
        await assert.rejects(
          db.query("DELETE FROM ss_v1." + table),
          /Immutable/,
        );
      await assert.rejects(
        db.query(
          "UPDATE ss_v1.provider_attempts SET reference='changed' WHERE id=$1",
          [a.id],
        ),
        /Immutable/,
      );
    },
  );
  await t.test(
    "reversal arriving before confirmation remains reversal without fabricated confirmation",
    async () => {
      const { claim } = await prepare(),
        b = await harness.prepare(claim);
      for (const status of ["reversed", "confirmed", "acknowledged"])
        await harness.apply(await harness.receive(event(b, status)));
      const effects = (
        await db.query(
          "SELECT effect FROM ss_v1.provider_evidence_effects WHERE attempt_id=$1",
          [b.id],
        )
      ).rows;
      assert.deepEqual(
        effects.map((r) => r.effect),
        ["synthetic_reversal"],
      );
    },
  );
  await t.test(
    "failure is distinct from unknown and does not authorize another attempt or release",
    async () => {
      const { claim } = await prepare(),
        b = await harness.prepare(claim);
      await harness.apply(await harness.receive(event(b, "failed")));
      assert.equal(
        (await harness.apply(await harness.receive(event(b, "confirmed"))))
          .disposition,
        "conflict",
      );
      const r = (await call("sub", "get", "/requests/" + b.request_id)).body
        .data;
      assert.equal(r.providerEvidence[0].evidenceStatus, "failed");
      assert.equal(r.reservation.status, "held");
      assert.equal(await claimExchangeJob(db), null);
    },
  );
  await t.test(
    "timeout after acknowledgement retains the same reference and reservation",
    async () => {
      const { claim } = await prepare(),
        b = await harness.prepare(claim);
      await harness.apply(await harness.receive(event(b, "acknowledged")));
      await harness.apply(await harness.receive(event(b, "unknown")));
      const r = (await call("sub", "get", "/requests/" + b.request_id)).body
        .data;
      assert.equal(r.providerEvidence[0].evidenceStatus, "unknown");
      assert.equal(r.providerEvidence[0].reference, b.reference);
      assert.equal(r.reservation.status, "held");
      assert.equal(await claimExchangeJob(db), null);
      await assert.rejects(harness.prepare(claim), { code: "STALE_CLAIM" });
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM ss_v1.provider_attempts WHERE leg_id=$1",
            [b.leg_id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "suspension after claim blocks synthetic preparation without consuming the claim",
    async () => {
      const { claim } = await prepare();
      await db.query(
        "UPDATE ss_v1.agents SET account_status='suspended' WHERE id=$1",
        [f.sub.id],
      );
      await assert.rejects(harness.prepare(claim), {
        code: "ATTEMPT_INELIGIBLE",
      });
      assert.equal(
        (
          await db.query("SELECT status FROM ss_v1.exchange_jobs WHERE id=$1", [
            claim.id,
          ])
        ).rows[0].status,
        "claimed",
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM ss_v1.provider_attempts WHERE request_id=$1",
            [claim.requestId],
          )
        ).rows[0].n,
        0,
      );
    },
  );
});

test("Phase 4 additive upgrade preserves every populated Phase 3 table and migration checksum", async (t) => {
  const db = await embeddedDatabase();
  t.after(() => db.close());
  await db.query(
    "CREATE SCHEMA ss_v1; CREATE TABLE ss_v1.schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of [
    "001-foundation.sql",
    "002-onboarding.sql",
    "003-exchanges.sql",
  ]) {
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
    a = await seedExchangeFixtures(db, f),
    id = randomUUID();
  await db.query(
    `INSERT INTO ss_v1.transfer_requests(id,sub_agent_id,main_agent_id,source_network,destination_network,amount_tzs,status,source_account_id,destination_account_id,collection_account_id,payout_account_id,account_snapshot)
    VALUES($1,$2,$3,'vodacom','airtel',100,'awaiting_source',$4,$5,$6,$7,'{}')`,
    [
      id,
      f.sub.id,
      f.main.id,
      a.sub.vodacom,
      a.sub.airtel,
      a.main.vodacom,
      a.main.airtel,
    ],
  );
  await db.query(
    "INSERT INTO ss_v1.transaction_legs(id,request_id,leg_type) VALUES($1,$2,'origin_in'),($3,$2,'destination_out')",
    [randomUUID(), id, randomUUID()],
  );
  await db.query(
    "UPDATE ss_v1.exchange_capacity SET held_tzs=100 WHERE account_id=$1",
    [a.main.airtel],
  );
  await db.query(
    "INSERT INTO ss_v1.exchange_reservations(request_id,account_id,amount_tzs,status) VALUES($1,$2,100,'held')",
    [id, a.main.airtel],
  );
  await db.query(
    "INSERT INTO ss_v1.exchange_jobs(id,request_id,kind,status) VALUES($1,$2,'prepare_collection','ready')",
    [randomUUID(), id],
  );
  await db.query(
    "INSERT INTO ss_v1.exchange_history(request_id,event,reason) VALUES($1,'accept','Synthetic fixture')",
    [id],
  );
  await db.query(
    "INSERT INTO ss_v1.exchange_commands(actor_id,operation,key,payload_hash,response) VALUES($1,'accept','test-key','hash','{}')",
    [f.main.id],
  );
  const tables = (
    await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='ss_v1' AND tablename<>'schema_migrations' ORDER BY tablename",
    )
  ).rows.map((r) => r.tablename);
  const snapshots = {};
  for (const table of tables)
    snapshots[table] = (
      await db.query(
        "SELECT row_to_json(t)::text value FROM ss_v1." +
          table +
          " t ORDER BY row_to_json(t)::text",
      )
    ).rows;
  const checksums = (
    await db.query(
      "SELECT name,checksum FROM ss_v1.schema_migrations ORDER BY name",
    )
  ).rows;
  await migrate(db);
  await migrate(db);
  for (const table of tables)
    assert.deepEqual(
      (
        await db.query(
          "SELECT row_to_json(t)::text value FROM ss_v1." +
            table +
            " t ORDER BY row_to_json(t)::text",
        )
      ).rows,
      snapshots[table],
      table,
    );
  assert.deepEqual(
    (
      await db.query(
        "SELECT name,checksum FROM ss_v1.schema_migrations ORDER BY name",
      )
    ).rows.slice(0, 3),
    checksums,
  );
});
