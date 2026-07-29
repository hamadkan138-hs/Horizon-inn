const { db } = require('../db');

// Single source of truth for a day's operational snapshot — used by the
// admin dashboard's Daily Summary tab (routes/reports.js) and by the
// automated daily summary email (lib/mailer.js) so the two never drift.
async function getDailySummary(date) {
  const day = date || new Date().toISOString().slice(0, 10);

  const checkinsResult = await db.execute({
    sql: `
      SELECT bookings.*, rooms.name AS room_name
      FROM bookings JOIN rooms ON rooms.id = bookings.room_id
      WHERE checkin = ? AND status != 'cancelled'
      ORDER BY bookings.id
    `,
    args: [day]
  });
  const checkoutsResult = await db.execute({
    sql: `
      SELECT bookings.*, rooms.name AS room_name
      FROM bookings JOIN rooms ON rooms.id = bookings.room_id
      WHERE checkout = ? AND status != 'cancelled'
      ORDER BY bookings.id
    `,
    args: [day]
  });
  const cashTodayResult = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE date(recorded_at) = ?`,
    args: [day]
  });
  const expensesTodayResult = await db.execute({
    sql: `SELECT * FROM expenses WHERE expense_date = ? ORDER BY id DESC`,
    args: [day]
  });
  const outstandingResult = await db.execute(`
    SELECT bookings.*, rooms.name AS room_name,
           bookings.total_amount - COALESCE(p.paid, 0) AS balance
    FROM bookings
    JOIN rooms ON rooms.id = bookings.room_id
    LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = bookings.id
    WHERE bookings.status NOT IN ('cancelled', 'checked_out') AND bookings.total_amount - COALESCE(p.paid, 0) > 0.01
    ORDER BY balance DESC
  `);

  const paidByBooking = {};
  for (const row of [...checkinsResult.rows, ...checkoutsResult.rows]) {
    if (paidByBooking[row.id] !== undefined) continue;
    const paidResult = await db.execute({ sql: 'SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE booking_id = ?', args: [row.id] });
    paidByBooking[row.id] = Number(paidResult.rows[0].paid);
  }

  const withBalance = (row) => ({ ...row, balance: Math.max(0, Number(row.total_amount) - (paidByBooking[row.id] || 0)) });

  const cashReceivedToday = Number(cashTodayResult.rows[0].total);
  const expensesTotalToday = expensesTodayResult.rows.reduce((sum, e) => sum + Number(e.amount), 0);

  return {
    date: day,
    checkins: checkinsResult.rows.map(withBalance),
    checkouts: checkoutsResult.rows.map(withBalance),
    cashReceivedToday,
    expensesToday: expensesTodayResult.rows,
    expensesTotalToday,
    netCashToday: cashReceivedToday - expensesTotalToday,
    outstandingTotal: outstandingResult.rows.reduce((sum, r) => sum + Number(r.balance), 0),
    outstandingBookings: outstandingResult.rows
  };
}

module.exports = { getDailySummary };
