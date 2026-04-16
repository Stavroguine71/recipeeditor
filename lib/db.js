const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL is not set. The app will fail on any DB call.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway Postgres requires SSL in production; local dev usually doesn't.
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : (process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false),
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
