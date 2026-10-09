// Only for the disposable embedded database. Never import this from foundation/.
export async function seedOnboardingFixtures(db, fixtures) {
  await db.query(
    "INSERT INTO ss_v1.reviewer_grants(agent_id,granted_by) VALUES($1,'synthetic-local-bootstrap') ON CONFLICT DO NOTHING",
    [fixtures.main.id],
  );
  await db.query(
    "INSERT INTO ss_v1.phone_verifications(agent_id,phone,source,reference) SELECT id,phone,'synthetic_fixture','not-a-real-OTP' FROM ss_v1.agents WHERE id=$1 ON CONFLICT DO NOTHING",
    [fixtures.pending.id],
  );
}
