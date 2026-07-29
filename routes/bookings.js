const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;
const { isRoomAvailable } = require('../lib/availability');
const { computeTotalAmount } = require('../lib/pricing');
const { recomputeBookingTotal } = require('../lib/billing');
const { assertBookingUnlocked, BookingLockedError } = require('../lib/lock');
const { sendBookingConfirmationEmail } = require('../lib/mailer');

const router = express.Router();

const PAYMENT_METHODS = ['pay_at_property', 'bank_transfer', 'easypaisa', 'jazzcash'];
const CHARGE_CATEGORIES = ['amenity', 'event_rental', 'other'];
const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed'];
const BOOKING_STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'];

// Optional upsells offered at checkout — small, fixed catalog rather than a
// full admin-managed table, since these rarely change.
const HOTEL_ADDONS = {
  breakfast_upgrade: { label: 'Breakfast Upgrade', amount: 800 },
  airport_pickup: { label: 'Airport Pickup', amount: 2500 },
  late_checkout: { label: 'Late Check-out (until 3 PM)', amount: 1000 },
  crescent_dinner: { label: 'Crescent Grove Candlelight Dinner for Two', amount: 6500 }
};

function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// One "Promo / Gift Voucher / Referral Code" field on the booking form can
// resolve to any of three different things — checked in this order. Each
// means something different (a % discount vs. real prepaid money vs.
// crediting a specific past guest), so the caller applies them differently.
async function resolveDiscountCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  const today = new Date().toISOString().slice(0, 10);

  const promoResult = await db.execute({ sql: 'SELECT * FROM promo_codes WHERE code = ? AND active = 1', args: [code] });
  if (promoResult.rows[0]) {
    const p = promoResult.rows[0];
    if (p.expires_at && p.expires_at < today) return { error: 'This promo code has expired' };
    if (p.max_uses !== null && Number(p.used_count) >= Number(p.max_uses)) {
      return { error: 'This promo code has reached its usage limit' };
    }
    return { type: 'promo', id: Number(p.id), code, discountPercent: Number(p.discount_percent) };
  }

  const voucherResult = await db.execute({ sql: "SELECT * FROM gift_vouchers WHERE code = ? AND status = 'active'", args: [code] });
  if (voucherResult.rows[0]) {
    const v = voucherResult.rows[0];
    if (v.expires_at && v.expires_at < today) return { error: 'This gift voucher has expired' };
    return { type: 'voucher', id: Number(v.id), code, amount: Number(v.amount) };
  }

  const referralResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE referral_code = ?', args: [code] });
  if (referralResult.rows[0]) {
    return { type: 'referral', referrerBookingId: Number(referralResult.rows[0].id), code, discountPercent: 10 };
  }

  return { error: 'That code was not recognized' };
}

// Create a booking (public)
router.post('/', async (req, res) => {
  try {
    const {
      name, email, phone, roomId, checkin, checkout, guests, specialRequests,
      cnic, maritalStatus, arrivalFrom, departureTo, arrivalTime, purposeOfStay, vehicleNumber, address,
      paymentMethod, transactionId, termsAccepted, addons, discountCode
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

    // Resolve any discount code before creating the booking, so a bad code
    // fails fast instead of leaving an orphan booking behind.
    let discountResolution = null;
    if (discountCode && discountCode.trim()) {
      discountResolution = await resolveDiscountCode(discountCode);
      if (discountResolution.error) {
        return res.status(400).json({ error: discountResolution.error });
      }
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
    const referralCode = `${(name.replace(/[^a-zA-Z]/g, '').slice(0, 4) || 'STAY').toUpperCase()}${bookingId}`;
    await db.execute({
      sql: 'UPDATE bookings SET invoice_number = ?, referral_code = ? WHERE id = ?',
      args: [invoiceNumber, referralCode, bookingId]
    });

    const selectedAddons = Array.isArray(addons) ? addons.filter((key) => HOTEL_ADDONS[key]) : [];
    for (const key of selectedAddons) {
      const addon = HOTEL_ADDONS[key];
      await db.execute({
        sql: "INSERT INTO booking_charges (booking_id, description, amount, category) VALUES (?, ?, ?, 'amenity')",
        args: [bookingId, addon.label, addon.amount]
      });
    }

    if (discountResolution) {
      if (discountResolution.type === 'promo') {
        const discountAmount = -Math.round(roomAmount * (discountResolution.discountPercent / 100));
        await db.execute({
          sql: "INSERT INTO booking_charges (booking_id, description, amount, category) VALUES (?, ?, ?, 'other')",
          args: [bookingId, `Promo code ${discountResolution.code} (${discountResolution.discountPercent}% off)`, discountAmount]
        });
        await db.execute({ sql: 'UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?', args: [discountResolution.id] });
      } else if (discountResolution.type === 'voucher') {
        const addonsTotal = selectedAddons.reduce((sum, key) => sum + HOTEL_ADDONS[key].amount, 0);
        const cappedAmount = Math.min(discountResolution.amount, roomAmount + addonsTotal);
        await db.execute({
          sql: "INSERT INTO booking_charges (booking_id, description, amount, category) VALUES (?, ?, ?, 'other')",
          args: [bookingId, `Gift voucher ${discountResolution.code}`, -cappedAmount]
        });
        await db.execute({
          sql: "UPDATE gift_vouchers SET status = 'redeemed', redeemed_booking_id = ?, redeemed_at = datetime('now') WHERE id = ?",
          args: [bookingId, discountResolution.id]
        });
      } else if (discountResolution.type === 'referral') {
        const discountAmount = -Math.round(roomAmount * (discountResolution.discountPercent / 100));
        await db.execute({
          sql: "INSERT INTO booking_charges (booking_id, description, amount, category) VALUES (?, ?, ?, 'other')",
          args: [bookingId, `Referral discount (${discountResolution.discountPercent}% off)`, discountAmount]
        });
        await db.execute({ sql: 'UPDATE bookings SET referred_by_code = ? WHERE id = ?', args: [discountResolution.code, bookingId] });

        // Reward the referrer with a Rs. 1,000 gift voucher, redeemable on their next stay.
        const referrer = await db.execute({ sql: 'SELECT name, email, phone FROM bookings WHERE id = ?', args: [discountResolution.referrerBookingId] });
        if (referrer.rows[0]) {
          const rewardExpiry = new Date();
          rewardExpiry.setFullYear(rewardExpiry.getFullYear() + 1);
          await db.execute({
            sql: `
              INSERT INTO gift_vouchers (code, amount, purchaser_name, purchaser_email, purchaser_phone, recipient_name, payment_method, status, activated_at, expires_at)
              VALUES (?, 1000, ?, ?, ?, ?, 'referral_reward', 'active', datetime('now'), ?)
            `,
            args: [
              `GIFT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
              referrer.rows[0].name, referrer.rows[0].email, referrer.rows[0].phone, referrer.rows[0].name,
              rewardExpiry.toISOString().slice(0, 10)
            ]
          });
        }
      }
    }

    if (selectedAddons.length || discountResolution) {
      await recomputeBookingTotal(bookingId);
    }

    // Best-effort: this booking completing means any open "abandoned" capture
    // for the same guest wasn't actually abandoned — close it out.
    await db.execute({
      sql: "UPDATE abandoned_bookings SET status = 'converted', updated_at = datetime('now') WHERE status = 'open' AND (email = ? OR phone = ?)",
      args: [email, phone]
    });

    const bookingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [bookingId] });
    const booking = bookingResult.rows[0];

    sendBookingConfirmationEmail(booking, room).catch((err) => console.error('[bookingConfirmationEmail]', err));

    res.status(201).json({ booking, room: { ...room, features: JSON.parse(room.features) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong while creating the booking' });
  }
});

// Guest self-service: look up your own booking with invoice number + phone
// (both of which only the guest and the property have — no login needed,
// but also nothing sensitive like CNIC or address is returned here).
router.get('/public-lookup', async (req, res) => {
  try {
    const { invoiceNumber, phone } = req.query;
    if (!invoiceNumber || !phone) {
      return res.status(400).json({ error: 'Invoice number and phone number are required' });
    }
    const result = await db.execute({
      sql: `
        SELECT bookings.*, rooms.name AS room_name
        FROM bookings JOIN rooms ON rooms.id = bookings.room_id
        WHERE bookings.invoice_number = ? AND bookings.phone = ?
      `,
      args: [invoiceNumber.trim(), phone.trim()]
    });
    const booking = result.rows[0];
    if (!booking) {
      return res.status(404).json({ error: 'No booking found matching that invoice number and phone number' });
    }
    res.json({
      id: booking.id, invoiceNumber: booking.invoice_number, guestName: booking.name,
      roomName: booking.room_name, checkin: booking.checkin, checkout: booking.checkout,
      status: booking.status, paymentStatus: booking.payment_status, totalAmount: booking.total_amount,
      cancellationRequestedAt: booking.cancellation_requested_at
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to look up booking' });
  }
});

// Guest self-service cancellation request — this does NOT cancel the booking
// outright (that stays a staff decision, e.g. to check refund eligibility
// against the cancellation policy); it just flags it for staff to action,
// the same trust boundary as a phone call asking to cancel.
router.post('/public-lookup/request-cancellation', async (req, res) => {
  try {
    const { invoiceNumber, phone } = req.body;
    if (!invoiceNumber || !phone) {
      return res.status(400).json({ error: 'Invoice number and phone number are required' });
    }
    const result = await db.execute({
      sql: 'SELECT * FROM bookings WHERE invoice_number = ? AND phone = ?',
      args: [invoiceNumber.trim(), phone.trim()]
    });
    const booking = result.rows[0];
    if (!booking) {
      return res.status(404).json({ error: 'No booking found matching that invoice number and phone number' });
    }
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return res.status(400).json({ error: `A ${booking.status} booking can't be cancelled this way — please contact us directly.` });
    }
    await db.execute({
      sql: "UPDATE bookings SET cancellation_requested_at = datetime('now') WHERE id = ?",
      args: [booking.id]
    });
    res.json({ requested: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to request cancellation' });
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
    const {
      guestName, phone, roomId, checkin, checkout, advanceAmount, paymentMethod, transactionId,
      cnic, address, checkInNow, email, maritalStatus, guests, purposeOfStay, arrivalTime,
      vehicleNumber, arrivalFrom, departureTo
    } = req.body;

    if (!guestName || !phone || !roomId || !checkin || !checkout) {
      return res.status(400).json({ error: 'Guest name, phone, room and dates are required' });
    }
    if (!isValidDate(checkin) || !isValidDate(checkout) || checkin >= checkout) {
      return res.status(400).json({ error: 'Check-out date must be after check-in date' });
    }
    // An advance payment is optional here: the front desk's walk-in check-in
    // flow collects no money up front (guest settles at checkout), while the
    // Availability tab's advance-booking form always sends a real amount.
    const hasAdvance = advanceAmount !== undefined && advanceAmount !== null && advanceAmount !== '' && Number(advanceAmount) > 0;
    const method = PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : 'pay_at_property';
    const status = checkInNow ? 'checked_in' : 'confirmed';

    const roomResult = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [roomId] });
    const room = roomResult.rows[0];
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    if (!(await isRoomAvailable(room, checkin, checkout))) {
      return res.status(409).json({ error: 'Room already booked for selected dates' });
    }

    const roomAmount = await computeTotalAmount(room, checkin, checkout, 1);

    // Best-effort: if this category has real physical rooms registered, pin
    // this booking to the lowest-numbered free one so the room dashboard can
    // show a stable, persistently-numbered card instead of a synthesized
    // slot. Categories with no physical rooms registered yet (or no free
    // one, which shouldn't happen given the availability check above unless
    // registered-room count doesn't match total_units) simply get null here
    // and fall back to the dashboard's synthetic-slot display.
    const physicalRoomResult = await db.execute({
      sql: `
        SELECT pr.id FROM physical_rooms pr
        WHERE pr.room_type_id = ? AND pr.status = 'available'
          AND pr.id NOT IN (
            SELECT physical_room_id FROM bookings
            WHERE physical_room_id IS NOT NULL
              AND status != 'cancelled'
              AND NOT (checkout <= ? OR checkin >= ?)
          )
        ORDER BY pr.room_number ASC
        LIMIT 1
      `,
      args: [roomId, checkin, checkout]
    });
    const physicalRoomId = physicalRoomResult.rows[0] ? physicalRoomResult.rows[0].id : null;

    const insertResult = await db.execute({
      sql: `
        INSERT INTO bookings (
          room_id, physical_room_id, name, email, phone, cnic, address, checkin, checkout, guests,
          marital_status, arrival_from, departure_to, arrival_time, purpose_of_stay, vehicle_number,
          payment_method, transaction_id, terms_accepted, status, payment_status, total_amount, room_amount,
          invoice_token
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'unpaid', ?, ?, lower(hex(randomblob(12))))
      `,
      args: [
        roomId, physicalRoomId, guestName, email || '', phone, cnic || '', address || '', checkin, checkout,
        Number(guests) || 1, maritalStatus || '', arrivalFrom || '', departureTo || '', arrivalTime || '',
        purposeOfStay || '', vehicleNumber || '', method, transactionId || '', status, roomAmount, roomAmount
      ]
    });

    const bookingId = Number(insertResult.lastInsertRowid);
    const year = new Date(checkin).getFullYear();
    const invoiceNumber = `INV-${year}-${String(bookingId).padStart(4, '0')}`;
    await db.execute({ sql: 'UPDATE bookings SET invoice_number = ? WHERE id = ?', args: [invoiceNumber, bookingId] });

    let totals = null;
    if (hasAdvance) {
      await db.execute({
        sql: `
          INSERT INTO payments (booking_id, amount, method, transaction_id, note, recorded_by)
          VALUES (?, ?, ?, ?, 'Advance payment (tax included)', ?)
        `,
        args: [bookingId, advanceAmount, method, transactionId || '', req.user.username]
      });
      totals = await recomputeBookingTotal(bookingId);
    }

    const bookingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [bookingId] });

    res.status(201).json({
      booking: bookingResult.rows[0],
      advanceAmount: hasAdvance ? Number(advanceAmount) : 0,
      ...totals
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// List all bookings (admin) — includes paid_total/balance so the Bookings and
// Payments tabs can render financial state without an N+1 query per row.
router.get('/', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const { status, paymentStatus, search, limit, offset } = req.query;
    const where = [];
    const args = [];
    if (status) { where.push('bookings.status = ?'); args.push(status); }
    if (paymentStatus) { where.push('bookings.payment_status = ?'); args.push(paymentStatus); }
    if (search) {
      const like = `%${search.trim()}%`;
      where.push('(bookings.name LIKE ? OR bookings.email LIKE ? OR bookings.phone LIKE ? OR bookings.cnic LIKE ?)');
      args.push(like, like, like, like);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await db.execute({ sql: `SELECT COUNT(*) AS total FROM bookings ${whereClause}`, args });
    const total = Number(countResult.rows[0].total);

    // limit/offset are optional — callers that need the full matching set
    // (e.g. the cash-handover ledger) simply omit them.
    let limitClause = '';
    if (limit) {
      const lim = Math.max(1, Math.min(200, Number(limit) || 50));
      const off = Math.max(0, Number(offset) || 0);
      limitClause = ` LIMIT ${lim} OFFSET ${off}`;
    }

    const result = await db.execute({
      sql: `
        SELECT bookings.*, rooms.name AS room_name,
               COALESCE(p.paid, 0) AS paid_total,
               bookings.total_amount - COALESCE(p.paid, 0) AS balance
        FROM bookings
        JOIN rooms ON rooms.id = bookings.room_id
        LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = bookings.id
        ${whereClause}
        ORDER BY bookings.created_at DESC
        ${limitClause}
      `,
      args
    });
    res.json({ bookings: result.rows, total });
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
    const historyResult = await db.execute({
      sql: 'SELECT * FROM booking_status_log WHERE booking_id = ? ORDER BY changed_at ASC',
      args: [req.params.id]
    });
    res.json({ ...booking, payments: paymentsResult.rows, charges: chargesResult.rows, statusHistory: historyResult.rows });
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
    const { status, paymentStatus, reason } = req.body;

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

    if (status !== undefined && status !== booking.status) {
      await db.execute({
        sql: 'INSERT INTO booking_status_log (booking_id, from_status, to_status, changed_by, reason) VALUES (?, ?, ?, ?, ?)',
        args: [req.params.id, booking.status, status, req.user.username, reason || '']
      });
    }

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
    const { description, amount, category } = req.body;
    if (!description || !amount) {
      return res.status(400).json({ error: 'Description and a non-zero amount are required (negative = discount)' });
    }
    if (category !== undefined && !CHARGE_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Category must be one of: ${CHARGE_CATEGORIES.join(', ')}` });
    }
    const existing = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    assertBookingUnlocked(existing.rows[0]);
    await db.execute({
      sql: 'INSERT INTO booking_charges (booking_id, description, amount, category) VALUES (?, ?, ?, ?)',
      args: [req.params.id, description, amount, category || 'other']
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
      sql: `UPDATE bookings SET status = 'checked_out', checked_out_at = datetime('now'), cleaning_status = 'pending' WHERE id = ?`,
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

// Housekeeping: mark a checked-out room clean again. This is deliberately
// exempt from assertBookingUnlocked — cleaning_status is operational, not
// part of the financial record the lock protects, so it must stay editable
// on bookings that are otherwise permanently locked.
router.patch('/:id/cleaning', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [req.params.id] });
    const booking = existing.rows[0];
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    if (booking.status !== 'checked_out') {
      return res.status(400).json({ error: 'Only a checked-out stay can be marked as cleaned' });
    }
    await db.execute({ sql: `UPDATE bookings SET cleaning_status = 'clean' WHERE id = ?`, args: [req.params.id] });
    res.json({ id: Number(req.params.id), cleaningStatus: 'clean' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update cleaning status' });
  }
});

module.exports = router;
