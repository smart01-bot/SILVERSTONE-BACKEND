import "dotenv/config";
import { connectDatabase } from "../foundation/database.js";
import { migrate } from "../foundation/migrate.js";

const allowRemote = process.env.SILVERSTONE_ALLOW_REMOTE_DATABASE === "true";
if (allowRemote && process.env.SILVERSTONE_ALLOW_REMOTE_MIGRATIONS !== "true") {
  throw new Error(
    "Hosted migrations require SILVERSTONE_ALLOW_REMOTE_MIGRATIONS=true.",
  );
}

const db = connectDatabase(process.env.SILVERSTONE_DATABASE_URL, {
  allowRemote,
});
try {
  await migrate(db);
  console.log("Silverstone migrations applied.");
} finally {
  await db.close();
}
