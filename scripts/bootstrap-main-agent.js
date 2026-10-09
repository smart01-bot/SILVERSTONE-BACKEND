import "dotenv/config";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { connectDatabase } from "../foundation/database.js";

const enabled = (value) => value === "true";
const fail = (message) => {
  throw new Error(message);
};

const databaseUrl = process.env.SILVERSTONE_DATABASE_URL || process.env.DATABASE_URL;
const allowRemote = enabled(process.env.SILVERSTONE_ALLOW_REMOTE_DATABASE);
const allowRemoteBootstrap = enabled(
  process.env.SILVERSTONE_ALLOW_REMOTE_BOOTSTRAP,
);
const email = (process.env.SILVERSTONE_BOOTSTRAP_EMAIL || "")
  .trim()
  .toLowerCase();
const name = (process.env.SILVERSTONE_BOOTSTRAP_NAME || "").trim();
const phone = (process.env.SILVERSTONE_BOOTSTRAP_PHONE || "").trim();
const password = process.env.SILVERSTONE_BOOTSTRAP_PASSWORD || "";

if (!databaseUrl) fail("SILVERSTONE_DATABASE_URL or DATABASE_URL is required.");
if (allowRemote && !allowRemoteBootstrap)
  fail(
    "Remote main-agent bootstrap is disabled. Set SILVERSTONE_ALLOW_REMOTE_BOOTSTRAP=true only for the intentional one-time bootstrap run.",
  );
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
  fail("Set a valid SILVERSTONE_BOOTSTRAP_EMAIL.");
if (name.length < 3 || name.length > 100)
  fail("Set SILVERSTONE_BOOTSTRAP_NAME to 3-100 characters.");
if (!/^\+[1-9]\d{7,14}$/.test(phone))
  fail("Set SILVERSTONE_BOOTSTRAP_PHONE in E.164 format.");
if (password.length < 12 || Buffer.byteLength(password) > 72)
  fail("Set SILVERSTONE_BOOTSTRAP_PASSWORD to 12-72 bytes.");

const db = connectDatabase(databaseUrl, { allowRemote });
try {
  await db.query("SELECT name FROM ss_v1.schema_migrations LIMIT 1");
  const result = await db.transaction(async (tx) => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtext('silverstone-main-agent-bootstrap'))",
    );
    const existing = (
      await tx.query("SELECT id,email FROM ss_v1.agents WHERE role='main-agent' LIMIT 1")
    ).rows[0];
    if (existing)
      fail(
        `Main-agent bootstrap refused: a main-agent already exists (${existing.email}).`,
      );

    const id = randomUUID();
    const digest = await bcrypt.hash(password, 12);
    const agent = (
      await tx.query(
        `INSERT INTO ss_v1.agents(
          id,email,name,phone,password_hash,role,account_status,application_status
        ) VALUES ($1,$2,$3,$4,$5,'main-agent','active','approved')
        RETURNING id,email,name,phone,role,account_status,application_status,created_at`,
        [id, email, name, phone, digest],
      )
    ).rows[0];
    await tx.query(
      "INSERT INTO ss_v1.reviewer_grants(agent_id,granted_by) VALUES($1,$2)",
      [id, "one-time-main-agent-bootstrap"],
    );
    return agent;
  });

  console.log(
    `Bootstrapped approved main-agent ${result.email} (${result.id}). Disable SILVERSTONE_ALLOW_REMOTE_BOOTSTRAP and remove bootstrap credential environment values now.`,
  );
} finally {
  await db.close();
}
