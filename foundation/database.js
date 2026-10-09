import pg from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOCAL_DATABASE = /^\/silverstone_(test|dev)$/;

function parseDatabaseUrl(url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new Error("Set SILVERSTONE_DATABASE_URL or DATABASE_URL to a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(target.protocol))
    throw new Error("Silverstone database URL must use PostgreSQL.");
  return target;
}

function isLocalTarget(target) {
  return LOCAL_HOSTS.has(target.hostname) && LOCAL_DATABASE.test(target.pathname);
}

export function assertLocalDatabase(url) {
  const target = parseDatabaseUrl(url);
  if (!isLocalTarget(target)) {
    throw new Error(
      "Local mode only permits silverstone_test or silverstone_dev on localhost.",
    );
  }
  return url;
}

export function assertHostedDatabase(url) {
  const target = parseDatabaseUrl(url);
  if (LOCAL_HOSTS.has(target.hostname))
    throw new Error("Hosted database mode requires a non-local PostgreSQL host.");
  return url;
}

export function connectDatabase(url, { allowRemote = false } = {}) {
  const target = parseDatabaseUrl(url);
  const local = isLocalTarget(target);
  const connectionString = local
    ? assertLocalDatabase(url)
    : allowRemote
      ? assertHostedDatabase(url)
      : assertLocalDatabase(url);

  // Hosted PostgreSQL always uses verified TLS. Do not depend on a query-string
  // flag being embedded in the secret Render connection URL.
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    ...(local ? {} : { ssl: { rejectUnauthorized: true } }),
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
