import { mountOperations } from './operations.js';
import express from "express";
import { providerBoundary, disabledProvider } from "./provider-boundary.js";
import { mountExchanges } from "./exchanges.js";
import { mountOnboarding } from "./onboarding.js";
import helmet from "helmet";
import cors from "cors";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { authentication, active, mainAgent, checkPassword } from "./auth.js";
import { agentDTO, requestDTO, findAgent } from "./models.js";
import {
  ApiError,
  invalid,
  unauthenticated,
  allowFields,
  uuid,
} from "./errors.js";

// No listeners, environment reads, workers, Firebase, Redis or connections on import.
export function createApp({ db, secret, rateLimit = 30 }) {
  const app = express();
  const auth = authentication(db, secret);
  const attempts = new Map();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: false })); // Native app does not need browser CORS.
  // API responses may contain credentials, private drafts or financial identifiers.
  app.use("/api/v1", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set("X-Request-Id", req.requestId);
    next();
  });
  app.use((req, res, next) =>
    req.path === "/api/v1/documents" && req.method === "POST"
      ? next()
      : express.json({ limit: "32kb" })(req, res, next),
  );
  const ok = (res, data) => res.json({ data });
  const limited = (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of attempts)
      if (value.until <= now) attempts.delete(key);
    const key = req.ip;
    const value = attempts.get(key) || { count: 0, until: now + 60_000 };
    value.count++;
    attempts.set(key, value);
    if (value.count > rateLimit) {
      res.set("Retry-After", "60");
      return next(
        new ApiError(
          429,
          "RATE_LIMITED",
          "Too many attempts. Try again shortly.",
        ),
      );
    }
    next();
  };
  app.get("/health", async (req, res) => {
    await db.query("SELECT 1");
    ok(res, { status: "ok", paymentsEnabled: false });
  });
  app.use("/api/v1/auth", limited);
  app.post("/api/v1/auth/register", async (req, res) => {
    allowFields(req.body, ["email", "password", "name", "phone"]);
    const { password, name, phone } = req.body;
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 100 ||
      typeof password !== "string" ||
      password.length < 12 ||
      Buffer.byteLength(password) > 72 ||
      typeof phone !== "string" ||
      !/^\+[1-9]\d{7,14}$/.test(phone)
    )
      throw invalid(
        "Enter a name, valid email, international phone number and a password of 12–72 bytes.",
      );
    const row = (
      await db.query(
        `INSERT INTO ss_v1.agents(id,email,name,phone,password_hash)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [
          randomUUID(),
          email,
          name.trim(),
          phone,
          await bcrypt.hash(password, 12),
        ],
      )
    ).rows[0];
    // Registration saves a pending account/draft, not a completed KYC application.
    res.status(201);
    ok(res, await auth.session(row));
  });
  const dummyHash = bcrypt.hashSync("synthetic-timing-only-password", 12);
  app.post("/api/v1/auth/login", async (req, res) => {
    allowFields(req.body, ["email", "password"]);
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const row = (
      await db.query("SELECT * FROM ss_v1.agents WHERE email=$1", [email])
    ).rows[0];
    const valid = await checkPassword(
      req.body.password,
      row?.password_hash || dummyHash,
    );
    if (!row || !valid || row.account_status === "closed")
      throw new ApiError(
        401,
        "INVALID_CREDENTIALS",
        "Incorrect email or password.",
      );
    ok(res, await auth.session(await findAgent(db, row.id)));
  });
  app.post("/api/v1/auth/refresh", async (req, res) => {
    allowFields(req.body, ["refreshToken"]);
    ok(res, await auth.refresh(req.body.refreshToken));
  });
  // No email provider is configured. Never issue or expose a reset token as a fallback.
  app.post("/api/v1/auth/recovery", (req, res, next) =>
    next(
      new ApiError(
        503,
        "RECOVERY_UNAVAILABLE",
        "Password recovery is not available yet.",
      ),
    ),
  );
  app.post("/api/v1/auth/reset", (req, res, next) =>
    next(
      new ApiError(
        503,
        "RECOVERY_UNAVAILABLE",
        "Password recovery is not available yet.",
      ),
    ),
  );
  // No callback protocol is configured. Reject before app-session authentication.
  app.use("/api/v1/provider-events", async () =>
    disabledProvider.verifyCallback(),
  );
  app.use("/api/v1", auth.authenticate);
  app.get("/api/v1/provider-status", active, (req, res) =>
    ok(res, providerBoundary()),
  );
  app.post("/api/v1/auth/logout", async (req, res) => {
    await db.query("UPDATE ss_v1.sessions SET revoked_at=now() WHERE id=$1", [
      req.sessionId,
    ]);
    ok(res, { loggedOut: true });
  });
  app.post("/api/v1/auth/reauthenticate", async (req, res) => {
    allowFields(req.body, ["password"]);
    if (!(await checkPassword(req.body.password, req.agent.password_hash)))
      throw new ApiError(401, "INVALID_CREDENTIALS", "Incorrect password.");
    ok(res, { verified: true });
  });
  app.post("/api/v1/documents", limited);
  mountOnboarding(app, db);
  app.get("/api/v1/me", (req, res) => ok(res, agentDTO(req.agent)));
  app.patch("/api/v1/me", active, async (req, res) => {
    allowFields(req.body, ["name"]);
    if (
      typeof req.body.name !== "string" ||
      !req.body.name.trim() ||
      req.body.name.length > 100
    )
      throw invalid("Enter a valid name.");
    await db.query("UPDATE ss_v1.agents SET name=$1 WHERE id=$2", [
      req.body.name.trim(),
      req.agent.id,
    ]);
    ok(res, agentDTO(await findAgent(db, req.agent.id)));
  });
  app.get("/api/v1/networks", (req, res) =>
    ok(res, [
      { code: "vodacom", displayName: "M-Pesa" },
      { code: "airtel", displayName: "Airtel Money" },
      { code: "yas", displayName: "Mixx by Yas" },
      { code: "halotel", displayName: "HaloPesa" },
    ]),
  );
  const pageArgs = (req) => {
    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    const cursor = req.query.cursor || null;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (cursor && !uuid(cursor))
    )
      throw invalid("Invalid pagination.");
    return { limit, cursor };
  };
  const page = (res, rows, limit, dto) =>
    res.json({
      data: rows.slice(0, limit).map(dto),
      page: { nextCursor: rows.length > limit ? rows[limit - 1].id : null },
    });
  app.get("/api/v1/agents", active, mainAgent, async (req, res) => {
    const { limit, cursor } = pageArgs(req);
    const rows = (
      await db.query(
        `SELECT a.*, m.main_agent_id FROM ss_v1.agents a JOIN ss_v1.main_agent_assignments m ON m.sub_agent_id=a.id
      WHERE m.main_agent_id=$1 AND ($2::uuid IS NULL OR a.id>$2) ORDER BY a.id LIMIT $3`,
        [req.agent.id, cursor, limit + 1],
      )
    ).rows;
    page(res, rows, limit, agentDTO);
  });
  app.get("/api/v1/agents/:id", active, async (req, res) => {
    if (!uuid(req.params.id)) throw invalid("Invalid agent ID.");
    const row = await findAgent(db, req.params.id);
    if (
      !row ||
      (row.id !== req.agent.id &&
        !(
          req.agent.role === "main-agent" && row.main_agent_id === req.agent.id
        ))
    )
      throw new ApiError(404, "NOT_FOUND", "Agent not found.");
    ok(res, agentDTO(row));
  });
  mountOperations(app, db);
  mountExchanges(app, db);
  app.use("/api/v1/requests", active, (req, res, next) =>
    next(
      new ApiError(
        503,
        "EXCHANGES_DISABLED",
        "Exchange processing is not available yet.",
      ),
    ),
  );
  app.use("/api/v1/transfers", active, (req, res, next) =>
    next(new ApiError(503, "PAYMENTS_DISABLED", "Payments are disabled.")),
  );
  app.use("/api/v1/agents", active, (req, res, next) =>
    next(
      new ApiError(
        503,
        "REVIEW_UNAVAILABLE",
        "Application review is not available yet.",
      ),
    ),
  );
  app.use((req, res, next) =>
    next(new ApiError(404, "NOT_FOUND", "Endpoint not found.")),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.code === "23505")
      error = new ApiError(
        409,
        "ACCOUNT_CONFLICT",
        "An account with these details already exists.",
      );
    else if (error.type === "entity.parse.failed")
      error = invalid("Invalid JSON.");
    else if (error.type === "entity.too.large")
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
  });
  return app;
}
