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
  if (!process.env.JWT_SECRET) throw new Error('Missing JWT_SECRET');
  if (process.env.ENABLE_QUEUE_WORKER === 'true') throw new Error('Legacy worker is incompatible');
  startupStage = 'PostgreSQL TLS and schema';
  await db.one('SELECT 1 AS ok');
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
} catch {
  console.error(`Backend startup failed at ${startupStage}; check service access, TLS trust, and configuration`);
  await shutdown();
  process.exitCode = 1;
}
