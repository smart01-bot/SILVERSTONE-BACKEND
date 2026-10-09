import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID, randomBytes } from "node:crypto";
import { embeddedDatabase } from "../../scripts/embedded.js";
import { seedSynthetic, syntheticPassword } from "../../scripts/fixtures.js";
import { seedExchangeFixtures } from "../../scripts/exchange-fixtures.js";
import { seedOperationsFixtures } from "../../scripts/operations-fixtures.js";
import { migrate } from "../../foundation/migrate.js";
import { createApp } from "../../foundation/app.js";
import {
  claimExchangeJob,
  finishExchangeJob,
} from "../../foundation/exchanges.js";
import { embeddedBackup, decryptBackup } from "../../scripts/backup.js";
async function setup(t) {
  const db = await embeddedDatabase();
  t.after(() => db.close());
  await migrate(db);
  const f = await seedSynthetic(db),
    accounts = await seedExchangeFixtures(db, f),
    app = createApp({
      db,
      secret: "phase6-local-synthetic-secret-at-least-32",
      rateLimit: 1000,
    });
  const tokens = {};
  for (const name of ["main", "other-main", "sub", "pending"]) {
    const r = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: f[name].email, password: syntheticPassword });
    tokens[name] = r.body.data.accessToken;
  }
  const call = (who, method, path, body, key = randomUUID()) =>
    request(app)
      [method]("/api/v1" + path)
      .set("Authorization", "Bearer " + tokens[who])
      .set("Idempotency-Key", key)
      .send(body);
  const payload = {
    sourceAccountId: accounts.sub.vodacom,
    destinationAccountId: accounts.sub.airtel,
    amountTzs: "100",
    currency: "TZS",
  };
  const create = async () => {
    const r = await call("sub", "post", "/requests", payload);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data;
  };
  const accept = async (row) => {
    const r = await call("main", "post", `/requests/${row.id}/accept`, {
      expectedVersion: 1,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  const base = "/operations/scopes/" + f.main.id;
  return { db, f, accounts, app, tokens, call, payload, create, accept, base };
}
test("explicit scoped grants, assigned exception ownership, deadlines, audit and immutable evidence", async (t) => {
  const x = await setup(t);
  const { db, f, call, base } = x;
  assert.deepEqual(
    (await call("main", "get", "/operations/scopes")).body.data,
    [],
  );
  assert.equal((await call("main", "get", base + "/cases")).status, 404);
  await seedOperationsFixtures(db, f);
  const row = await x.create();
  await x.accept(row);
  await finishExchangeJob(db, await claimExchangeJob(db), "unknown");
  const cases = await call("main", "get", base + "/cases");
  assert.equal(cases.status, 200);
  assert.equal(cases.body.data[0].ownerId, null);
  const dueAt = new Date(Date.now() + 60000).toISOString(),
    assignment = {
      expectedVersion: 0,
      ownerId: f.main.id,
      backupId: f["other-main"].id,
      dueAt,
      reason: "Synthetic incident responsibility",
    };
  const assigned = await call(
    "main",
    "post",
    base + `/cases/${row.id}/assign`,
    assignment,
  );
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(
    (await call("main", "post", base + `/cases/${row.id}/assign`, assignment))
      .status,
    409,
  );
  assert.equal((await call("other-main", "get", base + "/cases")).status, 200);
  assert.equal((await call("other-main", "get", base + "/audit")).status, 404);
  assert.equal(
    (
      await call(
        "main",
        "get",
        "/operations/scopes/" + f["other-main"].id + "/cases",
      )
    ).status,
    404,
  );
  assert.equal((await call("pending", "get", base + "/cases")).status, 403);
  await db.query(
    "UPDATE ss_v1.exception_cases SET due_at=clock_timestamp()-interval '1 second' WHERE request_id=$1",
    [row.id],
  );
  assert.equal(
    (await call("main", "get", base + "/cases")).body.data[0].escalationDue,
    true,
  );
  const diagnostics = (await call("main", "get", base + "/diagnostics")).body
    .data;
  assert.equal(diagnostics.escalationDueCount, 1);
  assert.equal(diagnostics.reservedCapacityTzs, "100");
  assert.equal(diagnostics.financialLedgerAvailable, false);
  const detail = (await call("main", "get", base + `/cases/${row.id}/evidence`))
    .body.data;
  const leg = detail.legs.find((l) => l.type === "origin_in");
  const body = {
    legId: leg.id,
    source: "submitted_statement",
    reference: "synthetic-reference-1",
    amountTzs: "100",
    currency: "TZS",
    fromAccountId: x.accounts.sub.vodacom,
    toAccountId: x.accounts.main.vodacom,
    observedAt: new Date(Date.now() - 1000).toISOString(),
    reason: "Unverified statement comparison",
  };
  const evidence = await call(
    "main",
    "post",
    base + `/cases/${row.id}/evidence`,
    body,
  );
  assert.equal(evidence.status, 200, JSON.stringify(evidence.body));
  assert.equal(evidence.body.data.matchesTerms, true);
  assert.equal(evidence.body.data.actualSettlementVerified, false);
  assert.deepEqual(
    (await call("main", "post", base + `/cases/${row.id}/evidence`, body)).body,
    evidence.body,
  );
  assert.equal(
    (
      await call("main", "post", base + `/cases/${row.id}/evidence`, {
        ...body,
        amountTzs: "101",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("main", "post", base + `/cases/${row.id}/evidence`, {
        ...body,
        reference: "synthetic-reference-2",
        amountTzs: "101",
      })
    ).body.data.matchesTerms,
    false,
  );
  assert.equal(
    (await call("main", "get", `/requests/${row.id}`)).body.data.reservation
      .status,
    "held",
  );
  assert.equal(
    (await call("main", "get", base + "/audit")).body.data.length,
    3,
  );
  await assert.rejects(
    db.query("UPDATE ss_v1.operations_events SET reason='tampered'"),
    { code: "23514" },
  );
  await assert.rejects(
    db.query("DELETE FROM ss_v1.reconciliation_observations"),
    { code: "23514" },
  );
  await db.query(
    "UPDATE ss_v1.operations_grants SET revoked_at=now() WHERE actor_id=$1 AND capability='audit.read'",
    [f.main.id],
  );
  assert.equal((await call("main", "get", base + "/audit")).status, 404);
  await db.query(
    "UPDATE ss_v1.agents SET account_status='suspended' WHERE id=$1",
    [f.main.id],
  );
  assert.equal((await call("main", "get", base + "/cases")).status, 403);
  const backupView = await call("other-main", "get", base + "/cases");
  assert.equal(backupView.status, 200);
  assert.equal(backupView.body.data[0].ownerAvailable, false);
  assert.equal(backupView.body.data[0].backupAvailable, true);
  assert.equal(
    (await call("other-main", "get", base + "/diagnostics")).body.data
      .unassignedCount,
    1,
  );

  assert.equal(
    (
      await db.query(
        "SELECT status FROM ss_v1.exchange_reservations WHERE request_id=$1",
        [row.id],
      )
    ).rows[0].status,
    "held",
  );
});
test("scoped pause fences new work and preparation without losing replay, holds or cancellation", async (t) => {
  const x = await setup(t),
    { db, f, call, base } = x;
  await seedOperationsFixtures(db, f);
  const row = await x.create();
  await x.accept(row);
  const pending = await x.create();
  const flags = {
    expectedVersion: 0,
    requestsPaused: true,
    acceptancePaused: true,
    preparationPaused: true,
    reason: "Isolated pause drill",
  };
  assert.equal(
    (await call("main", "post", base + "/controls", flags)).status,
    200,
  );
  assert.equal(
    (await call("main", "post", base + "/controls", flags)).status,
    409,
  );
  assert.equal((await call("sub", "post", "/requests", x.payload)).status, 423);
  assert.equal(
    (
      await call("main", "post", `/requests/${pending.id}/accept`, {
        expectedVersion: 1,
      })
    ).status,
    423,
  );
  assert.equal(await claimExchangeJob(db), null);
  assert.equal((await call("sub", "get", `/requests/${row.id}`)).status, 200);
  assert.equal(
    (
      await call("sub", "post", `/requests/${pending.id}/cancel`, {
        expectedVersion: 1,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await db.query(
        "SELECT status FROM ss_v1.exchange_reservations WHERE request_id=$1",
        [row.id],
      )
    ).rows[0].status,
    "held",
  );
  assert.equal(
    (
      await call("main", "post", base + "/controls", {
        ...flags,
        expectedVersion: 1,
        requestsPaused: false,
        acceptancePaused: false,
        preparationPaused: false,
        reason: "Resume synthetic preparation only",
      })
    ).status,
    200,
  );
  const claim = await claimExchangeJob(db);
  assert.equal(claim.requestId, row.id);
  await finishExchangeJob(db, claim, "unknown");
  assert.equal(await claimExchangeJob(db), null);
});
test("encrypted disk-ready snapshot rejects wrong keys/corruption and preserves operations, private documents and uncertainty", async (t) => {
  const x = await setup(t);
  await seedOperationsFixtures(x.db, x.f);
  const row = await x.create();
  await x.accept(row);
  await finishExchangeJob(x.db, await claimExchangeJob(x.db), "unknown");
  const doc = randomUUID(),
    bytesPrivate = Buffer.from("synthetic private evidence bytes");
  await x.db.query(
    "INSERT INTO ss_v1.documents(id,agent_id,kind,name,mime,size,sha256,content) VALUES($1,$2,'tin','synthetic.png','image/png',$3,'synthetic-private-hash',$4)",
    [doc, x.f.sub.id, bytesPrivate.length, bytesPrivate],
  );
  await x.db.query(
    "INSERT INTO ss_v1.document_access_events(id,document_id,actor_id) VALUES($1,$2,$3)",
    [randomUUID(), doc, x.f.sub.id],
  );
  await assert.rejects(x.db.query("DELETE FROM ss_v1.document_access_events"), {
    code: "23514",
  });
  const key = randomBytes(32),
    archive = await embeddedBackup(x.db, key);
  assert.throws(
    () => decryptBackup(archive, randomBytes(32)),
    /authentication/,
  );
  const corrupt = Buffer.from(archive);
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => decryptBackup(corrupt, key), /authentication/);
  const { bytes, manifest } = decryptBackup(archive, key);
  assert.equal(manifest.migrations.length, 5);
  const restored = await embeddedDatabase({ snapshot: new Blob([bytes]) });
  t.after(() => restored.close());
  await migrate(restored);
  assert.equal(
    (
      await restored.query(
        "SELECT count(*)::int n FROM ss_v1.operations_grants",
      )
    ).rows[0].n,
    8,
  );
  assert.equal(
    (
      await restored.query(
        "SELECT status FROM ss_v1.exchange_reservations WHERE request_id=$1",
        [row.id],
      )
    ).rows[0].status,
    "held",
  );
  assert.deepEqual(
    Buffer.from(
      (
        await restored.query(
          "SELECT content FROM ss_v1.documents WHERE id=$1",
          [doc],
        )
      ).rows[0].content,
    ),
    bytesPrivate,
  );
  assert.equal(
    (
      await restored.query(
        "SELECT count(*)::int n FROM ss_v1.document_access_events",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(await claimExchangeJob(restored), null);
  await assert.rejects(
    embeddedBackup({ syntheticOnly: false }, key),
    /synthetic/,
  );
});
