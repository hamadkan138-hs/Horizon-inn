const express = require('express');
const db = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { isRoomAvailable } = require('../lib/availability');

const router = express.Router();

function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// Create a booking (public)
router.post('/', (req, res) => {
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

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (!isRoomAvailable(room, checkin, checkout)) {
    return res.status(409).json({ error: 'This room type is fully booked for the selected dates' });
  }

  const result = db.prepare(`
    INSERT INTO bookings (room_id, name, email, phone, checkin, checkout, guests, special_requests)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(roomId, name, email, phone, checkin, checkout, guests, specialRequests || '');

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ booking, room: { ...room, features: JSON.parse(room.features) } });
});

// List all bookings (admin)
router.get('/', adminAuth, (req, res) => {
  const bookings = db.prepare(`
    SELECT bookings.*, rooms.name AS room_name
    FROM bookings
    JOIN rooms ON rooms.id = bookings.room_id
    ORDER BY bookings.created_at DESC
  `).all();
  res.json(bookings);
});

// Update booking status (admin)
router.patch('/:id', adminAuth, (req, res) => {
  const { status } = req.body;
  if (!['confirmed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: "Status must be 'confirmed' or 'cancelled'" });
  }

  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);
  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  res.json(updated);
});

module.exports = router;
