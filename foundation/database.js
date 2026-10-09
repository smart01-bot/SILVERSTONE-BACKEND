import pg from "pg";
import { readFileSync } from "node:fs";

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

export function connectDatabase(url, { allowRemote = false, env = process.env } = {}) {
  const target = parseDatabaseUrl(url);
  const local = isLocalTarget(target);
  if (local) assertLocalDatabase(url);
  else if (allowRemote) assertHostedDatabase(url);
  else assertLocalDatabase(url);

  let connectionString = url;
  let ssl;
  if (!local) {
    // pg lets connection-string SSL parameters override the explicit ssl object,
    // so strip them before applying the trusted CA used by the hosted service.
    const cleaned = new URL(url);
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl"])
      cleaned.searchParams.delete(key);
    connectionString = cleaned.toString();

    let ca;
    if (env.DATABASE_SSL_CA_FILE) {
      try {
        ca = readFileSync(env.DATABASE_SSL_CA_FILE, "utf8");
      } catch {
        throw new Error("Unable to read the database CA file.");
      }
    }
    ssl = { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  }

  const pool = new pg.Pool({
    connectionString,
    max: 5,
    ...(ssl ? { ssl } : {}),
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
