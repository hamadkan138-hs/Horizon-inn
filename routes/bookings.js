const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { isRoomAvailable } = require('../lib/availability');

const router = express.Router();

const PAYMENT_METHODS = ['pay_at_property', 'bank_transfer', 'easypaisa', 'jazzcash'];
const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed'];
const BOOKING_STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'paid'];

function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// Create a booking (public)
router.post('/', async (req, res) => {
  try {
    const {
      name, email, phone, roomId, checkin, checkout, guests, specialRequests,
      cnic, maritalStatus, arrivalFrom, departureTo, arrivalTime, purposeOfStay, vehicleNumber,
      paymentMethod, transactionId, termsAccepted
    } = req.body;

    if (!name || !email || !phone || !roomId || !checkin || !checkout || !guests) {
      return res.status(400).json({ error: 'Missing required guest or stay details' });
    }
    if (!cnic || !maritalStatus || !arrivalFrom || !departureTo) {
      return res.status(400).json({ error: 'CNIC/passport, marital status, arrival from and departure to are required' });
    }
    if (!MARITAL_STATUSES.includes(maritalStatus)) {
      return res.status(400).json({ error: 'Invalid marital status' });
    }
    if (!isValidDate(checkin) || !isValidDate(checkout)) {
      return res.status(400).json({ error: 'Dates must be in YYYY-MM-DD format' });
    }
    if (checkin >= checkout) {
      return res.status(400).json({ error: 'Check-out date must be after check-in date' });
    }
    if (!paymentMethod || !PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ error: 'Invalid payment method' });
    }
    if (paymentMethod !== 'pay_at_property' && !transactionId) {
      return res.status(400).json({ error: 'Transaction ID is required for advance payments' });
    }
    if (!termsAccepted) {
      return res.status(400).json({ error: 'You must accept the Terms & Conditions to book' });
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
        INSERT INTO bookings (
          room_id, name, email, phone, checkin, checkout, guests, special_requests,
          cnic, marital_status, arrival_from, departure_to, arrival_time, purpose_of_stay, vehicle_number,
          payment_method, transaction_id, terms_accepted, status, payment_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid')
      `,
      args: [
        roomId, name, email, phone, checkin, checkout, guests, specialRequests || '',
        cnic, maritalStatus, arrivalFrom, departureTo, arrivalTime || '', purposeOfStay || '', vehicleNumber || '',
        paymentMethod, transactionId || '', 1
      ]
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

// Update booking status and/or payment status (admin)
router.patch('/:id', adminAuth, async (req, res) => {
  try {
    const { status, paymentStatus } = req.body;

    if (status === undefined && paymentStatus === undefined) {
      return res.status(400).json({ error: 'Provide status and/or paymentStatus to update' });
    }
    if (status !== undefined && !BOOKING_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${BOOKING_STATUSES.join(', ')}` });
    }
    if (paymentStatus !== undefined && !PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({ error: `Payment status must be one of: ${PAYMENT_STATUSES.join(', ')}` });
    }

    const existingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    if (!existingResult.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const updates = [];
    const args = [];
    if (status !== undefined) { updates.push('status = ?'); args.push(status); }
    if (paymentStatus !== undefined) { updates.push('payment_status = ?'); args.push(paymentStatus); }
    args.push(req.params.id);

    await db.execute({ sql: `UPDATE bookings SET ${updates.join(', ')} WHERE id = ?`, args });
    const updatedResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    res.json(updatedResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

module.exports = router;
