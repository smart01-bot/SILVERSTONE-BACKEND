import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { embeddedDatabase } from "./embedded.js";
import { migrate } from "../foundation/migrate.js";
import { createApp } from "../foundation/app.js";
import { seedSynthetic, syntheticPassword } from "./fixtures.js";
import { seedExchangeFixtures } from "./exchange-fixtures.js";
import {
  claimExchangeJob,
  finishExchangeJob,
} from "../foundation/exchanges.js";
if (!process.env.SILVERSTONE_FRONTEND_PATH)
  throw Error("Set SILVERSTONE_FRONTEND_PATH.");
const load = (p) =>
  import(pathToFileURL(resolve(process.env.SILVERSTONE_FRONTEND_PATH, p)));
const { createApiClient } = await load("src/api/client.js");
const { createExchangeOutbox } = await load("src/api/offlineExchanges.js");
const storage = () => {
  const m = new Map();
  return {
    getItem: async (k) => m.get(k) || null,
    setItem: async (k, v) => m.set(k, v),
    removeItem: async (k) => m.delete(k),
  };
};
const db = await embeddedDatabase();
await migrate(db);
const fixtures = await seedSynthetic(db);
await seedExchangeFixtures(db, fixtures);
const server = createApp({
  db,
  secret: "isolated-client-exchange-secret-at-least32",
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
try {
  const client = createApiClient({
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    storage: storage(),
  });
  await client.login("sub@example.test", syntheticPassword);
  const accounts = await client.call("/me/accounts");
  const payload = {
    sourceAccountId: accounts.find((a) => a.networkCode === "vodacom").id,
    destinationAccountId: accounts.find((a) => a.networkCode === "airtel").id,
    amountTzs: "100000",
    currency: "TZS",
    urgent: false,
  };
  let loseResponse = true;
  const local = storage(),
    options = {
      storage: local,
      currentOwner: client.currentOwner,
      newKey: randomUUID,
      send: async (body, key, owner) => {
        const r = await client.call("/requests", {
          method: "POST",
          body,
          headers: { "Idempotency-Key": key },
          expectedOwner: owner,
        });
        if (loseResponse) {
          loseResponse = false;
          throw Error("Synthetic response loss after server commit");
        }
        return r;
      },
    };
  let queue = createExchangeOutbox(options);
  await queue.enqueue(fixtures.sub.id, payload);
  assert.equal((await queue.sync(fixtures.sub.id)).remaining, 1);
  queue = createExchangeOutbox(options);
  const result = await queue.sync(fixtures.sub.id);
  assert.equal(result.remaining, 0);
  const rows = await client.call("/requests");
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.legs.length, 2);
  await client.login("main@example.test", syntheticPassword);
  const accepted = await client.call(`/requests/${row.id}/accept`, {
    method: "POST",
    body: { expectedVersion: row.version },
    headers: { "Idempotency-Key": randomUUID() },
  });
  assert.equal(accepted.reservation.status, "held");
  assert.equal(accepted.status, "awaiting_source");
  await finishExchangeJob(db, await claimExchangeJob(db));
  await client.login("sub@example.test", syntheticPassword);
  const cancelled = await client.call(`/requests/${row.id}/cancel`, {
    method: "POST",
    body: { expectedVersion: accepted.version },
    headers: { "Idempotency-Key": randomUUID() },
  });
  assert.equal(cancelled.reservation.status, "released");
  assert.ok(cancelled.legs.every((l) => l.status === "not_started"));
  await assert.rejects(
    client.call("/transfers/process", { method: "POST", body: {} }),
    { status: 503 },
  );
  console.log(
    "PASS: actual mobile client/outbox over HTTP: lost response/restart/same-key replay, one request/two legs, reserve, provider-blocked preparation, safe cancellation; no payment.",
  );
} finally {
  await new Promise((r) => server.close(r));
  await db.close();
}
