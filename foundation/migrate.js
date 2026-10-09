import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function migrate(db) {
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((f) => /^\d{3}-.+\.sql$/.test(f))
    .sort();
  await db.transaction(async (tx) => {
    const exists = (await tx.query("SELECT to_regnamespace('ss_v1') AS schema"))
      .rows[0].schema;
    if (exists) {
      const ledger = (
        await tx.query(
          "SELECT to_regclass('ss_v1.schema_migrations') AS ledger",
        )
      ).rows[0].ledger;
      if (!ledger) throw new Error("Unknown ss_v1 schema: migration refused.");
    } else {
      await tx.query("CREATE SCHEMA ss_v1");
      await tx.query(
        "CREATE TABLE ss_v1.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
      );
    }
    await tx.query("LOCK TABLE ss_v1.schema_migrations IN EXCLUSIVE MODE");
    const applied = (
      await tx.query("SELECT name, checksum FROM ss_v1.schema_migrations")
    ).rows;
    if (applied.some((row) => !files.includes(row.name)))
      throw new Error("Unknown migration version.");
    for (const name of files) {
      const sql = await readFile(new URL(name, directory), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const old = applied.find((row) => row.name === name);
      if (old?.checksum === "external") {
        await tx.query(
          "UPDATE ss_v1.schema_migrations SET checksum=$1 WHERE name=$2",
          [checksum, name],
        );
      } else if (old && old.checksum !== checksum) {
        throw new Error(`Migration checksum mismatch: ${name}`);
      }
      if (!old) {
        // PostgreSQL accepts a multi-statement migration with no bound values.
        await tx.query(sql);
        await tx.query(
          "INSERT INTO ss_v1.schema_migrations(name,checksum) VALUES ($1,$2)",
          [name, checksum],
        );
      }
    }
  });
}
