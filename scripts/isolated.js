import { seedExchangeFixtures } from "./exchange-fixtures.js";
import { randomBytes } from "node:crypto";
import { embeddedDatabase } from "./embedded.js";
import { seedOnboardingFixtures } from "./onboarding-fixtures.js";
import { seedSynthetic } from "./fixtures.js";
import { migrate } from "../foundation/migrate.js";
import { createApp } from "../foundation/app.js";
const db = await embeddedDatabase();
await migrate(db);
const fixtures = await seedSynthetic(db);
await seedOnboardingFixtures(db, fixtures);
await seedExchangeFixtures(db, fixtures);
const server = createApp({
  db,
  secret: randomBytes(48).toString("hex"),
}).listen(8800, "127.0.0.1", () =>
  console.log(
    "Isolated synthetic API: http://127.0.0.1:8800 — see LOCAL-DEVELOPMENT.md for test accounts. Data disappears on exit.",
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(async () => {
      await db.close();
      process.exit(0);
    }),
  );
