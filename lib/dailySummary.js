const { db } = require('../db');

// Single source of truth for a day's operational snapshot — used by the
// admin dashboard's Daily Summary tab (routes/reports.js) and by the
// automated daily summary email (lib/mailer.js) so the two never drift.
async function getDailySummary(date) {
  const day = date || new Date().toISOString().slice(0, 10);

  // Paid totals are joined in via the same per-booking aggregate subquery
  // pattern used for outstandingResult below, instead of a separate query
  // per booking (which was an N+1 query loop for busy check-in/out days).
  const [checkinsResult, checkoutsResult, paymentsTodayResult, expensesTodayResult, outstandingResult] = await Promise.all([
    db.execute({
      sql: `
        SELECT bookings.*, rooms.name AS room_name, physical_rooms.room_number AS physical_room_number,
               MAX(bookings.total_amount - COALESCE(p.paid, 0), 0) AS balance
        FROM bookings
        JOIN rooms ON rooms.id = bookings.room_id
        LEFT JOIN physical_rooms ON physical_rooms.id = bookings.physical_room_id
        LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = bookings.id
        WHERE checkin = ? AND bookings.status != 'cancelled'
        ORDER BY bookings.id
      `,
      args: [day]
    }),
    db.execute({
      sql: `
        SELECT bookings.*, rooms.name AS room_name, physical_rooms.room_number AS physical_room_number,
               MAX(bookings.total_amount - COALESCE(p.paid, 0), 0) AS balance
        FROM bookings
        JOIN rooms ON rooms.id = bookings.room_id
        LEFT JOIN physical_rooms ON physical_rooms.id = bookings.physical_room_id
        LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = bookings.id
        WHERE checkout = ? AND bookings.status != 'cancelled'
        ORDER BY bookings.id
      `,
      args: [day]
    }),
    db.execute({
      sql: `SELECT method, COALESCE(SUM(amount), 0) AS total FROM payments WHERE date(recorded_at) = ? GROUP BY method`,
      args: [day]
    }),
    db.execute({
      sql: `SELECT * FROM expenses WHERE expense_date = ? ORDER BY id DESC`,
      args: [day]
    }),
    db.execute(`
      SELECT bookings.*, rooms.name AS room_name, physical_rooms.room_number AS physical_room_number,
             bookings.total_amount - COALESCE(p.paid, 0) AS balance
      FROM bookings
      JOIN rooms ON rooms.id = bookings.room_id
      LEFT JOIN physical_rooms ON physical_rooms.id = bookings.physical_room_id
      LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = bookings.id
      WHERE bookings.status NOT IN ('cancelled', 'checked_out') AND bookings.total_amount - COALESCE(p.paid, 0) > 0.01
      ORDER BY balance DESC
    `)
  ]);

  // Same cash/bank/online split as the handover's computeUnswept() — built
  // from the actual payments.method on each transaction, not a booking-level
  // intent field, so this is the one place staff can check exactly how much
  // of today's money came in by which method (the handover screen deliberately
  // only deals with the cash figure; this is where bank/online belong).
  let cashReceivedToday = 0;
  let bankReceivedToday = 0;
  let onlineReceivedToday = 0;
  paymentsTodayResult.rows.forEach((r) => {
    const amount = Number(r.total);
    if (r.method === 'bank_transfer') bankReceivedToday += amount;
    else if (r.method === 'easypaisa' || r.method === 'jazzcash') onlineReceivedToday += amount;
    else cashReceivedToday += amount;
  });
  const totalReceivedToday = cashReceivedToday + bankReceivedToday + onlineReceivedToday;
  const expensesTotalToday = expensesTodayResult.rows.reduce((sum, e) => sum + Number(e.amount), 0);

  return {
    date: day,
    checkins: checkinsResult.rows,
    checkouts: checkoutsResult.rows,
    cashReceivedToday,
    bankReceivedToday,
    onlineReceivedToday,
    totalReceivedToday,
    expensesToday: expensesTodayResult.rows,
    expensesTotalToday,
    // True net cash flow (cash in minus cash out), not blended with
    // bank/online revenue — consistent with the handover's netCashHanded.
    netCashToday: cashReceivedToday - expensesTotalToday,
    outstandingTotal: outstandingResult.rows.reduce((sum, r) => sum + Number(r.balance), 0),
    outstandingBookings: outstandingResult.rows
  };
}

module.exports = { getDailySummary };
