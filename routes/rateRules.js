const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

router.use(adminAuth, requireRole('admin'));

function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

router.get('/', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT rate_rules.*, rooms.name AS room_name
      FROM rate_rules
      JOIN rooms ON rooms.id = rate_rules.room_id
      ORDER BY rate_rules.start_date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load rate rules' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { roomId, name, startDate, endDate, priceOverride, discountPercent } = req.body;

    if (!roomId || !name || !startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
      return res.status(400).json({ error: 'Invalid date range' });
    }
    if (!priceOverride && !discountPercent) {
      return res.status(400).json({ error: 'Provide either a price override or a discount percentage' });
    }

    const result = await db.execute({
      sql: `
        INSERT INTO rate_rules (room_id, name, start_date, end_date, price_override, discount_percent)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [roomId, name, startDate, endDate, priceOverride || null, discountPercent || null]
    });

    const created = await db.execute({ sql: 'SELECT * FROM rate_rules WHERE id = ?', args: [Number(result.lastInsertRowid)] });
    res.status(201).json(created.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create rate rule' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT * FROM rate_rules WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Rate rule not found' });
    }
    await db.execute({ sql: 'DELETE FROM rate_rules WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete rate rule' });
  }
});

module.exports = router;
