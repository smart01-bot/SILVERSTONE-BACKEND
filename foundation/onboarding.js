import express from "express";
import { validateEvidence } from "./evidence.js";
import { randomUUID, createHash } from "node:crypto";
import { ApiError, invalid, allowFields, uuid } from "./errors.js";
import { active, mainAgent } from "./auth.js";

const fields = [
  "name",
  "nida",
  "businessName",
  "businessLocation",
  "coordinates",
  "networks",
  "floatCapacity",
  "businessTIN",
  "businessLicenceNumber",
  "documentIds",
];
const editable = ["draft", "changes_requested"];
const deny = () =>
  new ApiError(
    403,
    "ONBOARDING_RESTRICTED",
    "This action is not available for your account.",
  );
const conflict = () =>
  new ApiError(
    409,
    "APPLICATION_CHANGED",
    "Your application changed. Reload it before continuing.",
  );
const missing = () =>
  new ApiError(404, "NOT_FOUND", "Application or document not found.");
function validate(data, complete = false) {
  allowFields(data, fields);
  const errors = {};
  const lengths = {
    name: [3, 100],
    nida: [20, 20],
    businessName: [3, 160],
    businessLocation: [3, 300],
    businessTIN: [8, 20],
    businessLicenceNumber: [3, 80],
  };
  for (const [key, [min, max]] of Object.entries(lengths)) {
    if (data[key] === undefined && !complete) continue;
    if (
      typeof data[key] !== "string" ||
      data[key].trim().length < (complete ? min : 0) ||
      data[key].length > max
    )
      errors[key] = `Check ${key}.`;
  }
  if (complete && data.nida && !/^\d{20}$/.test(data.nida))
    errors.nida = "Enter 20 digits.";
  if (complete && data.businessTIN && !/^[\d -]{8,20}$/.test(data.businessTIN))
    errors.businessTIN = "Check the TIN number.";
  if (complete || data.networks !== undefined)
    if (
      !Array.isArray(data.networks) ||
      (complete && data.networks.length < 1) ||
      data.networks.length > 4 ||
      new Set(data.networks).size !== data.networks.length ||
      data.networks.some(
        (n) => !["vodacom", "airtel", "yas", "halotel"].includes(n),
      )
    )
      errors.networks = "Choose supported networks.";
  if (complete || data.floatCapacity !== undefined)
    if (
      typeof data.floatCapacity !== "string" ||
      !/^[1-9]\d{0,14}$/.test(data.floatCapacity)
    )
      errors.floatCapacity = "Enter a whole TZS amount.";
  if (data.coordinates != null) {
    allowFields(data.coordinates, ["lat", "lng"]);
    if (
      !Number.isFinite(data.coordinates.lat) ||
      Math.abs(data.coordinates.lat) > 90 ||
      !Number.isFinite(data.coordinates.lng) ||
      Math.abs(data.coordinates.lng) > 180
    )
      errors.coordinates = "Check the map location.";
  }
  if (
    data.documentIds !== undefined &&
    (!Array.isArray(data.documentIds) ||
      data.documentIds.length > 3 ||
      data.documentIds.some((id) => !uuid(id)) ||
      new Set(data.documentIds).size !== data.documentIds.length)
  )
    errors.documentIds = "Choose up to three different documents.";
  if (Object.keys(errors).length)
    throw new ApiError(
      400,
      "INVALID_APPLICATION",
      "Check your application details.",
      errors,
    );
}
async function lock(db, id) {
  return (
    await db.query("SELECT * FROM ss_v1.agents WHERE id=$1 FOR UPDATE", [id])
  ).rows[0];
}
function applicant(row, edit = false) {
  if (
    row.role !== "sub-agent" ||
    !["pending", "active"].includes(row.account_status)
  )
    throw deny();
  if (
    edit &&
    (row.account_status !== "pending" ||
      !editable.includes(row.application_status))
  )
    throw deny();
}
async function reviewer(db, id) {
  const row = (
    await db.query(
      `SELECT a.* FROM ss_v1.agents a JOIN ss_v1.reviewer_grants g ON g.agent_id=a.id WHERE a.id=$1 AND g.revoked_at IS NULL`,
      [id],
    )
  ).rows[0];
  if (
    !row ||
    row.role !== "main-agent" ||
    row.account_status !== "active" ||
    row.application_status !== "approved"
  )
    throw deny();
}
async function scoped(db, actor, owner) {
  if (actor === owner) throw deny();
  await reviewer(db, actor);
  if (
    !(
      await db.query(
        "SELECT 1 FROM ss_v1.main_agent_assignments WHERE sub_agent_id=$1 AND main_agent_id=$2",
        [owner, actor],
      )
    ).rows.length
  )
    throw missing();
}
async function state(db, id) {
  const row = (await db.query("SELECT * FROM ss_v1.agents WHERE id=$1", [id]))
    .rows[0];
  const draft = (
    await db.query("SELECT * FROM ss_v1.application_drafts WHERE agent_id=$1", [
      id,
    ])
  ).rows[0];
  const revisions = (
    await db.query(
      `SELECT r.id,r.version,r.data,r.phone_source AS "phoneSource",r.submitted_at AS "submittedAt",d.decision,d.reason,d.fields_to_correct AS "fieldsToCorrect",d.reviewer_id AS "reviewerId",d.created_at AS "reviewedAt" FROM ss_v1.application_revisions r LEFT JOIN ss_v1.review_decisions d ON d.revision_id=r.id WHERE r.agent_id=$1 ORDER BY r.version DESC`,
      [id],
    )
  ).rows;
  const proof = (
    await db.query(
      "SELECT source FROM ss_v1.phone_verifications WHERE agent_id=$1 AND phone=$2",
      [id, row.phone],
    )
  ).rows[0];
  return {
    agentId: id,
    status: row.application_status,
    version: draft?.version || 0,
    data: draft?.data || {},
    phone: row.phone,
    email: row.email,
    phoneVerification: proof?.source || "unavailable",
    revisions,
  };
}
export function mountOnboarding(app, db) {
  const root = "/api/v1";
  app.use(
    [`${root}/applications`, `${root}/review`, `${root}/documents`],
    (req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
  );
  app.get(`${root}/applications/me`, async (req, res) => {
    applicant(req.agent);
    res.json({ data: await state(db, req.agent.id) });
  });
  app.put(`${root}/applications/me/draft`, async (req, res) => {
    allowFields(req.body, ["expectedVersion", "data"]);
    validate(req.body.data);
    if (
      !Number.isInteger(req.body.expectedVersion) ||
      req.body.expectedVersion < 0
    )
      throw invalid("Invalid version.");
    await db.transaction(async (tx) => {
      applicant(await lock(tx, req.agent.id), true);
      await tx.query(
        "INSERT INTO ss_v1.application_drafts(agent_id) VALUES($1) ON CONFLICT DO NOTHING",
        [req.agent.id],
      );
      const result = await tx.query(
        "UPDATE ss_v1.application_drafts SET data=$1,version=version+1,updated_at=now() WHERE agent_id=$2 AND version=$3 RETURNING version",
        [JSON.stringify(req.body.data), req.agent.id, req.body.expectedVersion],
      );
      if (!result.rows.length) throw conflict();
    });
    res.json({ data: await state(db, req.agent.id) });
  });
  app.post(`${root}/applications/me/phone-verification`, (req, res, next) =>
    next(
      new ApiError(
        503,
        "PHONE_PROVIDER_UNAVAILABLE",
        "Phone verification is not available yet. Your draft can still be saved.",
      ),
    ),
  );
  app.post(`${root}/applications/me/submit`, async (req, res) => {
    allowFields(req.body, ["expectedVersion"]);
    await db.transaction(async (tx) => {
      const owner = await lock(tx, req.agent.id);
      applicant(owner, true);
      const draft = (
        await tx.query(
          "SELECT * FROM ss_v1.application_drafts WHERE agent_id=$1",
          [owner.id],
        )
      ).rows[0];
      if (!draft || draft.version !== req.body.expectedVersion)
        throw conflict();
      validate(draft.data, true);
      const previous = (
        await tx.query(
          "SELECT max(version) AS version FROM ss_v1.application_revisions WHERE agent_id=$1",
          [owner.id],
        )
      ).rows[0];
      if (previous.version !== null && draft.version <= previous.version)
        throw conflict();
      const proof = (
        await tx.query(
          "SELECT source FROM ss_v1.phone_verifications WHERE agent_id=$1 AND phone=$2",
          [owner.id, owner.phone],
        )
      ).rows[0];
      if (!proof)
        throw new ApiError(
          409,
          "PHONE_VERIFICATION_REQUIRED",
          "Save your draft. Phone verification is required before submission.",
        );
      if (
        !(
          await tx.query(
            "SELECT 1 FROM ss_v1.main_agent_assignments WHERE sub_agent_id=$1",
            [owner.id],
          )
        ).rows.length
      )
        throw new ApiError(
          409,
          "ASSIGNMENT_REQUIRED",
          "A main-agent must be assigned before submission.",
        );
      const ids = draft.data.documentIds || [];
      const docs = (
        await tx.query(
          "SELECT id,kind FROM ss_v1.documents WHERE agent_id=$1 AND id=ANY($2::uuid[])",
          [owner.id, ids],
        )
      ).rows;
      if (docs.length !== 3 || new Set(docs.map((d) => d.kind)).size !== 3)
        throw new ApiError(
          400,
          "EVIDENCE_REQUIRED",
          "Add your TIN certificate, licence and selfie.",
        );
      const revision = randomUUID();
      await tx.query(
        "INSERT INTO ss_v1.application_revisions(id,agent_id,version,data,phone_source) VALUES($1,$2,$3,$4,$5)",
        [
          revision,
          owner.id,
          draft.version,
          JSON.stringify(draft.data),
          proof.source,
        ],
      );
      for (const doc of docs)
        await tx.query("INSERT INTO ss_v1.revision_documents VALUES($1,$2)", [
          revision,
          doc.id,
        ]);
      await tx.query(
        "UPDATE ss_v1.agents SET application_status='submitted',name=$2 WHERE id=$1",
        [owner.id, draft.data.name],
      );
    });
    res.json({ data: await state(db, req.agent.id) });
  });
  app.post(
    `${root}/documents`,
    express.json({ limit: "3mb" }),
    async (req, res) => {
      allowFields(req.body, ["kind", "name", "mime", "base64"]);
      const { kind, name, mime, base64 } = req.body;
      if (
        !["tin", "licence", "selfie"].includes(kind) ||
        typeof name !== "string" ||
        !name.length ||
        name.length > 120 ||
        /[\\/\x00-\x1f]/.test(name) ||
        typeof base64 !== "string" ||
        base64.length > 2796204 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          base64,
        )
      )
        throw invalid("Invalid document.");
      const bytes = Buffer.from(base64, "base64");
      validateEvidence(bytes, mime);
      const id = randomUUID(),
        hash = createHash("sha256").update(bytes).digest("hex");
      const doc = await db.transaction(async (tx) => {
        applicant(await lock(tx, req.agent.id), true);
        const existing = (
          await tx.query(
            "SELECT id,name,mime,kind,size FROM ss_v1.documents WHERE agent_id=$1 AND kind=$2 AND sha256=$3",
            [req.agent.id, kind, hash],
          )
        ).rows[0];
        if (existing) return existing;
        const count = (
          await tx.query(
            "SELECT count(*)::int AS count FROM ss_v1.documents WHERE agent_id=$1",
            [req.agent.id],
          )
        ).rows[0].count;
        if (count >= 30)
          throw new ApiError(
            409,
            "DOCUMENT_LIMIT",
            "Document limit reached. Contact support.",
          );
        return (
          await tx.query(
            "INSERT INTO ss_v1.documents(id,agent_id,kind,name,mime,size,sha256,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,mime,kind,size",
            [id, req.agent.id, kind, name, mime, bytes.length, hash, bytes],
          )
        ).rows[0];
      });
      res.status(201).json({ data: doc });
    },
  );
  app.get(`${root}/documents/:id`, async (req, res) => {
    if (!uuid(req.params.id)) throw missing();
    const doc = (
      await db.query("SELECT * FROM ss_v1.documents WHERE id=$1", [
        req.params.id,
      ])
    ).rows[0];
    if (!doc) throw missing();
    if (doc.agent_id === req.agent.id) applicant(req.agent);
    else {
      await scoped(db, req.agent.id, doc.agent_id);
      if (
        !(
          await db.query(
            "SELECT 1 FROM ss_v1.revision_documents WHERE document_id=$1",
            [doc.id],
          )
        ).rows.length
      )
        throw missing();
    }
    await db.query(
      "INSERT INTO ss_v1.document_access_events VALUES($1,$2,$3,now())",
      [randomUUID(), doc.id, req.agent.id],
    );
    res.json({
      data: {
        id: doc.id,
        name: doc.name,
        mime: doc.mime,
        kind: doc.kind,
        ...(req.query.metadata === "1"
          ? {}
          : { base64: Buffer.from(doc.content).toString("base64") }),
      },
    });
  });
  app.get(
    `${root}/review/applications`,
    active,
    mainAgent,
    async (req, res) => {
      await reviewer(db, req.agent.id);
      const rows = (
        await db.query(
          `SELECT a.id,a.name,a.application_status AS status FROM ss_v1.agents a JOIN ss_v1.main_agent_assignments m ON m.sub_agent_id=a.id WHERE m.main_agent_id=$1 AND a.application_status='submitted' AND a.account_status='pending' ORDER BY a.created_at LIMIT 100`,
          [req.agent.id],
        )
      ).rows;
      res.json({ data: rows });
    },
  );
  app.get(
    `${root}/review/applications/:id`,
    active,
    mainAgent,
    async (req, res) => {
      if (!uuid(req.params.id)) throw missing();
      await scoped(db, req.agent.id, req.params.id);
      const result = await state(db, req.params.id);
      // Never expose an applicant's unsent corrections or draft to a reviewer.
      delete result.data;
      result.version = result.revisions[0]?.version ?? 0;
      res.json({ data: result });
    },
  );
  app.post(
    `${root}/review/applications/:id/decisions`,
    active,
    mainAgent,
    async (req, res) => {
      allowFields(req.body, [
        "expectedVersion",
        "decision",
        "reason",
        "fieldsToCorrect",
      ]);
      const {
        expectedVersion,
        decision,
        reason,
        fieldsToCorrect = [],
      } = req.body;
      if (
        !uuid(req.params.id) ||
        !Number.isInteger(expectedVersion) ||
        !["approved", "rejected", "changes_requested"].includes(decision) ||
        typeof reason !== "string" ||
        reason.trim().length < 3 ||
        reason.length > 1000 ||
        !Array.isArray(fieldsToCorrect) ||
        fieldsToCorrect.some((f) => !fields.includes(f)) ||
        (decision === "changes_requested" && !fieldsToCorrect.length)
      )
        throw invalid(
          "Choose a decision and record a reason and any fields to correct.",
        );
      await db.transaction(async (tx) => {
        // Lock both accounts in stable order so suspension/revocation cannot race approval.
        for (const id of [req.agent.id, req.params.id].sort())
          await lock(tx, id);
        await scoped(tx, req.agent.id, req.params.id);
        await tx.query(
          "SELECT * FROM ss_v1.reviewer_grants WHERE agent_id=$1 FOR UPDATE",
          [req.agent.id],
        );
        await tx.query(
          "SELECT * FROM ss_v1.main_agent_assignments WHERE sub_agent_id=$1 FOR UPDATE",
          [req.params.id],
        );
        await scoped(tx, req.agent.id, req.params.id);
        const owner = await lock(tx, req.params.id);
        if (
          owner.account_status !== "pending" ||
          owner.application_status !== "submitted"
        )
          throw conflict();
        const revision = (
          await tx.query(
            "SELECT * FROM ss_v1.application_revisions WHERE agent_id=$1 ORDER BY version DESC LIMIT 1",
            [owner.id],
          )
        ).rows[0];
        if (!revision || revision.version !== expectedVersion) throw conflict();
        await tx.query(
          "INSERT INTO ss_v1.review_decisions(id,revision_id,reviewer_id,decision,reason,fields_to_correct) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            revision.id,
            req.agent.id,
            decision,
            reason.trim(),
            JSON.stringify(fieldsToCorrect),
          ],
        );
        await tx.query(
          "UPDATE ss_v1.agents SET application_status=$1,account_status=$2 WHERE id=$3",
          [decision, decision === "approved" ? "active" : "pending", owner.id],
        );
      });
      res.json({ data: { status: decision } });
    },
  );
}
