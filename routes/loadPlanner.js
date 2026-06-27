'use strict';
const express = require('express');
const { pack } = require('../packer/packer');

module.exports = function loadPlannerRoutes(pool) {
  const router = express.Router();

  // ===== TRUCKS =====
  router.get('/trucks', async (req, res) => {
    try {
      const r = await pool.query('SELECT * FROM trucks ORDER BY name');
      res.json(r.rows);
    } catch { res.status(500).json({ error: 'Failed to fetch trucks' }); }
  });

  router.post('/trucks', async (req, res) => {
    try {
      const { name, cargo_length_cm, cargo_width_cm, cargo_height_cm, max_payload_kg } = req.body;
      if (!name) return res.status(400).json({ error: 'Name is required' });
      const r = await pool.query(
        `INSERT INTO trucks (name, cargo_length_cm, cargo_width_cm, cargo_height_cm, max_payload_kg)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [name, cargo_length_cm, cargo_width_cm, cargo_height_cm, max_payload_kg]);
      res.status(201).json(r.rows[0]);
    } catch { res.status(500).json({ error: 'Failed to create truck' }); }
  });

  router.put('/trucks/:id', async (req, res) => {
    try {
      const { name, cargo_length_cm, cargo_width_cm, cargo_height_cm, max_payload_kg } = req.body;
      const r = await pool.query(
        `UPDATE trucks SET name=$1, cargo_length_cm=$2, cargo_width_cm=$3,
         cargo_height_cm=$4, max_payload_kg=$5 WHERE id=$6 RETURNING *`,
        [name, cargo_length_cm, cargo_width_cm, cargo_height_cm, max_payload_kg, req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Truck not found' });
      res.json(r.rows[0]);
    } catch { res.status(500).json({ error: 'Failed to update truck' }); }
  });

  router.delete('/trucks/:id', async (req, res) => {
    try {
      await pool.query('DELETE FROM trucks WHERE id=$1', [req.params.id]);
      res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Failed to delete truck' }); }
  });

  // ===== TRIPS =====
  router.get('/trips', async (req, res) => {
    try {
      const r = await pool.query('SELECT * FROM trips ORDER BY created_at DESC');
      res.json(r.rows);
    } catch { res.status(500).json({ error: 'Failed to fetch trips' }); }
  });

  router.get('/trips/:id', async (req, res) => {
    try {
      const trip = await pool.query('SELECT * FROM trips WHERE id=$1', [req.params.id]);
      if (!trip.rows[0]) return res.status(404).json({ error: 'Trip not found' });
      const stops = await pool.query(
        'SELECT * FROM trip_stops WHERE trip_id=$1 ORDER BY sequence_index', [req.params.id]);
      const items = await pool.query(
        `SELECT ti.*, p.name, p.length_cm, p.width_cm, p.height_cm,
                p.weight_kg, p.stackable, p.top_only
         FROM trip_items ti JOIN products p ON p.id = ti.product_id
         WHERE ti.trip_id=$1`, [req.params.id]);
      res.json({ ...trip.rows[0], stops: stops.rows, items: items.rows });
    } catch { res.status(500).json({ error: 'Failed to fetch trip' }); }
  });

  router.post('/trips', async (req, res) => {
    try {
      const { name, truck_id, priority_preset } = req.body;
      if (!name) return res.status(400).json({ error: 'Name is required' });
      const r = await pool.query(
        `INSERT INTO trips (name, truck_id, priority_preset)
         VALUES ($1,$2,$3) RETURNING *`,
        [name, truck_id || null, priority_preset || 'balanced']);
      res.status(201).json(r.rows[0]);
    } catch { res.status(500).json({ error: 'Failed to create trip' }); }
  });

  router.put('/trips/:id', async (req, res) => {
    try {
      const { name, truck_id, priority_preset } = req.body;
      const r = await pool.query(
        `UPDATE trips SET name=COALESCE($1,name), truck_id=COALESCE($2,truck_id),
         priority_preset=COALESCE($3,priority_preset) WHERE id=$4 RETURNING *`,
        [name, truck_id, priority_preset, req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Trip not found' });
      res.json(r.rows[0]);
    } catch { res.status(500).json({ error: 'Failed to update trip' }); }
  });

  router.delete('/trips/:id', async (req, res) => {
    try {
      await pool.query('DELETE FROM trips WHERE id=$1', [req.params.id]);
      res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Failed to delete trip' }); }
  });

  // ===== STOPS (replace-all for a trip; keeps ordering simple) =====
  router.put('/trips/:id/stops', async (req, res) => {
    let client;
    try {
      client = await pool.connect();
      const stops = Array.isArray(req.body.stops) ? req.body.stops : [];
      await client.query('BEGIN');
      await client.query('DELETE FROM trip_stops WHERE trip_id=$1', [req.params.id]);
      const out = [];
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        const r = await client.query(
          `INSERT INTO trip_stops (trip_id, sequence_index, label, lat, lng, type)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [req.params.id, i, s.label || `Stop ${i + 1}`, s.lat || null, s.lng || null, s.type || 'delivery']);
        out.push(r.rows[0]);
      }
      await client.query('COMMIT');
      res.json(out);
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: 'Failed to save stops' });
    } finally { if (client) client.release(); }
  });

  // ===== ITEMS (replace-all for a trip) =====
  router.put('/trips/:id/items', async (req, res) => {
    let client;
    try {
      client = await pool.connect();
      const items = Array.isArray(req.body.items) ? req.body.items : [];
      await client.query('BEGIN');
      await client.query('DELETE FROM trip_items WHERE trip_id=$1', [req.params.id]);
      const out = [];
      for (const it of items) {
        const r = await client.query(
          `INSERT INTO trip_items (trip_id, stop_id, product_id, quantity)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [req.params.id, it.stop_id, it.product_id, parseInt(it.quantity, 10) || 1]);
        out.push(r.rows[0]);
      }
      await client.query('COMMIT');
      res.json(out);
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: 'Failed to save items' });
    } finally { if (client) client.release(); }
  });

  // ===== PACK =====
  router.post('/trips/:id/pack', async (req, res) => {
    try {
      const tripId = req.params.id;
      const trip = await pool.query('SELECT * FROM trips WHERE id=$1', [tripId]);
      if (!trip.rows[0]) return res.status(404).json({ error: 'Trip not found' });
      if (!trip.rows[0].truck_id) return res.status(400).json({ error: 'Trip has no truck' });

      const truck = await pool.query('SELECT * FROM trucks WHERE id=$1', [trip.rows[0].truck_id]);
      if (!truck.rows[0]) return res.status(400).json({ error: 'Truck not found' });

      const stops = await pool.query(
        'SELECT id, sequence_index FROM trip_stops WHERE trip_id=$1 ORDER BY sequence_index', [tripId]);
      const stopIndex = Object.fromEntries(stops.rows.map((s) => [s.id, s.sequence_index]));

      const items = await pool.query(
        `SELECT ti.id, ti.product_id, ti.stop_id, ti.quantity,
                p.length_cm, p.width_cm, p.height_cm, p.weight_kg, p.stackable, p.top_only
         FROM trip_items ti JOIN products p ON p.id = ti.product_id
         WHERE ti.trip_id=$1`, [tripId]);

      const orphanUnplaced = [];
      const validRows = [];
      for (const it of items.rows) {
        if (it.stop_id in stopIndex) validRows.push(it);
        else orphanUnplaced.push({ box_id: `item-${it.id}`, reason: 'orphaned_stop' });
      }

      const input = {
        truck: {
          length_cm: Number(truck.rows[0].cargo_length_cm),
          width_cm: Number(truck.rows[0].cargo_width_cm),
          height_cm: Number(truck.rows[0].cargo_height_cm),
          max_payload_kg: Number(truck.rows[0].max_payload_kg),
        },
        items: validRows.map((it) => ({
          id: it.id,
          product_id: it.product_id,
          stop_index: stopIndex[it.stop_id],
          quantity: it.quantity,
          length_cm: it.length_cm === null ? null : Number(it.length_cm),
          width_cm: it.width_cm === null ? null : Number(it.width_cm),
          height_cm: it.height_cm === null ? null : Number(it.height_cm),
          weight_kg: it.weight_kg === null ? null : Number(it.weight_kg),
          stackable: it.stackable,
          top_only: it.top_only,
        })),
        preset: trip.rows[0].priority_preset || 'balanced',
      };

      const result = pack(input);
      result.unplaced = [...result.unplaced, ...orphanUnplaced];
      await pool.query(
        `UPDATE trips SET packing_result=$1, status='packed' WHERE id=$2`,
        [JSON.stringify(result), tripId]);
      res.json(result);
    } catch (e) {
      console.error('[pack]', e);
      res.status(500).json({ error: 'Failed to pack trip' });
    }
  });

  return router;
};
