'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config({ override: true });

const app = express();
const PORT = process.env.PORT || 5060;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ===== AUTH =====
// Optional: set APP_PASSWORD to enable token auth. If unset, the API is open.
const APP_PASSWORD = (process.env.APP_PASSWORD || '').trim();
const AUTH_TOKEN = APP_PASSWORD
  ? crypto.createHash('sha256').update('pk-auth-v1:' + APP_PASSWORD).digest('hex')
  : null;

if (!APP_PASSWORD) {
  console.warn('WARNING: APP_PASSWORD is not set — the API is open to anyone with the URL.');
}

function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

if (APP_PASSWORD) {
  app.post('/api/login', (req, res) => {
    const pw = (req.body?.password || '').toString();
    if (pw && timingSafeEq(pw, APP_PASSWORD)) return res.json({ token: AUTH_TOKEN });
    res.status(401).json({ error: 'Wrong password' });
  });

  app.use('/api', (req, res, next) => {
    if (req.path === '/login' || req.path === '/health') return next();
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (token && timingSafeEq(token, AUTH_TOKEN)) return next();
    res.status(401).json({ error: 'Unauthorized' });
  });
} else {
  // No auth — provide a no-op login that returns an empty token
  app.post('/api/login', (req, res) => res.json({ token: '' }));
}

// ===== DATABASE =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function runMigrations() {
  // products table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id              SERIAL PRIMARY KEY,
      name            VARCHAR(255) NOT NULL,
      category        VARCHAR(100),
      price           DECIMAL(10,2) DEFAULT 0,
      stock           INT DEFAULT 0,
      length_cm       DECIMAL(7,1),
      width_cm        DECIMAL(7,1),
      height_cm       DECIMAL(7,1),
      weight_kg       DECIMAL(8,2),
      stackable       BOOLEAN DEFAULT true,
      top_only        BOOLEAN DEFAULT false,
      no_tilt         BOOLEAN DEFAULT false,
      no_rotate       BOOLEAN DEFAULT false,
      fragile         BOOLEAN DEFAULT false,
      load_bearing_kg DECIMAL(8,2),
      created_at      TIMESTAMP DEFAULT NOW()
    )
  `);

  // trucks table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trucks (
      id               SERIAL PRIMARY KEY,
      name             VARCHAR(255) NOT NULL,
      cargo_length_cm  DECIMAL(7,1) NOT NULL,
      cargo_width_cm   DECIMAL(7,1) NOT NULL,
      cargo_height_cm  DECIMAL(7,1) NOT NULL,
      max_payload_kg   DECIMAL(9,2) NOT NULL,
      created_at       TIMESTAMP DEFAULT NOW()
    )
  `);

  // trips table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trips (
      id               SERIAL PRIMARY KEY,
      name             VARCHAR(255) NOT NULL,
      truck_id         INT REFERENCES trucks(id),
      priority_preset  VARCHAR(20) DEFAULT 'balanced',
      packing_result   JSONB,
      status           VARCHAR(20) DEFAULT 'draft',
      created_at       TIMESTAMP DEFAULT NOW()
    )
  `);

  // trip_stops table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trip_stops (
      id               SERIAL PRIMARY KEY,
      trip_id          INT REFERENCES trips(id) ON DELETE CASCADE,
      sequence_index   INT NOT NULL,
      label            VARCHAR(255) NOT NULL,
      lat              DECIMAL(9,6),
      lng              DECIMAL(9,6),
      type             VARCHAR(12) DEFAULT 'delivery'
    )
  `);

  // trip_items table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trip_items (
      id               SERIAL PRIMARY KEY,
      trip_id          INT REFERENCES trips(id) ON DELETE CASCADE,
      stop_id          INT REFERENCES trip_stops(id) ON DELETE CASCADE,
      product_id       INT REFERENCES products(id),
      quantity         INT NOT NULL
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_trip_stops_trip ON trip_stops(trip_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_trip_items_trip ON trip_items(trip_id)`);
}

pool.query('SELECT NOW()').then(() => {
  console.log('DB connected');
  return runMigrations();
}).then(() => console.log('Migrations done'))
  .catch((e) => console.error('Startup error:', e.message));

// ===== ROUTES =====
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', require('./routes/products')(pool));
app.use('/api', require('./routes/loadPlanner')(pool));

// ===== STATIC / SPA =====
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log('Truck Load Planner on port ' + PORT));
