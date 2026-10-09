import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { embeddedDatabase } from "./embedded.js";
import { seedSynthetic, syntheticPassword } from "./fixtures.js";
import { seedOnboardingFixtures } from "./onboarding-fixtures.js";
import { migrate } from "../foundation/migrate.js";
import { createApp } from "../foundation/app.js";
if (!process.env.SILVERSTONE_FRONTEND_PATH)
  throw Error("Set SILVERSTONE_FRONTEND_PATH.");
const frontend = resolve(process.env.SILVERSTONE_FRONTEND_PATH);
const { createApiClient } = await import(
  pathToFileURL(resolve(frontend, "src/api/client.js"))
);
const { saveDraft, wizardParams } = await import(
  pathToFileURL(resolve(frontend, "src/api/onboarding.js"))
);
const { canOperate } = await import(
  pathToFileURL(resolve(frontend, "src/api/presentation.js"))
);
const db = await embeddedDatabase();
await migrate(db);
const fixtures = await seedSynthetic(db);
await seedOnboardingFixtures(db, fixtures);
const server = createApp({
  db,
  secret: "synthetic-client-onboarding-secret-32",
  rateLimit: 1000,
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const client = () => {
  const map = new Map();
  return createApiClient({
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    storage: {
      getItem: async (k) => map.get(k),
      setItem: async (k, v) => map.set(k, v),
      removeItem: async (k) => map.delete(k),
    },
  });
};
try {
  const applicant = client(),
    reviewer = client();
  await applicant.login("pending@example.test", syntheticPassword);
  await reviewer.login("main@example.test", syntheticPassword);
  // Reuse the validated test PNG from the fixture source, without real identity evidence.
  const { readFile } = await import("node:fs/promises");
  const fixture = await readFile(
    new URL("../tests/foundation/onboarding.test.js", import.meta.url),
    "utf8",
  );
  const base64 = fixture.match(/const image\s*=\s*"([^"]+)"/)[1];
  const ids = [];
  for (const kind of ["tin", "licence", "selfie"])
    ids.push(
      (
        await applicant.call("/documents", {
          method: "POST",
          body: { kind, name: kind + ".png", mime: "image/png", base64 },
        })
      ).id,
    );
  let state = await saveDraft(applicant, {
    expectedVersion: 0,
    name: "Synthetic Mobile Applicant",
    nida: "12345678901234567890",
    businessName: "Test Shop",
    businessLocation: "Dar synthetic",
    networks: ["Voda", "Airtel"],
    floatCapacity: 500000,
    businessTIN: "123456789",
    businessLicenceNumber: "TEST-1",
    documentIds: ids,
  });
  assert.equal((await applicant.restore()).applicationStatus, "draft");
  assert.equal(
    (await applicant.call("/applications/me")).version,
    state.version,
  );
  await applicant.call("/applications/me/submit", {
    method: "POST",
    body: { expectedVersion: state.version },
  });
  assert.equal(canOperate(await applicant.call("/me")), false);
  let detail = await reviewer.call(
    `/review/applications/${fixtures.pending.id}`,
  );
  await reviewer.call(`/review/applications/${fixtures.pending.id}/decisions`, {
    method: "POST",
    body: {
      expectedVersion: detail.version,
      decision: "changes_requested",
      reason: "Please correct the location",
      fieldsToCorrect: ["businessLocation"],
    },
  });
  state = await applicant.call("/applications/me");
  state = await saveDraft(applicant, {
    ...wizardParams(state),
    businessLocation: "Corrected synthetic location",
  });
  await applicant.call("/applications/me/submit", {
    method: "POST",
    body: { expectedVersion: state.version },
  });
  detail = await reviewer.call(`/review/applications/${fixtures.pending.id}`);
  await reviewer.call(`/review/applications/${fixtures.pending.id}/decisions`, {
    method: "POST",
    body: {
      expectedVersion: detail.version,
      decision: "approved",
      reason: "Synthetic evidence reviewed",
    },
  });
  const approved = await applicant.call("/me");
  assert.equal(canOperate(approved), true);
  assert.equal(approved.applicationStatus, "approved");
  await applicant.call("/requests");
  await assert.rejects(
    applicant.call("/transfers", { method: "POST", body: {} }),
    { code: "PAYMENTS_DISABLED" },
  );
  assert.equal((await applicant.call("/applications/me")).revisions.length, 2);
  console.log(
    "PASS: actual mobile client and wizard mapping over HTTP: draft/restore/upload/submit/correction/resubmit/approval/access; payments disabled. PIN device behavior is not exercised.",
  );
} finally {
  await new Promise((r) => server.close(r));
  await db.close();
}
