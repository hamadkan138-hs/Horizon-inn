const express = require('express');
const { db } = require('../db');

const router = express.Router();

// No admin auth — guests reach this via a link containing their booking's
// invoice_token, which only the admin dashboard can generate/copy.
router.get('/:id', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Missing invoice token' });
    }

    const result = await db.execute({
      sql: `
        SELECT bookings.*, rooms.name AS room_name, rooms.price AS room_price
        FROM bookings
        JOIN rooms ON rooms.id = bookings.room_id
        WHERE bookings.id = ?
      `,
      args: [req.params.id]
    });
    const booking = result.rows[0];
    if (!booking || booking.invoice_token !== token) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const paymentsResult = await db.execute({
      sql: 'SELECT * FROM payments WHERE booking_id = ? ORDER BY recorded_at ASC',
      args: [req.params.id]
    });
    const chargesResult = await db.execute({
      sql: 'SELECT * FROM booking_charges WHERE booking_id = ? ORDER BY created_at ASC',
      args: [req.params.id]
    });

    res.json({ ...booking, payments: paymentsResult.rows, charges: chargesResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load invoice' });
  }
});

module.exports = router;
