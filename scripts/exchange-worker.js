// Manual, local-only preparation worker. No provider adapter or settlement action.
// Apply migrations first. Use only the guarded local development/test database.
import { connectDatabase } from "../foundation/database.js";
import {
  claimExchangeJob,
  finishExchangeJob,
} from "../foundation/exchanges.js";
const db = connectDatabase(process.env.SILVERSTONE_DATABASE_URL);
try {
  let processed = 0;
  for (;;) {
    const claim = await claimExchangeJob(db);
    if (!claim) break;
    await finishExchangeJob(db, claim, "provider_disabled");
    processed++;
  }
  console.log(
    `Preparation records blocked pending provider integration: ${processed}. No payments executed.`,
  );
} finally {
  await db.close();
}
