import pg from "pg";

export function assertLocalDatabase(url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new Error(
      "Set SILVERSTONE_DATABASE_URL to an isolated local PostgreSQL database.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    !/^\/silverstone_(test|dev)$/.test(target.pathname)
  ) {
    throw new Error(
      "Phase 1 only permits local silverstone_test or silverstone_dev databases.",
    );
  }
  return url;
}

export function connectDatabase(url) {
  const pool = new pg.Pool({
    connectionString: assertLocalDatabase(url),
    max: 5,
  });
  return {
    query: (sql, values) => pool.query(sql, values),
    async transaction(fn) {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const result = await fn(connection);
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
    },
    close: () => pool.end(),
  };
}
