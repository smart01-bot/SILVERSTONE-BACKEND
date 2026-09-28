import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { embeddedDatabase } from "../../scripts/embedded.js";
import { migrate } from "../../foundation/migrate.js";
import { seedSynthetic, syntheticPassword } from "../../scripts/fixtures.js";
import { seedOnboardingFixtures } from "../../scripts/onboarding-fixtures.js";
import { createApp } from "../../foundation/app.js";
const image =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGOcxiDCAANMDEgANwcAIroAsmSncXsAAAAASUVORK5CYII=";
const details = {
  name: "Synthetic Applicant",
  nida: "12345678901234567890",
  businessName: "Test Shop",
  businessLocation: "Synthetic Dar location",
  businessTIN: "123456789",
  businessLicenceNumber: "TEST-001",
  networks: ["vodacom", "airtel"],
  floatCapacity: "500000",
  coordinates: { lat: -6.8, lng: 39.2 },
};

test("onboarding journey and security boundaries", async (t) => {
  const db = await embeddedDatabase();
  t.after(() => db.close());
  await migrate(db);
  const f = await seedSynthetic(db);
  await seedOnboardingFixtures(db, f);
  const app = createApp({
    db,
    secret: "isolated-onboarding-secret-at-least-32",
    rateLimit: 1000,
  });
  const tokens = {};
  for (const who of ["pending", "main", "other-main", "sub", "suspended"]) {
    const r = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: f[who].email, password: syntheticPassword });
    assert.equal(r.status, 200);
    tokens[who] = r.body.data.accessToken;
  }
  const call = (who, method, path, body) =>
    request(app)
      [method]("/api/v1" + path)
      .set("Authorization", `Bearer ${tokens[who]}`)
      .send(body);
  let draft;
  const ids = [];
  await t.test(
    "no real OTP, protected fields and invalid input fail closed",
    async () => {
      assert.equal(
        (
          await call(
            "pending",
            "post",
            "/applications/me/phone-verification",
            {},
          )
        ).status,
        503,
      );
      for (const field of [
        "role",
        "approved",
        "selfieVerified",
        "phoneVerified",
        "mainAgentId",
      ])
        assert.equal(
          (
            await call("pending", "put", "/applications/me/draft", {
              expectedVersion: 0,
              data: { [field]: true },
            })
          ).status,
          400,
        );
      assert.equal(
        (
          await call("pending", "put", "/applications/me/draft", {
            expectedVersion: 0,
            data: { networks: ["fake"], coordinates: { lat: 91, lng: 0 } },
          })
        ).status,
        400,
      );
      assert.equal(
        (await call("suspended", "get", "/applications/me")).status,
        403,
      );
      assert.equal(
        (await call("main", "get", "/review/applications/" + f.main.id)).status,
        403,
      );
    },
  );
  await t.test(
    "private validated uploads, scope and no unsent draft leak",
    async () => {
      assert.equal(
        (
          await call("pending", "post", "/documents", {
            kind: "tin",
            name: "x.png",
            mime: "image/png",
            base64: Buffer.from("not image").toString("base64"),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call("pending", "post", "/documents", {
            kind: "tin",
            name: "../x.png",
            mime: "image/png",
            base64: image,
          })
        ).status,
        400,
      );
      assert.equal(
        (await request(app).post("/api/v1/documents").send({})).status,
        401,
      );
      for (const kind of ["tin", "licence", "selfie"]) {
        const r = await call("pending", "post", "/documents", {
          kind,
          name: kind + ".png",
          mime: "image/png",
          base64: image,
        });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        ids.push(r.body.data.id);
      }
      assert.equal(
        (await call("main", "get", "/documents/" + ids[0])).status,
        404,
      );
      assert.equal(
        (await call("other-main", "get", "/documents/" + ids[0])).status,
        403,
      );
      assert.equal(
        (await call("sub", "get", "/documents/" + ids[0])).status,
        403,
      );
      assert.equal(
        (await call("pending", "get", "/documents/" + ids[0])).body.data.base64,
        image,
      );
      assert.equal(
        (await call("main", "get", "/review/applications/" + f.pending.id)).body
          .data.data,
        undefined,
      );
    },
  );
  await t.test(
    "draft persists and stale simultaneous edits conflict",
    async () => {
      const r = await call("pending", "put", "/applications/me/draft", {
        expectedVersion: 0,
        data: { ...details, documentIds: ids },
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      draft = r.body.data;
      assert.deepEqual(
        (await call("pending", "get", "/applications/me")).body.data.data,
        draft.data,
      );
      const results = await Promise.all([
        call("pending", "put", "/applications/me/draft", {
          expectedVersion: draft.version,
          data: draft.data,
        }),
        call("pending", "put", "/applications/me/draft", {
          expectedVersion: draft.version,
          data: draft.data,
        }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      draft = (await call("pending", "get", "/applications/me")).body.data;
    },
  );
  await t.test("missing phone and assignment prevent submission", async () => {
    await db.query("DELETE FROM ss_v1.phone_verifications WHERE agent_id=$1", [
      f.pending.id,
    ]);
    assert.equal(
      (
        await call("pending", "post", "/applications/me/submit", {
          expectedVersion: draft.version,
        })
      ).body.error.code,
      "PHONE_VERIFICATION_REQUIRED",
    );
    await seedOnboardingFixtures(db, f);
    await db.query(
      "DELETE FROM ss_v1.main_agent_assignments WHERE sub_agent_id=$1",
      [f.pending.id],
    );
    assert.equal(
      (
        await call("pending", "post", "/applications/me/submit", {
          expectedVersion: draft.version,
        })
      ).body.error.code,
      "ASSIGNMENT_REQUIRED",
    );
    await db.query(
      "INSERT INTO ss_v1.main_agent_assignments(sub_agent_id,main_agent_id) VALUES($1,$2)",
      [f.pending.id, f.main.id],
    );
  });
  const decision = (who, value, version = draft.version) =>
    call(who, "post", "/review/applications/" + f.pending.id + "/decisions", {
      expectedVersion: version,
      decision: value,
      reason: "Synthetic documented review",
      fieldsToCorrect:
        value === "changes_requested" ? ["businessLocation"] : [],
    });
  await t.test(
    "submit pending, preserve immutable evidence, reviewer grant required",
    async () => {
      const r = await call("pending", "post", "/applications/me/submit", {
        expectedVersion: draft.version,
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data.status, "submitted");
      assert.equal((await call("pending", "get", "/requests")).status, 403);
      assert.equal(
        (
          await call("pending", "put", "/applications/me/draft", {
            expectedVersion: draft.version,
            data: details,
          })
        ).status,
        403,
      );
      assert.equal(
        (await call("main", "get", "/review/applications")).body.data.length,
        1,
      );
      assert.equal(
        (await call("main", "get", "/documents/" + ids[0])).status,
        200,
      );
      assert.equal((await decision("pending", "approved")).status, 403);
      assert.equal((await decision("other-main", "approved")).status, 403);
      await db.query(
        "INSERT INTO ss_v1.reviewer_grants(agent_id,granted_by) VALUES($1,'test')",
        [f["other-main"].id],
      );
      assert.equal((await decision("other-main", "approved")).status, 404);
      await db.query(
        "UPDATE ss_v1.reviewer_grants SET revoked_at=now() WHERE agent_id=$1",
        [f.main.id],
      );
      assert.equal((await decision("main", "approved")).status, 403);
      await db.query(
        "UPDATE ss_v1.reviewer_grants SET revoked_at=NULL WHERE agent_id=$1",
        [f.main.id],
      );
      for (const table of ["application_revisions", "documents"])
        await assert.rejects(
          db.query(`DELETE FROM ss_v1.${table}`),
          /Immutable/,
        );
    },
  );
  await t.test(
    "correction and resubmission preserve prior version and review identity",
    async () => {
      assert.equal((await decision("main", "changes_requested")).status, 200);
      const state = (await call("pending", "get", "/applications/me")).body
        .data;
      assert.equal(state.status, "changes_requested");
      assert.equal(state.revisions[0].reviewerId, f.main.id);
      assert.equal(
        state.revisions[0].data.businessLocation,
        details.businessLocation,
      );
      const r = await call("pending", "put", "/applications/me/draft", {
        expectedVersion: state.version,
        data: {
          ...state.data,
          businessLocation: "Corrected synthetic location",
        },
      });
      assert.equal(r.status, 200);
      draft = r.body.data;
      assert.equal(
        (
          await call("pending", "post", "/applications/me/submit", {
            expectedVersion: draft.version,
          })
        ).status,
        200,
      );
      assert.equal(
        (await decision("main", "approved", state.version)).status,
        409,
      );
    },
  );
  await t.test(
    "concurrent decisions have one winner; approval activates existing session",
    async () => {
      const results = await Promise.all([
        decision("main", "approved"),
        decision("main", "approved"),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const state = (await call("pending", "get", "/applications/me")).body
        .data;
      assert.equal(state.revisions.length, 2);
      assert.equal(state.status, "approved");
      assert.equal(
        (await call("pending", "get", "/me")).body.data.accountStatus,
        "active",
      );
      assert.equal((await call("pending", "get", "/requests")).status, 200);
      assert.equal(
        (await call("pending", "post", "/transfers", {})).status,
        503,
      );
      assert.equal(
        (
          await call("pending", "post", "/documents", {
            kind: "tin",
            name: "x.png",
            mime: "image/png",
            base64: image,
          })
        ).status,
        403,
      );
    },
  );
  await t.test(
    "reassignment and suspension remove evidence access immediately",
    async () => {
      await db.query(
        "UPDATE ss_v1.main_agent_assignments SET main_agent_id=$1 WHERE sub_agent_id=$2",
        [f["other-main"].id, f.pending.id],
      );
      assert.equal(
        (await call("main", "get", "/documents/" + ids[0])).status,
        404,
      );
      await db.query(
        "UPDATE ss_v1.agents SET account_status='suspended' WHERE id=$1",
        [f.pending.id],
      );
      assert.equal(
        (await call("pending", "get", "/documents/" + ids[0])).status,
        403,
      );
      assert.equal((await call("pending", "get", "/requests")).status, 403);
    },
  );
  await t.test(
    "rejected applicant stays restricted; no resubmit or self-approval",
    async () => {
      // Separate synthetic submitted applicant, never rewrite immutable history.
      const id = randomUUID();
      await db.query(
        `INSERT INTO ss_v1.agents(id,email,name,phone,password_hash,application_status) SELECT $1,'rejected@example.test','Reject fixture','+255700000099',password_hash,'submitted' FROM ss_v1.agents WHERE id=$2`,
        [id, f.pending.id],
      );
      await db.query(
        "INSERT INTO ss_v1.main_agent_assignments(sub_agent_id,main_agent_id) VALUES($1,$2)",
        [id, f.main.id],
      );
      await db.query(
        "INSERT INTO ss_v1.application_revisions(id,agent_id,version,data,phone_source) VALUES($1,$2,1,'{}','synthetic_fixture')",
        [randomUUID(), id],
      );
      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "rejected@example.test", password: syntheticPassword });
      tokens.rejected = login.body.data.accessToken;
      const r = await call(
        "main",
        "post",
        `/review/applications/${id}/decisions`,
        {
          expectedVersion: 1,
          decision: "rejected",
          reason: "Synthetic evidence not accepted",
        },
      );
      assert.equal(r.status, 200);
      assert.equal(
        (await call("rejected", "get", "/applications/me")).body.data.status,
        "rejected",
      );
      assert.equal((await call("rejected", "get", "/requests")).status, 403);
      assert.equal(
        (
          await call("rejected", "post", "/applications/me/submit", {
            expectedVersion: 1,
          })
        ).status,
        403,
      );
    },
  );
});

test("additive onboarding upgrade preserves Phase 1 accounts and sessions", async (t) => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const db = await embeddedDatabase();
  t.after(() => db.close());
  const sql = await readFile(
    new URL("../../migrations/001-foundation.sql", import.meta.url),
    "utf8",
  );
  await db.query(
    "CREATE SCHEMA ss_v1; CREATE TABLE ss_v1.schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());",
  );
  await db.query(sql);
  await db.query(
    "INSERT INTO ss_v1.schema_migrations(name,checksum) VALUES($1,$2)",
    ["001-foundation.sql", createHash("sha256").update(sql).digest("hex")],
  );
  const f = await seedSynthetic(db);
  const session = randomUUID();
  await db.query(
    "INSERT INTO ss_v1.sessions(id,agent_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [session, f.pending.id],
  );
  await migrate(db);
  await migrate(db);
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM ss_v1.agents")).rows[0].n,
    6,
  );
  assert.equal(
    (await db.query("SELECT id FROM ss_v1.sessions WHERE id=$1", [session]))
      .rows[0].id,
    session,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM ss_v1.application_revisions",
      )
    ).rows[0].n,
    0,
  );
});
