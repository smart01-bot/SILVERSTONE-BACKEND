import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { Client } from 'pg';
import { createClient } from 'redis';
import { databaseOptions } from '../config/databaseOptions.js';
import { verifyPublicSchema } from '../config/schema.js';

dotenv.config({ quiet: true });

// Honor managed environment policy before opening any service socket.
// Raw TCP in this runtime requires the approved VPN/CONNECT forwarding path.
const policyPath = '/etc/codex/network-policy.json';
if (existsSync(policyPath)) {
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  const grants = policy.tcp_network_access;
  if (policy.version !== 1 || !policy.vpn_configured ||
      (!grants?.domains?.length && !grants?.ip_ranges?.length)) {
    console.log('Supabase: BLOCKED by environment TCP policy; not verified');
    console.log('Redis: BLOCKED by environment TCP policy; not verified');
    process.exitCode = 1;
  } else {
    console.log('Use approved TCP forwards preserving TLS hostname verification before running these probes.');
    process.exitCode = 1;
  }
} else {
  // No model imports, migrations, worker, queue operations, or row data reads.
  async function checkDatabase() {
    let client;
    try {
      client = new Client(databaseOptions());
      await client.connect();
      await client.query('BEGIN READ ONLY');
      await client.query('SELECT 1 AS ok');
      await verifyPublicSchema({ manyOrNone: async (sql, args) => (await client.query(sql, args)).rows });
      await client.query('ROLLBACK');
      console.log('Supabase: verified TLS, authentication, and read-only SELECT 1/schema metadata');
    } catch {
      console.log('Supabase: FAILED; check network access, credentials, schema compatibility, and CA trust');
      process.exitCode = 1;
    } finally {
      if (client) await client.end().catch(() => {});
    }
  }
  async function checkRedis() {
    let client;
    try {
      if (!process.env.REDIS_HOST) throw new Error('Missing Redis configuration');
      client = createClient({
        username: process.env.REDIS_USERNAME,
        password: process.env.REDIS_PASSWORD,
        socket: {
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT || 6379),
          tls: true,
          rejectUnauthorized: true,
          connectTimeout: 10000,
          reconnectStrategy: false,
        },
      });
      client.on('error', () => {});
      await client.connect();
      if (await client.ping() !== 'PONG') throw new Error('Unexpected PING reply');
      console.log('Redis: verified TLS, authentication, and PING');
    } catch {
      console.log('Redis: FAILED; check network access, credentials, and CA trust');
      process.exitCode = 1;
    } finally {
      if (client?.isOpen) await client.quit().catch(() => client.destroy());
    }
  }
  await Promise.all([checkDatabase(), checkRedis()]);
}
