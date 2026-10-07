import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { embeddedDatabase } from "./embedded.js";
import { migrate } from "../foundation/migrate.js";
import { createApp } from "../foundation/app.js";
import { seedSynthetic, syntheticPassword } from "./fixtures.js";
import { seedExchangeFixtures } from "./exchange-fixtures.js";
import { seedOperationsFixtures } from "./operations-fixtures.js";
import {
  claimExchangeJob,
  finishExchangeJob,
} from "../foundation/exchanges.js";
if (!process.env.SILVERSTONE_FRONTEND_PATH)
  throw new Error("Set SILVERSTONE_FRONTEND_PATH.");
const load = (p) =>
  import(pathToFileURL(resolve(process.env.SILVERSTONE_FRONTEND_PATH, p)));
const { createApiClient } = await load("src/api/client.js"),
  { createOperationsClient } = await load("src/api/operationsClient.js");
const db = await embeddedDatabase();
await migrate(db);
const f = await seedSynthetic(db),
  accounts = await seedExchangeFixtures(db, f);
const server = createApp({
  db,
  secret: "phase6-actual-client-synthetic-secret-at-least32",
  rateLimit: 1000,
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
try {
  const storage = new Map(),
    client = createApiClient({
      baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
      storage: {
        getItem: async (k) => storage.get(k),
        setItem: async (k, v) => storage.set(k, v),
        removeItem: async (k) => storage.delete(k),
      },
    }),
    ops = createOperationsClient(client);
  await client.login(f.sub.email, syntheticPassword);
  const payload = {
    sourceAccountId: accounts.sub.vodacom,
    destinationAccountId: accounts.sub.airtel,
    amountTzs: "100",
    currency: "TZS",
  };
  const row = await client.call("/requests", {
    method: "POST",
    body: payload,
    headers: { "Idempotency-Key": randomUUID() },
  });
  await client.login(f.main.email, syntheticPassword);
  assert.deepEqual(await ops.scopes(), []);
  await seedOperationsFixtures(db, f);
  await client.call(`/requests/${row.id}/accept`, {
    method: "POST",
    body: { expectedVersion: 1 },
    headers: { "Idempotency-Key": randomUUID() },
  });
  await finishExchangeJob(db, await claimExchangeJob(db), "unknown");
  assert.equal((await ops.cases(f.main.id)).length, 1);
  assert.equal((await ops.diagnostics(f.main.id)).unassignedCount, 1);
  const assigned = await ops.assign(f.main.id, row.id, {
    expectedVersion: 0,
    ownerId: f.main.id,
    backupId: f["other-main"].id,
    dueAt: new Date(Date.now() + 60000).toISOString(),
    reason: "Synthetic actual-client assignment",
  });
  assert.equal(assigned.version, 1);
  const detail = await ops.evidence(f.main.id, row.id),
    origin = detail.legs.find((l) => l.type === "origin_in");
  const observed = await ops.recordEvidence(f.main.id, row.id, {
    legId: origin.id,
    source: "synthetic_fixture",
    reference: "synthetic-client-reference",
    amountTzs: "100",
    currency: "TZS",
    fromAccountId: accounts.sub.vodacom,
    toAccountId: accounts.main.vodacom,
    observedAt: new Date(Date.now() - 1000).toISOString(),
    reason: "Synthetic terms comparison",
  });
  assert.equal(observed.matchesTerms, true);
  assert.equal(observed.actualSettlementVerified, false);
  assert.equal((await ops.audit(f.main.id)).length, 2);
  await ops.saveControls(f.main.id, {
    expectedVersion: 0,
    requestsPaused: true,
    acceptancePaused: true,
    preparationPaused: true,
    reason: "Synthetic client pause",
  });
  await client.login(f.sub.email, syntheticPassword);
  await assert.rejects(
    client.call("/requests", {
      method: "POST",
      body: payload,
      headers: { "Idempotency-Key": randomUUID() },
    }),
    { status: 423, code: "OPERATIONS_PAUSED" },
  );
  assert.equal(
    (await client.call(`/requests/${row.id}`)).reservation.status,
    "held",
  );
  await client.login(f["other-main"].email, syntheticPassword);
  assert.equal((await ops.cases(f.main.id))[0].backupId, f["other-main"].id);
  await assert.rejects(ops.audit(f.main.id), { status: 404 });
  console.log(
    "PASS: actual frontend operations client over local HTTP: explicit grants, assigned owner/backup, unverified evidence, scoped audit, pause denial and retained hold; no payment.",
  );
} finally {
  await new Promise((r) => server.close(r));
  await db.close();
}
