const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;
const { isRoomAvailable } = require('../lib/availability');
const { computeTotalAmount } = require('../lib/pricing');
const { recomputeBookingTotal } = require('../lib/billing');
const { assertBookingUnlocked, BookingLockedError } = require('../lib/lock');

const router = express.Router();

const PAYMENT_METHODS = ['pay_at_property', 'bank_transfer', 'easypaisa', 'jazzcash'];
const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed'];
const BOOKING_STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'];

function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// Create a booking (public)
router.post('/', async (req, res) => {
  try {
    const {
      name, email, phone, roomId, checkin, checkout, guests, specialRequests,
      cnic, maritalStatus, arrivalFrom, departureTo, arrivalTime, purposeOfStay, vehicleNumber, address,
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

    const roomAmount = await computeTotalAmount(room, checkin, checkout, guests);

    const insertResult = await db.execute({
      sql: `
        INSERT INTO bookings (
          room_id, name, email, phone, checkin, checkout, guests, special_requests,
          cnic, marital_status, arrival_from, departure_to, arrival_time, purpose_of_stay, vehicle_number, address,
          payment_method, transaction_id, terms_accepted, status, payment_status, total_amount, room_amount,
          invoice_token
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid', ?, ?, lower(hex(randomblob(12))))
      `,
      args: [
        roomId, name, email, phone, checkin, checkout, guests, specialRequests || '',
        cnic, maritalStatus, arrivalFrom, departureTo, arrivalTime || '', purposeOfStay || '', vehicleNumber || '', address || '',
        paymentMethod, transactionId || '', 1, roomAmount, roomAmount
      ]
    });

    const bookingId = Number(insertResult.lastInsertRowid);
    const year = new Date(checkin).getFullYear();
    const invoiceNumber = `INV-${year}-${String(bookingId).padStart(4, '0')}`;
    await db.execute({ sql: 'UPDATE bookings SET invoice_number = ? WHERE id = ?', args: [invoiceNumber, bookingId] });

    const bookingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [bookingId] });
    const booking = bookingResult.rows[0];

    res.status(201).json({ booking, room: { ...room, features: JSON.parse(room.features) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong while creating the booking' });
  }
});

// Quick advance booking (admin/staff) — for a guest who calls or walks in and
// pays an advance to lock a room before the full guest-registration paperwork
// is filled in (that happens later at actual check-in via /:id/details).
// The room is locked for the requested dates the instant this succeeds,
// because the booking is created with status 'confirmed' and every other
// route already treats 'confirmed'/'checked_in' bookings as occupying the
// room for overlap purposes.
router.post('/quick', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const { guestName, phone, roomId, checkin, checkout, advanceAmount, paymentMethod, transactionId } = req.body;

    if (!guestName || !phone || !roomId || !checkin || !checkout) {
      return res.status(400).json({ error: 'Guest name, phone, room and dates are required' });
    }
    if (!isValidDate(checkin) || !isValidDate(checkout) || checkin >= checkout) {
      return res.status(400).json({ error: 'Check-out date must be after check-in date' });
    }
    if (!advanceAmount || Number(advanceAmount) <= 0) {
      return res.status(400).json({ error: 'Advance amount must be greater than zero' });
    }
    const method = PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : 'pay_at_property';

    const roomResult = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [roomId] });
    const room = roomResult.rows[0];
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    if (!(await isRoomAvailable(room, checkin, checkout))) {
      return res.status(409).json({ error: 'Room already booked for selected dates' });
    }

    const roomAmount = await computeTotalAmount(room, checkin, checkout, 1);

    const insertResult = await db.execute({
      sql: `
        INSERT INTO bookings (
          room_id, name, email, phone, checkin, checkout, guests,
          payment_method, transaction_id, terms_accepted, status, payment_status, total_amount, room_amount,
          invoice_token
        )
        VALUES (?, ?, '', ?, ?, ?, 1, ?, ?, 1, 'confirmed', 'unpaid', ?, ?, lower(hex(randomblob(12))))
      `,
      args: [roomId, guestName, phone, checkin, checkout, method, transactionId || '', roomAmount, roomAmount]
    });

    const bookingId = Number(insertResult.lastInsertRowid);
    const year = new Date(checkin).getFullYear();
    const invoiceNumber = `INV-${year}-${String(bookingId).padStart(4, '0')}`;
    await db.execute({ sql: 'UPDATE bookings SET invoice_number = ? WHERE id = ?', args: [invoiceNumber, bookingId] });

    await db.execute({
      sql: `
        INSERT INTO payments (booking_id, amount, method, transaction_id, note, recorded_by)
        VALUES (?, ?, ?, ?, 'Advance payment (tax included)', ?)
      `,
      args: [bookingId, advanceAmount, method, transactionId || '', req.user.username]
    });

    const totals = await recomputeBookingTotal(bookingId);
    const bookingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [bookingId] });

    res.status(201).json({ booking: bookingResult.rows[0], advanceAmount: Number(advanceAmount), ...totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create advance booking' });
  }
});

// List all bookings (admin) — includes paid_total/balance so the Bookings and
// Payments tabs can render financial state without an N+1 query per row.
router.get('/', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT bookings.*, rooms.name AS room_name,
             COALESCE(p.paid, 0) AS paid_total,
             bookings.total_amount - COALESCE(p.paid, 0) AS balance
      FROM bookings
      JOIN rooms ON rooms.id = bookings.room_id
      LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = bookings.id
      ORDER BY bookings.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load bookings' });
  }
});

// Admin-only invoice metadata: room number assignment and printed notes
router.patch('/:id/invoice-fields', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const { roomNumber, invoiceNotes } = req.body;
    if (roomNumber === undefined && invoiceNotes === undefined) {
      return res.status(400).json({ error: 'Provide roomNumber and/or invoiceNotes to update' });
    }
    const existing = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    assertBookingUnlocked(existing.rows[0]);
    const updates = [];
    const args = [];
    if (roomNumber !== undefined) { updates.push('room_number = ?'); args.push(roomNumber); }
    if (invoiceNotes !== undefined) { updates.push('invoice_notes = ?'); args.push(invoiceNotes); }
    args.push(req.params.id);
    await db.execute({ sql: `UPDATE bookings SET ${updates.join(', ')} WHERE id = ?`, args });
    const updated = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    res.json(updated.rows[0]);
  } catch (err) {
    if (err instanceof BookingLockedError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to update invoice fields' });
  }
});

// Single booking with room + payment history + extra charges (admin) — used by invoice view
router.get('/:id', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
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
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
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
    res.status(500).json({ error: 'Failed to load booking' });
  }
});

// Edit booking details (admin) — dates, room, guest count, and guest-provided info
router.patch('/:id/details', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const editable = [
      'name', 'email', 'phone', 'guests', 'checkin', 'checkout', 'cnic', 'marital_status',
      'arrival_from', 'departure_to', 'arrival_time', 'purpose_of_stay', 'vehicle_number', 'special_requests'
    ];
    const fieldMap = {
      name: 'name', email: 'email', phone: 'phone', guests: 'guests', checkin: 'checkin', checkout: 'checkout',
      cnic: 'cnic', maritalStatus: 'marital_status', arrivalFrom: 'arrival_from', departureTo: 'departure_to',
      arrivalTime: 'arrival_time', purposeOfStay: 'purpose_of_stay', vehicleNumber: 'vehicle_number',
      specialRequests: 'special_requests'
    };

    const existing = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    const booking = existing.rows[0];
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    assertBookingUnlocked(booking);

    const updates = [];
    const args = [];
    for (const [bodyKey, column] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] !== undefined && editable.includes(column)) {
        updates.push(`${column} = ?`);
        args.push(req.body[bodyKey]);
      }
    }
    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const nextCheckin = req.body.checkin || booking.checkin;
    const nextCheckout = req.body.checkout || booking.checkout;
    if (!isValidDate(nextCheckin) || !isValidDate(nextCheckout) || nextCheckin >= nextCheckout) {
      return res.status(400).json({ error: 'Invalid check-in/check-out dates' });
    }

    let roomAmountChanged = false;
    if (req.body.checkin || req.body.checkout || req.body.guests !== undefined) {
      const roomResult = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [booking.room_id] });
      const room = roomResult.rows[0];
      const available = await isRoomAvailable(room, nextCheckin, nextCheckout, booking.id);
      if (!available) {
        return res.status(409).json({ error: 'Room is not available for the new dates' });
      }
      const nextGuests = req.body.guests !== undefined ? req.body.guests : booking.guests;
      const roomAmount = await computeTotalAmount(room, nextCheckin, nextCheckout, nextGuests);
      updates.push('room_amount = ?');
      args.push(roomAmount);
      roomAmountChanged = true;
    }

    args.push(req.params.id);
    await db.execute({ sql: `UPDATE bookings SET ${updates.join(', ')} WHERE id = ?`, args });

    if (roomAmountChanged) await recomputeBookingTotal(req.params.id);

    const updated = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    res.json(updated.rows[0]);
  } catch (err) {
    if (err instanceof BookingLockedError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to update booking details' });
  }
});

// Update booking status and/or payment status (admin)
router.patch('/:id', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
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
    const booking = existingResult.rows[0];
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    // A checked-out booking is settled and locked — no further status or
    // payment-status change is allowed, by anyone, including admins.
    assertBookingUnlocked(booking);

    // A confirmed (advance-paid, room-locked) booking can only be cancelled by
    // an admin — front-desk staff can't override a locked room on their own.
    if (status === 'cancelled' && booking.status === 'confirmed' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can cancel a room that has an advance payment locking it.' });
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
    if (err instanceof BookingLockedError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// Set a tax rate for the booking (admin) — recomputes total_amount and payment_status
router.patch('/:id/tax', adminAuth, requireRole('admin'), async (req, res) => {
  try {
    const { taxPercent } = req.body;
    if (taxPercent === undefined || taxPercent < 0 || taxPercent > 100) {
      return res.status(400).json({ error: 'taxPercent must be between 0 and 100' });
    }
    const existing = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    assertBookingUnlocked(existing.rows[0]);
    await db.execute({ sql: 'UPDATE bookings SET tax_percent = ? WHERE id = ?', args: [taxPercent, req.params.id] });
    const result = await recomputeBookingTotal(req.params.id);
    res.json(result);
  } catch (err) {
    if (err instanceof BookingLockedError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to update tax rate' });
  }
});

// Add a charge line to a booking (admin) — e.g. breakfast, laundry, airport
// pickup. A negative amount represents a discount and is subtracted.
router.post('/:id/charges', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const { description, amount } = req.body;
    if (!description || !amount) {
      return res.status(400).json({ error: 'Description and a non-zero amount are required (negative = discount)' });
    }
    const existing = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    assertBookingUnlocked(existing.rows[0]);
    await db.execute({
      sql: 'INSERT INTO booking_charges (booking_id, description, amount) VALUES (?, ?, ?)',
      args: [req.params.id, description, amount]
    });
    const totals = await recomputeBookingTotal(req.params.id);
    const chargesResult = await db.execute({
      sql: 'SELECT * FROM booking_charges WHERE booking_id = ? ORDER BY created_at ASC',
      args: [req.params.id]
    });
    res.status(201).json({ charges: chargesResult.rows, ...totals });
  } catch (err) {
    if (err instanceof BookingLockedError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to add charge' });
  }
});

// Remove an extra service charge (admin)
router.delete('/:id/charges/:chargeId', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const booking = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    if (!booking.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    assertBookingUnlocked(booking.rows[0]);
    const existing = await db.execute({ sql: 'SELECT * FROM booking_charges WHERE id = ? AND booking_id = ?', args: [req.params.chargeId, req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Charge not found' });
    }
    await db.execute({ sql: 'DELETE FROM booking_charges WHERE id = ?', args: [req.params.chargeId] });
    const totals = await recomputeBookingTotal(req.params.id);
    const chargesResult = await db.execute({
      sql: 'SELECT * FROM booking_charges WHERE booking_id = ? ORDER BY created_at ASC',
      args: [req.params.id]
    });
    res.json({ charges: chargesResult.rows, ...totals });
  } catch (err) {
    if (err instanceof BookingLockedError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to remove charge' });
  }
});

// Record a payment against a booking (admin) — builds transaction history and
// auto-derives payment_status from total paid vs total_amount.
router.post('/:id/payments', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const { amount, method, transactionId, note } = req.body;
    if (!amount || amount <= 0 || !method) {
      return res.status(400).json({ error: 'Amount and method are required' });
    }

    const bookingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    if (!bookingResult.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    assertBookingUnlocked(bookingResult.rows[0]);

    await db.execute({
      sql: `
        INSERT INTO payments (booking_id, amount, method, transaction_id, note, recorded_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [req.params.id, amount, method, transactionId || '', note || '', req.user.username]
    });

    const totals = await recomputeBookingTotal(req.params.id);

    const paymentsResult = await db.execute({
      sql: 'SELECT * FROM payments WHERE booking_id = ? ORDER BY recorded_at ASC',
      args: [req.params.id]
    });
    res.status(201).json({ payments: paymentsResult.rows, ...totals });
  } catch (err) {
    if (err instanceof BookingLockedError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

// One-click checkout (admin/staff): optionally records a final payment, then
// marks the booking checked out with an exact server timestamp. The payment
// insert happens BEFORE the status update, so if it fails the booking is
// never marked checked out — the caller can safely retry the whole request.
router.post('/:id/checkout', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const { amount, method, transactionId, note } = req.body;

    const bookingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    const booking = bookingResult.rows[0];
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    assertBookingUnlocked(booking);

    let totals = null;
    let payment = null;
    if (amount !== undefined && amount !== null && amount !== '' && Number(amount) > 0) {
      if (!method) {
        return res.status(400).json({ error: 'Payment method is required to record a payment' });
      }
      const insertResult = await db.execute({
        sql: `
          INSERT INTO payments (booking_id, amount, method, transaction_id, note, recorded_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        args: [req.params.id, amount, method, transactionId || '', note || 'Collected at checkout', req.user.username]
      });
      totals = await recomputeBookingTotal(req.params.id);
      const paymentRow = await db.execute({ sql: 'SELECT * FROM payments WHERE id = ?', args: [Number(insertResult.lastInsertRowid)] });
      payment = paymentRow.rows[0];
    }

    await db.execute({
      sql: `UPDATE bookings SET status = 'checked_out', checked_out_at = datetime('now') WHERE id = ?`,
      args: [req.params.id]
    });

    const updated = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    res.json({ booking: updated.rows[0], payment, totals });
  } catch (err) {
    if (err instanceof BookingLockedError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to complete checkout. Nothing was changed — please try again.' });
  }
});

module.exports = router;
