const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

function parsePromo(row) {
  return {
    id: Number(row.id), code: row.code, discountPercent: Number(row.discount_percent),
    maxUses: row.max_uses === null ? null : Number(row.max_uses), usedCount: Number(row.used_count),
    active: !!row.active, expiresAt: row.expires_at, createdAt: row.created_at
  };
}

router.use(adminAuth, requireRole('admin', 'staff'));

router.get('/', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM promo_codes ORDER BY created_at DESC');
    res.json(result.rows.map(parsePromo));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load promo codes' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { code, discountPercent, maxUses, expiresAt } = req.body;
    if (!code || !discountPercent || discountPercent <= 0 || discountPercent > 100) {
      return res.status(400).json({ error: 'A code and a discount percent between 1 and 100 are required' });
    }
    const result = await db.execute({
      sql: 'INSERT INTO promo_codes (code, discount_percent, max_uses, expires_at) VALUES (?, ?, ?, ?)',
      args: [code.trim().toUpperCase(), discountPercent, maxUses || null, expiresAt || null]
    });
    const created = await db.execute({ sql: 'SELECT * FROM promo_codes WHERE id = ?', args: [Number(result.lastInsertRowid)] });
    res.status(201).json(parsePromo(created.rows[0]));
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(400).json({ error: 'That code already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create promo code' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { active } = req.body;
    await db.execute({ sql: 'UPDATE promo_codes SET active = ? WHERE id = ?', args: [active ? 1 : 0, req.params.id] });
    const updated = await db.execute({ sql: 'SELECT * FROM promo_codes WHERE id = ?', args: [req.params.id] });
    if (!updated.rows[0]) return res.status(404).json({ error: 'Promo code not found' });
    res.json(parsePromo(updated.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update promo code' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM promo_codes WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete promo code' });
  }
});

module.exports = router;
