const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;
const { initRoomIfNeeded } = require('../lib/minibarEngine');
const { findAvailablePhysicalRoom } = require('../lib/roomAssignment');

const router = express.Router();

// The lobby tablet signs in once with a low-privilege 'kiosk' account and stays
// on /kiosk.html; the guest never sees a login. Admin/staff are allowed too so a
// manager can test the flow from their own account.
//
// Deliberately NOT unauthenticated: /api/guests/lookup already answers "who is
// this CNIC" with name, phone, address and full stay history, and an open
// endpoint of that shape would let anyone enumerate CNICs and harvest guest
// records. Keeping the device authenticated means no new public PII surface.
router.use(adminAuth, requireRole('kiosk', 'admin', 'staff'));

// Same shape as the login throttle in middleware/adminAuth.js, but keyed on the
// kiosk device rather than a username: a guest mistyping their own CNIC is
// normal, someone standing at the tablet trying hundreds of them is not.
const LOOKUP_MAX_ATTEMPTS = 12;
const LOOKUP_WINDOW_MS = 10 * 60 * 1000;
const lookupAttempts = new Map(); // username -> { failures: number[], }

function isLookupBlocked(key) {
  const entry = lookupAttempts.get(key);
  if (!entry) return false;
  entry.failures = entry.failures.filter((t) => Date.now() - t < LOOKUP_WINDOW_MS);
  return entry.failures.length >= LOOKUP_MAX_ATTEMPTS;
}

function recordLookupFailure(key) {
  const entry = lookupAttempts.get(key) || { failures: [] };
  entry.failures = entry.failures.filter((t) => Date.now() - t < LOOKUP_WINDOW_MS);
  entry.failures.push(Date.now());
  lookupAttempts.set(key, entry);
}

function clearLookupFailures(key) {
  lookupAttempts.delete(key);
}

// Only the fields the kiosk screen actually renders. No address, no email, no
// visit history, no spend totals — a guest confirming their own arrival has no
// reason to be shown their full record on a screen in a public lobby.
function toKioskBooking(row, balanceDue) {
  return {
    id: row.id,
    name: row.name,
    invoiceNumber: row.invoice_number,
    roomName: row.room_name,
    checkin: row.checkin,
    checkout: row.checkout,
    guests: row.guests,
    status: row.status,
    balanceDue
  };
}

async function balanceFor(bookingId, totalAmount) {
  const paid = await db.execute({
    sql: 'SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE booking_id = ?',
    args: [bookingId]
  });
  return Math.max(0, Number(totalAmount) - Number(paid.rows[0].paid));
}

// Find the guest's own booking. Requires two matching pieces of information —
// CNIC plus surname, or the unguessable invoice_token the guest already has in
// their confirmation email (same token the public invoice page uses). One
// factor alone would make this an enumeration tool.
router.post('/lookup', async (req, res) => {
  try {
    const key = req.user.username;
    if (isLookupBlocked(key)) {
      return res.status(429).json({ error: 'Too many attempts. Please see reception for assistance.' });
    }

    const invoiceToken = (req.body.invoiceToken || '').trim();
    const cnic = (req.body.cnic || '').trim();
    const surname = (req.body.surname || '').trim();

    let result;
    if (invoiceToken) {
      result = await db.execute({
        sql: `
          SELECT bookings.*, rooms.name AS room_name
          FROM bookings JOIN rooms ON rooms.id = bookings.room_id
          WHERE bookings.invoice_token = ?
            AND bookings.status IN ('confirmed', 'checked_in')
          LIMIT 1
        `,
        args: [invoiceToken]
      });
    } else if (cnic && surname) {
      // Surname matched case-insensitively against any word in the stored name,
      // since guests write their name in varying orders and casings.
      result = await db.execute({
        sql: `
          SELECT bookings.*, rooms.name AS room_name
          FROM bookings JOIN rooms ON rooms.id = bookings.room_id
          WHERE bookings.cnic = ?
            AND LOWER(bookings.name) LIKE LOWER(?)
            AND bookings.status IN ('confirmed', 'checked_in')
          ORDER BY bookings.checkin ASC
          LIMIT 1
        `,
        args: [cnic, `%${surname}%`]
      });
    } else {
      return res.status(400).json({ error: 'Enter your CNIC and surname, or scan your booking QR code.' });
    }

    const booking = result.rows[0];
    if (!booking) {
      recordLookupFailure(key);
      // Same message whether the CNIC is unknown or the surname simply doesn't
      // match, so the response can't be used to confirm that a given CNIC
      // exists in the system.
      return res.status(404).json({ error: 'We could not find your booking. Please see reception.' });
    }

    clearLookupFailures(key);
    res.json(toKioskBooking(booking, await balanceFor(booking.id, booking.total_amount)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please see reception.' });
  }
});

// Complete the guest's own check-in. Assigns a physical room by the same rule
// the staff front desk uses, stocks its mini bar, and records who did it.
router.post('/:id/self-checkin', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `
        SELECT bookings.*, rooms.name AS room_name
        FROM bookings JOIN rooms ON rooms.id = bookings.room_id
        WHERE bookings.id = ?
      `,
      args: [req.params.id]
    });
    const booking = result.rows[0];
    if (!booking) {
      return res.status(404).json({ error: 'We could not find your booking. Please see reception.' });
    }
    if (booking.status === 'checked_in') {
      return res.status(409).json({ error: 'You are already checked in. Please see reception for your key.' });
    }
    if (booking.status !== 'confirmed') {
      return res.status(409).json({ error: 'This booking cannot be checked in here. Please see reception.' });
    }

    // A guest can check in on their arrival date or later (late arrival), but
    // not days early — that room may still be someone else's tonight.
    const today = new Date().toISOString().slice(0, 10);
    if (booking.checkin > today) {
      return res.status(409).json({ error: `Your stay begins on ${booking.checkin}. Please see reception.` });
    }

    let physicalRoomId = booking.physical_room_id;
    if (!physicalRoomId) {
      physicalRoomId = await findAvailablePhysicalRoom(booking.room_id, booking.checkin, booking.checkout);
    }
    if (!physicalRoomId) {
      // Nothing free to hand over unattended — this needs a human, not an error
      // screen the guest can't act on.
      return res.status(409).json({ error: 'Your room is not ready yet. Please see reception.' });
    }

    await db.execute({
      sql: `UPDATE bookings SET status = 'checked_in', physical_room_id = ? WHERE id = ?`,
      args: [physicalRoomId, booking.id]
    });
    // 'kiosk' rather than the device account name, so self-service arrivals are
    // distinguishable from staff-performed ones in the audit trail.
    await db.execute({
      sql: 'INSERT INTO booking_status_log (booking_id, from_status, to_status, changed_by, reason) VALUES (?, ?, ?, ?, ?)',
      args: [booking.id, booking.status, 'checked_in', 'kiosk', 'Guest self-service check-in']
    });
    await initRoomIfNeeded(physicalRoomId, 'kiosk').catch((err) => console.error('[minibar init]', err));

    const roomResult = await db.execute({
      sql: 'SELECT room_number, floor FROM physical_rooms WHERE id = ?',
      args: [physicalRoomId]
    });
    const room = roomResult.rows[0] || {};

    res.json({
      checkedIn: true,
      name: booking.name,
      roomNumber: room.room_number || '',
      floor: room.floor || '',
      roomName: booking.room_name,
      checkout: booking.checkout,
      balanceDue: await balanceFor(booking.id, booking.total_amount)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please see reception.' });
  }
});

module.exports = router;
