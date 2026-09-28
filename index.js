import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createApp } from './foundation/app.js';
import { connectDatabase } from './foundation/database.js';
export { createApp };

// Importing this file never listens, connects, migrates, or starts a worker.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db=connectDatabase(process.env.SILVERSTONE_DATABASE_URL);
  try {
    const app=createApp({db,secret:process.env.SILVERSTONE_JWT_SECRET});
    await db.query('SELECT name FROM ss_v1.schema_migrations');
    const server=app.listen(Number(process.env.PORT || 8800),'127.0.0.1',() => console.log('Silverstone API on localhost; payments disabled.'));
    for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(async()=>{await db.close();process.exit(0);}));
  } catch(error) { await db.close(); console.error('Startup failed:',error.message);process.exitCode=1; }
}
