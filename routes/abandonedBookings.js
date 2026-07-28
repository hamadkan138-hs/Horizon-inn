const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

function parseAbandoned(row) {
  return {
    id: Number(row.id), name: row.name, email: row.email, phone: row.phone,
    roomId: row.room_id ? Number(row.room_id) : null, checkin: row.checkin, checkout: row.checkout,
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

// Public: fired from the booking form once name+email+phone are filled in,
// before the guest necessarily finishes and submits. Best-effort — if the
// same email/phone already has an open capture from the last few hours,
// update it in place instead of creating duplicate rows per keystroke.
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, roomId, checkin, checkout } = req.body;
    if (!email && !phone) {
      return res.status(400).json({ error: 'Email or phone is required' });
    }
    const existing = await db.execute({
      sql: `
        SELECT id FROM abandoned_bookings
        WHERE status = 'open' AND (email = ? OR phone = ?) AND created_at > datetime('now', '-6 hours')
        ORDER BY created_at DESC LIMIT 1
      `,
      args: [email || '', phone || '']
    });
    if (existing.rows[0]) {
      await db.execute({
        sql: `UPDATE abandoned_bookings SET name = ?, email = ?, phone = ?, room_id = ?, checkin = ?, checkout = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [name || '', email || '', phone || '', roomId || null, checkin || null, checkout || null, existing.rows[0].id]
      });
      return res.json({ id: Number(existing.rows[0].id) });
    }
    const result = await db.execute({
      sql: `INSERT INTO abandoned_bookings (name, email, phone, room_id, checkin, checkout) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [name || '', email || '', phone || '', roomId || null, checkin || null, checkout || null]
    });
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record interest' });
  }
});

router.use(adminAuth, requireRole('admin', 'staff'));

router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const result = status
      ? await db.execute({ sql: 'SELECT * FROM abandoned_bookings WHERE status = ? ORDER BY updated_at DESC', args: [status] })
      : await db.execute('SELECT * FROM abandoned_bookings ORDER BY updated_at DESC');
    res.json(result.rows.map(parseAbandoned));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load recovery list' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['open', 'contacted', 'converted', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await db.execute({ sql: "UPDATE abandoned_bookings SET status = ?, updated_at = datetime('now') WHERE id = ?", args: [status, req.params.id] });
    const updated = await db.execute({ sql: 'SELECT * FROM abandoned_bookings WHERE id = ?', args: [req.params.id] });
    if (!updated.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(parseAbandoned(updated.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update' });
  }
});

module.exports = router;
