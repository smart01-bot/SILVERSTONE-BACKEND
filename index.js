import "dotenv/config";
import express from "express";
import { pathToFileURL } from "node:url";
import { createApp } from "./foundation/app.js";
import { connectDatabase } from "./foundation/database.js";
import {
  connectRedisRateLimitStore,
  createRateLimitMiddleware,
} from "./foundation/rate-limit.js";
export { createApp };

const enabled = (value) => value === "true";

// Importing this file never listens, connects, migrates, or starts a worker.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const allowRemote = enabled(process.env.SILVERSTONE_ALLOW_REMOTE_DATABASE);
  const db = connectDatabase(process.env.SILVERSTONE_DATABASE_URL, {
    allowRemote,
  });
  let closeRateLimitStore = async () => {};
  try {
    await db.query("SELECT name FROM ss_v1.schema_migrations");

    const redis = await connectRedisRateLimitStore(process.env);
    closeRateLimitStore = redis.close;
    const sharedLimit = createRateLimitMiddleware({
      limit: Number(process.env.SILVERSTONE_RATE_LIMIT || 30),
      store: redis.store,
    });

    const core = createApp({
      db,
      secret: process.env.SILVERSTONE_JWT_SECRET,
      // Hosted traffic is limited by the shared wrapper below. Keep this high to
      // avoid counting the same authentication request twice.
      rateLimit: allowRemote ? 1_000_000 : 30,
    });
    const app = express();
    if (allowRemote) app.set("trust proxy", 1);
    app.use((req, res, next) => {
      const limited =
        req.path.startsWith("/api/v1/auth") ||
        (req.path === "/api/v1/documents" && req.method === "POST");
      return limited ? sharedLimit(req, res, next) : next();
    });
    app.use(core);

    const port = Number(process.env.PORT || 8800);
    const host = process.env.HOST || (allowRemote ? "0.0.0.0" : "127.0.0.1");
    const server = app.listen(port, host, () =>
      console.log(
        `Silverstone API listening on ${host}:${port}; payments disabled; shared rate limit ${redis.store ? "enabled" : "using local fallback"}.`,
      ),
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () =>
        server.close(async () => {
          await closeRateLimitStore().catch(() => {});
          await db.close();
          process.exit(0);
        }),
      );
  } catch (error) {
    await closeRateLimitStore().catch(() => {});
    await db.close();
    console.error("Startup failed:", error.message);
    process.exitCode = 1;
  }
}
