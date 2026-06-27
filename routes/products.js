'use strict';

module.exports = function productsRoutes(pool) {
  const router = require('express').Router();

  // GET all products
  router.get('/products', async (req, res) => {
    try {
      const r = await pool.query('SELECT * FROM products ORDER BY name');
      res.json(r.rows);
    } catch (e) {
      console.error('[products GET]', e);
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  });

  // POST create product
  router.post('/products', async (req, res) => {
    try {
      const {
        name, category,
        price = 0, stock = 0,
        length_cm, width_cm, height_cm, weight_kg,
        stackable, top_only,
      } = req.body;
      if (!name || !category) return res.status(400).json({ error: 'name and category are required' });
      const r = await pool.query(
        `INSERT INTO products
           (name, category, price, stock, length_cm, width_cm, height_cm, weight_kg, stackable, top_only)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          name, category,
          parseFloat(price) || 0,
          parseInt(stock, 10) || 0,
          length_cm ?? null, width_cm ?? null, height_cm ?? null, weight_kg ?? null,
          stackable ?? null, top_only ?? null,
        ]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) {
      console.error('[products POST]', e);
      res.status(500).json({ error: 'Failed to create product' });
    }
  });

  // PUT update product (name + category required; dimension/flag fields use COALESCE for partial updates)
  router.put('/products/:id', async (req, res) => {
    try {
      const { name, category, length_cm, width_cm, height_cm, weight_kg, stackable, top_only } = req.body;
      if (!name || !category) return res.status(400).json({ error: 'name and category are required' });
      const r = await pool.query(
        `UPDATE products SET
           name=$1,
           category=$2,
           length_cm=COALESCE($3, length_cm),
           width_cm=COALESCE($4, width_cm),
           height_cm=COALESCE($5, height_cm),
           weight_kg=COALESCE($6, weight_kg),
           stackable=COALESCE($7, stackable),
           top_only=COALESCE($8, top_only)
         WHERE id=$9
         RETURNING *`,
        [
          name, category,
          length_cm ?? null, width_cm ?? null, height_cm ?? null, weight_kg ?? null,
          stackable ?? null, top_only ?? null,
          req.params.id,
        ]
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'Product not found' });
      res.json(r.rows[0]);
    } catch (e) {
      console.error('[products PUT]', e);
      res.status(500).json({ error: 'Failed to update product' });
    }
  });

  // DELETE product
  router.delete('/products/:id', async (req, res) => {
    try {
      const r = await pool.query('DELETE FROM products WHERE id=$1 RETURNING id', [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Product not found' });
      res.json({ ok: true });
    } catch (e) {
      console.error('[products DELETE]', e);
      res.status(500).json({ error: 'Failed to delete product' });
    }
  });

  return router;
};
