#!/usr/bin/env node
// Runs the schema.sql against DATABASE_URL. Idempotent (CREATE IF NOT EXISTS).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../lib/db');

(async () => {
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  try {
    await pool.query(sql);
    console.log('[init-db] schema applied.');
  } catch (err) {
    console.error('[init-db] failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
