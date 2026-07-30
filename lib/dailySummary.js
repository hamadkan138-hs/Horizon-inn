const { db } = require('../db');

// Single source of truth for a day's operational snapshot — used by the
// admin dashboard's Daily Summary tab (routes/reports.js) and by the
// automated daily summary email (lib/mailer.js) so the two never drift.
async function getDailySummary(date) {
  const day = date || new Date().toISOString().slice(0, 10);

  // Paid totals are joined in via the same per-booking aggregate subquery
  // pattern used for outstandingResult below, instead of a separate query
  // per booking (which was an N+1 query loop for busy check-in/out days).
  const [checkinsResult, checkoutsResult, cashTodayResult, expensesTodayResult, outstandingResult] = await Promise.all([
    db.execute({
      sql: `
        SELECT bookings.*, rooms.name AS room_name,
               MAX(bookings.total_amount - COALESCE(p.paid, 0), 0) AS balance
        FROM bookings
        JOIN rooms ON rooms.id = bookings.room_id
        LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = bookings.id
        WHERE checkin = ? AND status != 'cancelled'
        ORDER BY bookings.id
      `,
      args: [day]
    }),
    db.execute({
      sql: `
        SELECT bookings.*, rooms.name AS room_name,
               MAX(bookings.total_amount - COALESCE(p.paid, 0), 0) AS balance
        FROM bookings
        JOIN rooms ON rooms.id = bookings.room_id
        LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = bookings.id
        WHERE checkout = ? AND status != 'cancelled'
        ORDER BY bookings.id
      `,
      args: [day]
    }),
    db.execute({
      sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE date(recorded_at) = ?`,
      args: [day]
    }),
    db.execute({
      sql: `SELECT * FROM expenses WHERE expense_date = ? ORDER BY id DESC`,
      args: [day]
    }),
    db.execute(`
      SELECT bookings.*, rooms.name AS room_name,
             bookings.total_amount - COALESCE(p.paid, 0) AS balance
      FROM bookings
      JOIN rooms ON rooms.id = bookings.room_id
      LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = bookings.id
      WHERE bookings.status NOT IN ('cancelled', 'checked_out') AND bookings.total_amount - COALESCE(p.paid, 0) > 0.01
      ORDER BY balance DESC
    `)
  ]);

  const cashReceivedToday = Number(cashTodayResult.rows[0].total);
  const expensesTotalToday = expensesTodayResult.rows.reduce((sum, e) => sum + Number(e.amount), 0);

  return {
    date: day,
    checkins: checkinsResult.rows,
    checkouts: checkoutsResult.rows,
    cashReceivedToday,
    expensesToday: expensesTodayResult.rows,
    expensesTotalToday,
    netCashToday: cashReceivedToday - expensesTotalToday,
    outstandingTotal: outstandingResult.rows.reduce((sum, r) => sum + Number(r.balance), 0),
    outstandingBookings: outstandingResult.rows
  };
}

module.exports = { getDailySummary };
