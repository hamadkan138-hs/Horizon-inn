const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

const SOURCES = ['site', 'google', 'tripadvisor'];

function parseReview(row) {
  return {
    id: Number(row.id), guestName: row.guest_name, rating: Number(row.rating), comment: row.comment,
    source: row.source, status: row.status, bookingId: row.booking_id ? Number(row.booking_id) : null,
    createdAt: row.created_at
  };
}

// Public: approved reviews only, for the site's "What Our Guests Say" section.
router.get('/public', async (req, res) => {
  try {
    const result = await db.execute(
      "SELECT * FROM reviews WHERE status = 'approved' ORDER BY created_at DESC LIMIT 30"
    );
    res.json(result.rows.map(parseReview));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

// Public: a guest submitting their own review. Always starts pending —
// nothing a visitor submits appears on the site until an admin approves it.
router.post('/', async (req, res) => {
  try {
    const { guestName, rating, comment, bookingId } = req.body;
    const ratingNum = Number(rating);
    if (!guestName || !ratingNum || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Guest name and a rating from 1 to 5 are required' });
    }
    const result = await db.execute({
      sql: `INSERT INTO reviews (guest_name, rating, comment, source, status, booking_id) VALUES (?, ?, ?, 'site', 'pending', ?)`,
      args: [guestName, ratingNum, comment || '', bookingId || null]
    });
    const created = await db.execute({ sql: 'SELECT * FROM reviews WHERE id = ?', args: [Number(result.lastInsertRowid)] });
    res.status(201).json(parseReview(created.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

router.use(adminAuth, requireRole('admin', 'staff'));

router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const result = status
      ? await db.execute({ sql: 'SELECT * FROM reviews WHERE status = ? ORDER BY created_at DESC', args: [status] })
      : await db.execute('SELECT * FROM reviews ORDER BY created_at DESC');
    res.json(result.rows.map(parseReview));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

// Admin adding a review sourced from an external platform (Google, TripAdvisor)
// — inserted already approved, since it was already public somewhere else.
router.post('/admin', async (req, res) => {
  try {
    const { guestName, rating, comment, source } = req.body;
    const ratingNum = Number(rating);
    if (!guestName || !ratingNum || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Guest name and a rating from 1 to 5 are required' });
    }
    if (!SOURCES.includes(source)) {
      return res.status(400).json({ error: `source must be one of: ${SOURCES.join(', ')}` });
    }
    const result = await db.execute({
      sql: `INSERT INTO reviews (guest_name, rating, comment, source, status) VALUES (?, ?, ?, ?, 'approved')`,
      args: [guestName, ratingNum, comment || '', source]
    });
    const created = await db.execute({ sql: 'SELECT * FROM reviews WHERE id = ?', args: [Number(result.lastInsertRowid)] });
    res.status(201).json(parseReview(created.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add review' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be pending, approved, or rejected' });
    }
    await db.execute({ sql: 'UPDATE reviews SET status = ? WHERE id = ?', args: [status, req.params.id] });
    const updated = await db.execute({ sql: 'SELECT * FROM reviews WHERE id = ?', args: [req.params.id] });
    if (!updated.rows[0]) return res.status(404).json({ error: 'Review not found' });
    res.json(parseReview(updated.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update review' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM reviews WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

module.exports = router;
