const { db } = require('../db');

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

module.exports = { recomputeBookingTotal };
