// Creates its own disposable Docker PostgreSQL. No user URLs, live config or providers.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { connectDatabase } from "../foundation/database.js";
import { migrate } from "../foundation/migrate.js";
import { createApp } from "../foundation/app.js";
import { seedSynthetic, syntheticPassword } from "./fixtures.js";
import { seedExchangeFixtures } from "./exchange-fixtures.js";
import { seedOperationsFixtures } from "./operations-fixtures.js";
import {
  claimExchangeJob,
  finishExchangeJob,
} from "../foundation/exchanges.js";
import { encryptBackup, decryptBackup } from "./backup.js";
const name = "silverstone-phase6-" + randomUUID(),
  dir = await mkdtemp(join(tmpdir(), "silverstone-phase6-"));
const env = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];
function docker(args, input) {
  const r = spawnSync(
    "docker",
    ["--host=unix:///var/run/docker.sock", ...args],
    { input, env, maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0)
    throw new Error("Isolated Docker drill command failed: " + args[0]);
  return r.stdout;
}
let db, restored;
const capture = async (database) => {
  const tables = (
    await database.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='ss_v1' ORDER BY tablename",
    )
  ).rows;
  const result = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    const rows = (
      await database.query(
        `SELECT row_to_json(t)::text value FROM ss_v1.${tablename} t ORDER BY row_to_json(t)::text`,
      )
    ).rows;
    result[tablename] = {
      count: rows.length,
      hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    };
  }
  return result;
};
try {
  docker([
    "run",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e",
    "POSTGRES_DB=silverstone_test",
    "-p",
    "127.0.0.1::5432",
    "postgres@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4",
  ]);
  let port = docker(["port", name, "5432/tcp"])
    .toString()
    .trim()
    .split(":")
    .at(-1);
  assert.match(port, /^\d+$/);
  const wait = async () => {
    for (let n = 0; n < 60; n++) {
      const r = spawnSync(
        "docker",
        [
          "--host=unix:///var/run/docker.sock",
          "exec",
          name,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "postgres",
        ],
        { env, stdio: "ignore" },
      );
      if (r.status === 0) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Isolated PostgreSQL readiness timeout.");
  };
  await wait();
  const url = (database) =>
    `postgresql://postgres@127.0.0.1:${port}/${database}`;
  db = connectDatabase(url("silverstone_test"));
  await migrate(db);
  db.syntheticOnly = true;
  const f = await seedSynthetic(db),
    accounts = await seedExchangeFixtures(db, f);
  await seedOperationsFixtures(db, f);
  const secret = randomBytes(48).toString("hex");
  let app = createApp({ db, secret, rateLimit: 1000 });
  const tokens = {};
  for (const who of ["main", "sub"]) {
    const r = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: f[who].email, password: syntheticPassword });
    assert.equal(r.status, 200);
    tokens[who] = r.body.data.accessToken;
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
  const make = async (key = randomUUID()) => {
    const r = await call("sub", "post", "/requests", payload, key);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data;
  };
  const accept = async (r) => {
    const result = await call("main", "post", `/requests/${r.id}/accept`, {
      expectedVersion: 1,
    });
    assert.equal(result.status, 200);
  };
  const replayKey = randomUUID(),
    unknown = await make(replayKey);
  await accept(unknown);
  await finishExchangeJob(db, await claimExchangeJob(db), "unknown");
  const recoverable = await make();
  await accept(recoverable);
  const stale = await claimExchangeJob(db, { leaseSeconds: 1 });
  const base = "/operations/scopes/" + f.main.id;
  assert.equal(
    (
      await call("main", "post", base + `/cases/${unknown.id}/assign`, {
        expectedVersion: 0,
        ownerId: f.main.id,
        backupId: f["other-main"].id,
        reason: "Synthetic native recovery responsibility",
      })
    ).status,
    200,
  );
  // Ten overlapping same-key HTTP submissions must not create ten requests.
  const sameKey = randomUUID(),
    replies = await Promise.all(
      Array.from({ length: 10 }, () => make(sameKey)),
    );
  assert.equal(new Set(replies.map((r) => r.id)).size, 1);
  // Two independent PostgreSQL connections: pause cannot commit while a command
  // holds the scope's shared gate. Then the next command must see the pause.
  const gate = (await import("../foundation/operations.js")).operationGate;
  let held, release;
  const started = new Promise((r) => (held = r)),
    blocked = new Promise((r) => (release = r));
  const reader = db.transaction(async (tx) => {
    await gate(tx, f.main.id, "requests");
    held();
    await blocked;
  });
  await started;
  let pauseDone = false;
  const paused = call("main", "post", base + "/controls", {
    expectedVersion: 0,
    requestsPaused: true,
    acceptancePaused: true,
    preparationPaused: true,
    reason: "Synthetic concurrent pause",
  }).then((r) => {
    pauseDone = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(pauseDone, false);
  release();
  await reader;
  assert.equal((await paused).status, 200);
  assert.equal((await call("sub", "post", "/requests", payload)).status, 423);
  const document = randomUUID(),
    privateBytes = Buffer.from("synthetic-private-document");
  await db.query(
    "INSERT INTO ss_v1.documents(id,agent_id,kind,name,mime,size,sha256,content) VALUES($1,$2,'tin','synthetic.png','image/png',$3,'synthetic-hash',$4)",
    [document, f.sub.id, privateBytes.length, privateBytes],
  );
  await db.query(
    "INSERT INTO ss_v1.document_access_events(id,document_id,actor_id) VALUES($1,$2,$3)",
    [randomUUID(), document, f.sub.id],
  );
  const before = await capture(db),
    dump = docker([
      "exec",
      name,
      "pg_dump",
      "-U",
      "postgres",
      "-Fc",
      "--no-owner",
      "--no-acl",
      "silverstone_test",
    ]);
  const key = randomBytes(32),
    archive = encryptBackup(dump, key, {
      engine: "postgresql16",
      tables: before,
    });
  const file = join(dir, "synthetic.backup.enc");
  await writeFile(file, archive, { mode: 0o600 });
  assert.throws(
    () => decryptBackup(archive, randomBytes(32)),
    /authentication/,
  );
  const corrupted = Buffer.from(archive);
  corrupted[corrupted.length - 1] ^= 1;
  assert.throws(() => decryptBackup(corrupted, key), /authentication/);
  const decoded = decryptBackup(await readFile(file), key);
  // Crash the dedicated database process/container, then restart its retained
  // anonymous volume. This is not a live restore or host-network workaround.
  const restartStarted = Date.now();
  await db.close();
  db = null;
  docker(["kill", "--signal=KILL", name]);
  docker(["start", name]);
  await wait();
  port = docker(["port", name, "5432/tcp"]).toString().trim().split(":").at(-1);
  assert.match(port, /^\d+$/);
  db = connectDatabase(url("silverstone_test"));
  assert.deepEqual(await capture(db), before);
  const restartMs = Date.now() - restartStarted,
    restoreStarted = Date.now();
  docker(["exec", name, "createdb", "-U", "postgres", "silverstone_dev"]);
  docker(
    [
      "exec",
      "-i",
      name,
      "pg_restore",
      "-U",
      "postgres",
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
      "-d",
      "silverstone_dev",
    ],
    decoded.bytes,
  );
  restored = connectDatabase(url("silverstone_dev"));
  assert.deepEqual(await capture(restored), before);
  await migrate(restored);
  const restoreMs = Date.now() - restoreStarted;
  assert.equal(await claimExchangeJob(restored), null); // Durable pause survives restore.
  app = createApp({ db: restored, secret, rateLimit: 1000 });
  assert.equal((await make(replayKey)).id, unknown.id);
  assert.equal(
    (
      await call("main", "post", base + "/controls", {
        expectedVersion: 1,
        requestsPaused: false,
        acceptancePaused: false,
        preparationPaused: false,
        reason: "Resume isolated drill",
      })
    ).status,
    200,
  );
  const claim = await claimExchangeJob(restored);
  assert.equal(claim.requestId, recoverable.id);
  assert.notEqual(claim.claimToken, stale.claimToken);
  await assert.rejects(finishExchangeJob(restored, stale), {
    code: "STALE_CLAIM",
  });
  await finishExchangeJob(restored, claim);
  assert.equal(
    (
      await restored.query(
        "SELECT status FROM ss_v1.exchange_reservations WHERE request_id=$1",
        [unknown.id],
      )
    ).rows[0].status,
    "held",
  );
  assert.equal(
    (await call("main", "get", base + "/cases")).body.data[0].ownerId,
    f.main.id,
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      scope: "disposable_native_postgresql",
      tablesCompared: Object.keys(before).length,
      concurrentSameKeyRequests: 10,
      pauseFencing: true,
      encryptedDiskRoundTrip: true,
      wrongKeyAndCorruptionRejected: true,
      databaseCrashRestart: true,
      unknownHoldRetained: true,
      staleClaimRejected: true,
      restartMs,
      restoreMs,
      providerCalls: 0,
    }),
  );
} finally {
  if (restored) await restored.close();
  if (db) await db.close();
  spawnSync(
    "docker",
    ["--host=unix:///var/run/docker.sock", "rm", "-f", "-v", name],
    { env, stdio: "ignore" },
  );
  await rm(dir, { recursive: true, force: true });
}
