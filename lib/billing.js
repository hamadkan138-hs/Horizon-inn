const { db } = require('../db');

// A promo/referral discount is a percent-off the room total, but room_amount
// can change after the discount was first applied — a stay extension, or
// staff editing the check-in/check-out dates via Edit Booking — and neither
// path used to touch the original discount line item. That left it frozen
// at whatever the room total was the moment the code was applied (often just
// 1 night), silently undercutting every night added afterward. Call this any
// time room_amount changes on a booking that has discount_percent set, so
// the discount always matches the CURRENT room_amount rather than a stale
// snapshot of it. The re-synced charge reuses discount_label so it still
// reads exactly like the original ("Promo code X (26% off)"), and the DELETE
// below also sweeps up the old incremental "Discount extended" line a prior
// version of the extend endpoint used to add, so the two never double up.
async function syncStayDiscount(bookingId) {
  const bookingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [bookingId] });
  const booking = bookingResult.rows[0];
  if (!booking || !booking.discount_percent || !booking.discount_label) return;

  await db.execute({
    sql: "DELETE FROM booking_charges WHERE booking_id = ? AND category = 'other' AND (description LIKE ? OR description LIKE 'Discount extended%')",
    args: [bookingId, `${booking.discount_label}%`]
  });

  const discountAmount = -Math.round(Number(booking.room_amount) * (Number(booking.discount_percent) / 100));
  await db.execute({
    sql: "INSERT INTO booking_charges (booking_id, description, amount, category) VALUES (?, ?, ?, 'other')",
    args: [bookingId, `${booking.discount_label} (${booking.discount_percent}% off)`, discountAmount]
  });
}

// Recomputes a booking's total_amount from room_amount + extra charges + tax,
// then re-derives payment_status from the payments already recorded against it.
// Called any time room_amount, charges, or tax_percent change.
async function recomputeBookingTotal(bookingId) {
  const bookingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [bookingId] });
  const booking = bookingResult.rows[0];
  if (!booking) throw new Error('Booking not found');

  const chargesResult = await db.execute({
    sql: 'SELECT COALESCE(SUM(amount), 0) AS sum FROM booking_charges WHERE booking_id = ?',
    args: [bookingId]
  });
  const chargesTotal = Number(chargesResult.rows[0].sum);

  const subtotal = Number(booking.room_amount) + chargesTotal;
  const taxAmount = subtotal * (Number(booking.tax_percent) / 100);
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  const paidResult = await db.execute({
    sql: 'SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE booking_id = ?',
    args: [bookingId]
  });
  const paidTotal = Number(paidResult.rows[0].paid);
  const paymentStatus = paidTotal <= 0 ? 'unpaid' : (paidTotal >= total ? 'paid' : 'partial');

  await db.execute({
    sql: 'UPDATE bookings SET total_amount = ?, payment_status = ? WHERE id = ?',
    args: [total, paymentStatus, bookingId]
  });

  return { total, chargesTotal, taxAmount, paidTotal, paymentStatus };
}

module.exports = { recomputeBookingTotal, syncStayDiscount };
