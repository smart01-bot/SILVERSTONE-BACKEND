import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { embeddedDatabase } from "./embedded.js";
import { migrate } from "../foundation/migrate.js";
import { createApp } from "../foundation/app.js";
import { seedSynthetic, syntheticPassword } from "./fixtures.js";
import { seedExchangeFixtures } from "./exchange-fixtures.js";
import { claimExchangeJob } from "../foundation/exchanges.js";
import { syntheticEvidenceHarness } from "./synthetic-provider-evidence.js";
if (!process.env.SILVERSTONE_FRONTEND_PATH)
  throw Error("Set SILVERSTONE_FRONTEND_PATH.");
const load = (p) =>
  import(pathToFileURL(resolve(process.env.SILVERSTONE_FRONTEND_PATH, p)));
const { createApiClient } = await load("src/api/client.js");
const { requestView } = await load("src/api/presentation.js");
const { providerChargeLabel, providerEvidenceLabel } = await load(
  "src/api/providerEvidence.js",
);
const db = await embeddedDatabase();
await migrate(db);
const fixtures = await seedSynthetic(db);
const accounts = await seedExchangeFixtures(db, fixtures);
const server = createApp({
  db,
  secret: "synthetic-provider-http-secret-at-least32",
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
try {
  const storage = new Map();
  const client = createApiClient({
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    storage: {
      getItem: async (k) => storage.get(k) || null,
      setItem: async (k, v) => storage.set(k, v),
      removeItem: async (k) => storage.delete(k),
    },
  });
  await client.login("sub@example.test", syntheticPassword);
  const created = await client.call("/requests", {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: {
      sourceAccountId: accounts.sub.vodacom,
      destinationAccountId: accounts.sub.airtel,
      amountTzs: "100",
      currency: "TZS",
    },
  });
  await client.login("main@example.test", syntheticPassword);
  await client.call(`/requests/${created.id}/accept`, {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: { expectedVersion: 1 },
  });
  const h = syntheticEvidenceHarness(db),
    a = await h.prepare(await claimExchangeJob(db));
  const id = await h.receive({
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
    status: "confirmed",
  });
  await h.apply(id);
  await h.apply(id);
  for (const email of ["main@example.test", "sub@example.test"]) {
    await client.login(email, syntheticPassword);
    const row = requestView(await client.call("/requests/" + created.id));
    assert.equal(row.status, "needs_attention");
    assert.equal(row.reservation.status, "held");
    assert.equal(
      providerChargeLabel(row.provider),
      "Provider charges: unknown",
    );
    assert.match(
      providerEvidenceLabel(row.providerEvidence[0]),
      /Synthetic test evidence: confirmation recorded.*no real payment verified/,
    );
    assert.equal(row.providerEvidence[0].actualSettlementVerified, false);
    assert.equal(
      row.legs.find((l) => l.type === "origin_in").status,
      "unknown",
    );
    await assert.rejects(
      client.call("/provider-events/synthetic_fixture", {
        method: "POST",
        body: { status: "confirmed" },
      }),
      { code: "PROVIDER_UNCONFIGURED" },
    );
  }
  await client.login("other-main@example.test", syntheticPassword);
  await assert.rejects(client.call("/requests/" + created.id), { status: 404 });
  console.log(
    "PASS: actual mobile client → HTTP → synthetic evidence DTO and existing detail copy; held reservation, no real confirmation, scoped access, callback disabled.",
  );
} finally {
  await new Promise((r) => server.close(r));
  await db.close();
}
