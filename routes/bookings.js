const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { isRoomAvailable } = require('../lib/availability');

const router = express.Router();

function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// Create a booking (public)
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, roomId, checkin, checkout, guests, specialRequests } = req.body;

    if (!name || !email || !phone || !roomId || !checkin || !checkout || !guests) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!isValidDate(checkin) || !isValidDate(checkout)) {
      return res.status(400).json({ error: 'Dates must be in YYYY-MM-DD format' });
    }
    if (checkin >= checkout) {
      return res.status(400).json({ error: 'Check-out date must be after check-in date' });
    }

    const roomResult = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [roomId] });
    const room = roomResult.rows[0];
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!(await isRoomAvailable(room, checkin, checkout))) {
      return res.status(409).json({ error: 'This room type is fully booked for the selected dates' });
    }

    const insertResult = await db.execute({
      sql: `
        INSERT INTO bookings (room_id, name, email, phone, checkin, checkout, guests, special_requests)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [roomId, name, email, phone, checkin, checkout, guests, specialRequests || '']
    });

    const bookingId = Number(insertResult.lastInsertRowid);
    const bookingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [bookingId] });
    const booking = bookingResult.rows[0];

    res.status(201).json({ booking, room: { ...room, features: JSON.parse(room.features) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong while creating the booking' });
  }
});

// List all bookings (admin)
router.get('/', adminAuth, async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT bookings.*, rooms.name AS room_name
      FROM bookings
      JOIN rooms ON rooms.id = bookings.room_id
      ORDER BY bookings.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load bookings' });
  }
});

// Update booking status (admin)
router.patch('/:id', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['confirmed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'confirmed' or 'cancelled'" });
    }

    const existingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    if (!existingResult.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    await db.execute({ sql: 'UPDATE bookings SET status = ? WHERE id = ?', args: [status, req.params.id] });
    const updatedResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    res.json(updatedResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

module.exports = router;
