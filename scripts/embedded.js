// Test/dev-only PostgreSQL engine. No filesystem data directory or network URL.
import { PGlite } from "@electric-sql/pglite";
export async function embeddedDatabase() {
  const engine = new PGlite();
  await engine.waitReady;
  const wrap = (connection) => ({
    query: async (sql, values) =>
      values === undefined
        ? (await connection.exec(sql)).at(-1) || { rows: [] }
        : connection.query(sql, values),
  });
  return {
    ...wrap(engine),
    transaction: (fn) => engine.transaction((tx) => fn(wrap(tx))),
    close: () => engine.close(),
  };
}
