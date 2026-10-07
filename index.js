import { safeDiagnostic } from './config/diagnostics.js';
import { verifyPublicSchema } from './config/schema.js';
import app from './app.js';
import db from './config/database.js';
import redis from './config/redis.js';

let server;
async function shutdown() {
  app.locals.dependenciesReady = false;
  if (server) await new Promise(resolve => server.close(resolve));
  if (redis.isOpen) await redis.quit();
  await db.$pool.end();
}

let startupStage = 'configuration';
try {
  if (!process.env.JWT_SECRET) throw Object.assign(new Error('Missing JWT_SECRET'), { code: 'MISSING_JWT_SECRET' });
  if (process.env.ENABLE_QUEUE_WORKER === 'true') throw Object.assign(new Error('Legacy worker is incompatible'), { code: 'LEGACY_WORKER_DISABLED' });
  startupStage = 'PostgreSQL connection/TLS';
  await db.one('SELECT 1 AS ok');
  startupStage = 'public schema readiness';
  await verifyPublicSchema(db);
  startupStage = 'Redis TLS';
  await redis.connect();
  await redis.ping();
  const port = process.env.PORT || 8800;
  app.locals.checkDependencies = () => Promise.all([
    db.one('SELECT 1 AS ok'),
    redis.withCommandOptions({ abortSignal: AbortSignal.timeout(10000) }).ping(),
  ]);
  app.locals.dependenciesReady = true;
  server = app.listen(port, '0.0.0.0', () => console.log(`SERVER RUNNING ON PORT ${port}`));
  server.on('error', async () => {
    console.error('HTTP server failed to start');
    await shutdown();
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => { await shutdown(); });
  }
} catch (error) {
  console.error(`Backend startup failed at ${startupStage}: ${JSON.stringify(safeDiagnostic(error))}`);
  await shutdown();
  process.exitCode = 1;
}
