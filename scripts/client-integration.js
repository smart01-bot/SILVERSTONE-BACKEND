import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { embeddedDatabase } from "./embedded.js";
import { migrate } from "../foundation/migrate.js";
import { createApp } from "../foundation/app.js";
if (!process.env.SILVERSTONE_FRONTEND_PATH)
  throw Error("Set SILVERSTONE_FRONTEND_PATH to the frontend checkout.");
const { createApiClient } = await import(
  pathToFileURL(
    resolve(process.env.SILVERSTONE_FRONTEND_PATH, "src/api/client.js"),
  )
);
const db = await embeddedDatabase();
await migrate(db);
const server = createApp({
  db,
  secret: "synthetic-client-integration-secret-32-characters",
}).listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
try {
  const values = new Map();
  const client = createApiClient({
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    storage: {
      getItem: async (k) => values.get(k),
      setItem: async (k, v) => values.set(k, v),
      removeItem: async (k) => values.delete(k),
    },
  });
  const account = await client.register({
    email: "client@example.test",
    name: "Synthetic client",
    password: "Synthetic-client-password!",
    phone: "+255700009999",
  });
  assert.equal(account.accountStatus, "pending");
  assert.equal((await client.call("/me")).id, account.id);
  await assert.rejects(client.call("/requests"), { status: 403 });
  await client.logout();
  assert.equal(await client.restore(), null);
  await client.login("client@example.test", "Synthetic-client-password!");
  assert.equal((await client.restore()).id, account.id);
  await client.logout();
  console.log(
    "PASS: actual frontend client → HTTP Express → PostgreSQL register/login/me/pending restriction/restore/logout.",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
