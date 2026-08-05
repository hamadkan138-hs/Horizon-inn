const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;
const { recomputeBookingTotal } = require('../lib/billing');
const { assertBookingUnlocked, BookingLockedError } = require('../lib/lock');

const router = express.Router();

router.use(adminAuth, requireRole('admin', 'staff'));

router.get('/', async (req, res) => {
  try {
    const status = req.query.status;
    const where = status ? 'WHERE status = ?' : '';
    const args = status ? [status] : [];
    const result = await db.execute({
      sql: `SELECT * FROM customer_dues ${where} ORDER BY created_at DESC`,
      args
    });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load customer dues' });
  }
});

// Collect a guest's outstanding due against a new stay: adds it as a charge
// line on the given (new) booking and marks the due settled, linked to that
// booking. One request rather than two separate manual steps, so a due
// can't end up half-applied (charged but not marked settled, or vice versa).
router.post('/:id/apply/:bookingId', requireRole('admin', 'staff'), async (req, res) => {
  try {
    const due = await db.execute({ sql: 'SELECT * FROM customer_dues WHERE id = ?', args: [req.params.id] });
    if (!due.rows[0]) {
      return res.status(404).json({ error: 'Due not found' });
    }
    if (due.rows[0].status !== 'outstanding') {
      return res.status(400).json({ error: 'This due has already been settled' });
    }
    const booking = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.bookingId] });
    if (!booking.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    assertBookingUnlocked(booking.rows[0]);

    await db.execute({
      sql: "INSERT INTO booking_charges (booking_id, description, amount, category) VALUES (?, ?, ?, 'other')",
      args: [req.params.bookingId, `Previous stay balance (booking #${due.rows[0].booking_id})`, due.rows[0].amount]
    });
    await db.execute({
      sql: "UPDATE customer_dues SET status = 'settled', settled_booking_id = ?, settled_at = datetime('now') WHERE id = ?",
      args: [req.params.bookingId, req.params.id]
    });
    const totals = await recomputeBookingTotal(req.params.bookingId);

    const updatedDue = await db.execute({ sql: 'SELECT * FROM customer_dues WHERE id = ?', args: [req.params.id] });
    res.json({ due: updatedDue.rows[0], totals });
  } catch (err) {
    if (err instanceof BookingLockedError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to apply due to booking' });
  }
});

// Admin correction: waive a due (e.g. the guest paid in person and it was
// never recorded as a booking charge) without applying it to a booking.
router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (status !== 'waived') {
      return res.status(400).json({ error: "status must be 'waived'" });
    }
    const due = await db.execute({ sql: 'SELECT * FROM customer_dues WHERE id = ?', args: [req.params.id] });
    if (!due.rows[0]) {
      return res.status(404).json({ error: 'Due not found' });
    }
    if (due.rows[0].status !== 'outstanding') {
      return res.status(400).json({ error: 'This due has already been settled or waived' });
    }
    await db.execute({
      sql: "UPDATE customer_dues SET status = 'waived', settled_at = datetime('now') WHERE id = ?",
      args: [req.params.id]
    });
    const updated = await db.execute({ sql: 'SELECT * FROM customer_dues WHERE id = ?', args: [req.params.id] });
    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update due' });
  }
});

module.exports = router;
