import { randomUUID } from "node:crypto";
// Explicitly disposable fixtures; never imported by native/production startup.
export async function seedExchangeFixtures(db, f) {
  const accounts = {};
  for (const who of ["main", "sub", "other-main", "other-sub"]) {
    accounts[who] = {};
    for (const network of ["vodacom", "airtel"]) {
      const id = randomUUID();
      accounts[who][network] = id;
      await db.query(
        `INSERT INTO ss_v1.network_accounts(id,agent_id,network_code,identifier_type,identifier,verification_status,verification_source)
    VALUES($1,$2,$3,'agent',$4,'synthetic_fixture','synthetic_fixture')`,
        [id, f[who].id, network, `TEST-${who}-${network}`],
      );
      if (who.includes("main"))
        await db.query(
          "INSERT INTO ss_v1.exchange_capacity(account_id,total_tzs,source) VALUES($1,1000000,'synthetic_fixture')",
          [id],
        );
    }
  }
  return accounts;
}
