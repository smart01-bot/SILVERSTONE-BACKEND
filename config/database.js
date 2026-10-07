import pgp from 'pg-promise';
import dotenv from 'dotenv';
import { databaseOptions } from './databaseOptions.js';

dotenv.config({ quiet: true });
const pgPromise = pgp({
  // Driver messages can contain connection details; don't log raw errors.
  error: () => console.error('Database operation failed'),
});
const db = pgPromise(databaseOptions());
export default db;
