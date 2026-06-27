'use strict';

require('dotenv').config({ override: true });
const { Pool } = require('pg');

const SOURCE_URL = process.env.SOURCE_DATABASE_URL;
const DEST_URL = process.env.DATABASE_URL;

if (!SOURCE_URL) { console.error('ERROR: SOURCE_DATABASE_URL is not set'); process.exit(1); }
if (!DEST_URL)   { console.error('ERROR: DATABASE_URL is not set'); process.exit(1); }

const sslOpt = process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;

const src = new Pool({ connectionString: SOURCE_URL, ssl: sslOpt });
const dst = new Pool({ connectionString: DEST_URL,   ssl: sslOpt });

async function run() {
  console.log('Connecting to source DB...');
  await src.query('SELECT 1');
  console.log('Connecting to destination DB...');
  await dst.query('SELECT 1');

  console.log('Fetching products from source...');
  const { rows } = await src.query(
    `SELECT name, category, price, stock,
            length_cm, width_cm, height_cm, weight_kg, stackable, top_only
     FROM products
     ORDER BY id`
  );
  console.log(`Found ${rows.length} product(s) in source.`);

  if (rows.length === 0) {
    console.log('Nothing to copy.');
    return;
  }

  console.log('Truncating destination products table...');
  await dst.query('TRUNCATE products RESTART IDENTITY CASCADE');

  console.log('Inserting products into destination...');
  let copied = 0;
  for (const p of rows) {
    await dst.query(
      `INSERT INTO products
         (name, category, price, stock, length_cm, width_cm, height_cm, weight_kg, stackable, top_only)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        p.name, p.category,
        p.price, p.stock,
        p.length_cm, p.width_cm, p.height_cm, p.weight_kg,
        p.stackable, p.top_only,
      ]
    );
    copied++;
  }
  console.log(`Done — copied ${copied} product(s).`);
}

run()
  .catch((e) => { console.error('Error:', e.message); process.exitCode = 1; })
  .finally(async () => {
    await src.end().catch(() => {});
    await dst.end().catch(() => {});
  });
