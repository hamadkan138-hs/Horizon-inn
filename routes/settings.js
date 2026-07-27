const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

// Public — the site (and invoice page) needs these to render without logging in.
router.get('/', async (req, res) => {
  try {
    const result = await db.execute('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach((row) => { settings[row.key] = row.value; });
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load site settings' });
  }
});

router.patch('/', adminAuth, requireRole('admin'), async (req, res) => {
  try {
    const updates = req.body || {};
    const keys = Object.keys(updates);
    if (!keys.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    for (const key of keys) {
      await db.execute({
        sql: `
          INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `,
        args: [key, String(updates[key] ?? '')]
      });
    }
    const result = await db.execute('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach((row) => { settings[row.key] = row.value; });
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save site settings' });
  }
});

module.exports = router;
