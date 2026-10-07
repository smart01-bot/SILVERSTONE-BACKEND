// Only explicit disposable fixtures can create grants. Not in runtime graph.
export async function seedOperationsFixtures(db, fixtures) {
  if (db.syntheticOnly !== true)
    throw new Error("Explicit synthetic database required.");
  for (const capability of [
    "cases.read",
    "cases.manage",
    "cases.own",
    "evidence.record",
    "audit.read",
    "pause.manage",
  ])
    await db.query(
      "INSERT INTO ss_v1.operations_grants(actor_id,main_agent_id,capability,granted_by) VALUES($1,$2,$3,'synthetic_fixture')",
      [fixtures.main.id, fixtures.main.id, capability],
    );
  // Backup is explicitly delegated case visibility/ownership, never audit, payment or pause authority.
  for (const capability of ["cases.own", "cases.read"])
    await db.query(
      "INSERT INTO ss_v1.operations_grants(actor_id,main_agent_id,capability,granted_by) VALUES($1,$2,$3,'synthetic_fixture')",
      [fixtures["other-main"].id, fixtures.main.id, capability],
    );
}
