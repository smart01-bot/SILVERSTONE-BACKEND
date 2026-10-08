import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createApp } from "./foundation/app.js";
import { connectDatabase } from "./foundation/database.js";
export { createApp };

const enabled = (value) => value === "true";

// Importing this file never listens, connects, migrates, or starts a worker.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const allowRemote = enabled(process.env.SILVERSTONE_ALLOW_REMOTE_DATABASE);
  const db = connectDatabase(process.env.SILVERSTONE_DATABASE_URL, {
    allowRemote,
  });
  try {
    const app = createApp({
      db,
      secret: process.env.SILVERSTONE_JWT_SECRET,
    });
    await db.query("SELECT name FROM ss_v1.schema_migrations");
    const port = Number(process.env.PORT || 8800);
    const host = process.env.HOST || (allowRemote ? "0.0.0.0" : "127.0.0.1");
    const server = app.listen(port, host, () =>
      console.log(`Silverstone API listening on ${host}:${port}; payments disabled.`),
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () =>
        server.close(async () => {
          await db.close();
          process.exit(0);
        }),
      );
  } catch (error) {
    await db.close();
    console.error("Startup failed:", error.message);
    process.exitCode = 1;
  }
}
