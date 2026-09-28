import "dotenv/config";
import { connectDatabase } from "../foundation/database.js";
import { migrate } from "../foundation/migrate.js";
const db = connectDatabase(process.env.SILVERSTONE_DATABASE_URL);
try {
  await migrate(db);
  console.log("Local foundation migrations applied.");
} finally {
  await db.close();
}
