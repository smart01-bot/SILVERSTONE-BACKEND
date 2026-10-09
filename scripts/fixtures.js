import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
export const syntheticPassword = "Synthetic-only-password-2026!";
export async function seedSynthetic(db) {
  const digest = await bcrypt.hash(syntheticPassword, 12);
  const fixtures = {};
  for (const [index, [name, role, status, application]] of [
    ["main", "main-agent", "active", "approved"],
    ["other-main", "main-agent", "active", "approved"],
    ["sub", "sub-agent", "active", "approved"],
    ["other-sub", "sub-agent", "active", "approved"],
    ["pending", "sub-agent", "pending", "draft"],
    ["suspended", "sub-agent", "suspended", "approved"],
  ].entries()) {
    const id = randomUUID(),
      email = `${name}@example.test`;
    await db.query(
      `INSERT INTO ss_v1.agents(id,email,name,phone,password_hash,role,account_status,application_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        email,
        name,
        `+25570000000${index}`,
        digest,
        role,
        status,
        application,
      ],
    );
    fixtures[name] = { id, email };
  }
  for (const [sub, main] of [
    ["sub", "main"],
    ["other-sub", "other-main"],
    ["pending", "main"],
  ]) {
    await db.query(
      "INSERT INTO ss_v1.main_agent_assignments VALUES ($1,$2,now())",
      [fixtures[sub].id, fixtures[main].id],
    );
  }
  return fixtures;
}
