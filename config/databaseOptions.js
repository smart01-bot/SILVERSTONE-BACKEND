import { readFileSync } from 'node:fs';

export function databaseOptions(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL environment variable is not set');
  let url;
  try { url = new URL(env.DATABASE_URL); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use postgres or postgresql');
  }
  // pg connection-string SSL parameters override the explicit ssl object.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) {
    url.searchParams.delete(key);
  }
  let ca;
  if (env.DATABASE_SSL_CA_FILE) {
    try { ca = readFileSync(env.DATABASE_SSL_CA_FILE, 'utf8'); }
    catch { throw new Error('Unable to read the database CA file'); }
  }
  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ...(ca ? { ca } : {}),
    },
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
    max: 20,
  };
}
