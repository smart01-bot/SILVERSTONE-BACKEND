import express from "express";
import { randomUUID } from "node:crypto";
import { authentication, checkPassword } from "./auth.js";
import { findAgent } from "./models.js";
import { ApiError, allowFields, invalid } from "./errors.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+[1-9]\d{7,14}$/;

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function sendError(error, req, res) {
  if (error?.code === "23505")
    error = new ApiError(
      409,
      "ACCOUNT_CONFLICT",
      "An account with these details already exists.",
    );
  else if (error?.type === "entity.parse.failed")
    error = invalid("Invalid JSON.");
  else if (error?.type === "entity.too.large")
    error = new ApiError(413, "PAYLOAD_TOO_LARGE", "Request is too large.");

  const safe = error instanceof ApiError;
  res.status(safe ? error.status : 503).json({
    error: {
      code: safe ? error.code : "SERVICE_UNAVAILABLE",
      message: safe ? error.message : "Service temporarily unavailable.",
      fieldErrors: safe ? error.fieldErrors : {},
      requestId: req.requestId,
    },
  });
}

export function createHostedAuthRouter({ db, secret, credentials }) {
  if (!credentials) return null;

  const router = express.Router();
  const auth = authentication(db, secret);
  const ok = (res, data) => res.json({ data });

  router.use(express.json({ limit: "32kb" }));
  router.use((req, res, next) => {
    req.requestId ||= randomUUID();
    res.set("X-Request-Id", req.requestId);
    next();
  });

  router.post("/api/v1/auth/register", async (req, res) => {
    try {
      allowFields(req.body, ["email", "password", "name", "phone"]);
      const email = normalizeEmail(req.body.email);
      const { password, name, phone } = req.body;
      if (
        !EMAIL.test(email) ||
        email.length > 254 ||
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 100 ||
        typeof password !== "string" ||
        password.length < 12 ||
        Buffer.byteLength(password) > 72 ||
        typeof phone !== "string" ||
        !PHONE.test(phone)
      )
        throw invalid(
          "Enter a name, valid email, international phone number and a password of 12–72 bytes.",
        );

      const existing = (
        await db.query(
          "SELECT 1 FROM ss_v1.agents WHERE email=$1 OR phone=$2 LIMIT 1",
          [email, phone],
        )
      ).rows[0];
      if (existing)
        throw new ApiError(
          409,
          "ACCOUNT_CONFLICT",
          "An account with these details already exists.",
        );

      const identity = await credentials.signUp(email, password);
      const row = (
        await db.query(
          `INSERT INTO ss_v1.agents(
             id,email,name,phone,password_hash,auth_user_id,auth_source
           ) VALUES ($1,$2,$3,$4,NULL,$5,'supabase') RETURNING *`,
          [randomUUID(), email, name.trim(), phone, identity.id],
        )
      ).rows[0];

      res.status(201);
      ok(res, await auth.session(row));
    } catch (error) {
      sendError(error, req, res);
    }
  });

  router.post("/api/v1/auth/login", async (req, res) => {
    try {
      allowFields(req.body, ["email", "password"]);
      const email = normalizeEmail(req.body.email);
      if (!EMAIL.test(email) || typeof req.body.password !== "string")
        throw new ApiError(
          401,
          "INVALID_CREDENTIALS",
          "Incorrect email or password.",
        );

      const identity = await credentials.signIn(email, req.body.password);
      const row = (
        await db.query(
          `SELECT * FROM ss_v1.agents
           WHERE auth_source='supabase' AND auth_user_id=$1 AND email=$2`,
          [identity.id, email],
        )
      ).rows[0];
      if (!row || row.account_status === "closed")
        throw new ApiError(
          401,
          "INVALID_CREDENTIALS",
          "Incorrect email or password.",
        );

      ok(res, await auth.session(await findAgent(db, row.id)));
    } catch (error) {
      sendError(error, req, res);
    }
  });

  router.post(
    "/api/v1/auth/reauthenticate",
    auth.authenticate,
    async (req, res) => {
      try {
        allowFields(req.body, ["password"]);
        const password = req.body.password;
        let verified = false;
        if (
          req.agent.auth_source === "supabase" &&
          req.agent.auth_user_id &&
          typeof password === "string"
        ) {
          const identity = await credentials.signIn(req.agent.email, password);
          verified = identity.id === req.agent.auth_user_id;
        } else {
          verified = await checkPassword(password, req.agent.password_hash);
        }
        if (!verified)
          throw new ApiError(
            401,
            "INVALID_CREDENTIALS",
            "Incorrect password.",
          );
        ok(res, { verified: true });
      } catch (error) {
        sendError(error, req, res);
      }
    },
  );

  return router;
}
