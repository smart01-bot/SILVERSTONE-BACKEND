import pgp from 'pg-promise';
import dotenv from 'dotenv';

dotenv.config({quiet: true});

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('❌ SUPABASE_DB_URI environment variable is not set');
}

// Initialize pg-promise
const initOptions = {
  error: (error, e) => {
    console.error('❌ Database error:', error.message || error);
  }
};
const pgPromise = pgp(initOptions);

// Create database connection
const db = pgPromise({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20 // Adjust based on Supabase plan (free tier: ~100 connections)
});

// Test connection on startup
db.connect()
  .then(obj => {
    console.log('✅ PostgreSQL connected to Supabase (pg-promise)');
    obj.done(); // Release the connection
  })
  .catch(error => {
    console.error('❌ Connection failed:', error.message || error);
    process.exit(1); // Exit on failure to prevent app running without DB
  });

export default db;