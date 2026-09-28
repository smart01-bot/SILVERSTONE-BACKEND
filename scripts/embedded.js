// Test/dev-only PostgreSQL engine. No filesystem data directory or network URL.
import { PGlite } from "@electric-sql/pglite";
export async function embeddedDatabase({ snapshot } = {}) {
  const engine = new PGlite(snapshot ? { loadDataDir: snapshot } : {});
  await engine.waitReady;
  const wrap = (connection) => ({
    query: async (sql, values) =>
      values === undefined
        ? (await connection.exec(sql)).at(-1) || { rows: [] }
        : connection.query(sql, values),
  });
  return {
    syntheticOnly: true,
    ...wrap(engine),
    transaction: (fn) => engine.transaction((tx) => fn(wrap(tx))),
    snapshot: () => engine.dumpDataDir(),
    close: () => engine.close(),
  };
}
