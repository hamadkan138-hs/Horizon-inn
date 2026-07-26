const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();

router.use(adminAuth);

const PERIOD_FORMAT = {
  daily: '%Y-%m-%d',
  weekly: '%Y-W%W',
  monthly: '%Y-%m'
};

function defaultRange(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

// Revenue grouped by day/week/month, based on confirmed-or-later bookings
router.get('/revenue', async (req, res) => {
  try {
    const range = PERIOD_FORMAT[req.query.range] ? req.query.range : 'daily';
    const { from, to } = req.query.from && req.query.to ? req.query : defaultRange(90);

    const result = await db.execute({
      sql: `
        SELECT strftime('${PERIOD_FORMAT[range]}', checkin) AS period,
               SUM(total_amount) AS revenue,
               COUNT(*) AS bookings
        FROM bookings
        WHERE status != 'cancelled' AND checkin BETWEEN ? AND ?
        GROUP BY period
        ORDER BY period ASC
      `,
      args: [from, to]
    });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load revenue report' });
  }
});

// Expenses grouped by day/week/month
router.get('/expenses', async (req, res) => {
  try {
    const range = PERIOD_FORMAT[req.query.range] ? req.query.range : 'daily';
    const { from, to } = req.query.from && req.query.to ? req.query : defaultRange(90);

    const result = await db.execute({
      sql: `
        SELECT strftime('${PERIOD_FORMAT[range]}', expense_date) AS period,
               SUM(amount) AS total
        FROM expenses
        WHERE expense_date BETWEEN ? AND ?
        GROUP BY period
        ORDER BY period ASC
      `,
      args: [from, to]
    });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load expense report' });
  }
});

// Day-by-day occupancy rate over a date range
router.get('/occupancy', async (req, res) => {
  try {
    const { from, to } = req.query.from && req.query.to ? req.query : defaultRange(30);

    const roomsResult = await db.execute('SELECT id, total_units FROM rooms');
    const capacity = roomsResult.rows.reduce((sum, r) => sum + Number(r.total_units), 0);

    const bookingsResult = await db.execute({
      sql: `
        SELECT checkin, checkout FROM bookings
        WHERE status != 'cancelled' AND checkout > ? AND checkin < ?
      `,
      args: [from, to]
    });

    const days = [];
    const cursor = new Date(from);
    const end = new Date(to);
    while (cursor <= end) {
      days.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }

    const breakdown = days.map((day) => {
      const occupied = bookingsResult.rows.filter((b) => b.checkin <= day && b.checkout > day).length;
      return { date: day, occupied, capacity, rate: capacity ? occupied / capacity : 0 };
    });

    const totalOccupied = breakdown.reduce((sum, d) => sum + d.occupied, 0);
    const totalCapacity = capacity * days.length;

    res.json({
      breakdown,
      overallRate: totalCapacity ? totalOccupied / totalCapacity : 0,
      capacity
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load occupancy report' });
  }
});

// All-time headline numbers for the analytics dashboard
router.get('/summary', async (req, res) => {
  try {
    const revenueResult = await db.execute(`
      SELECT COALESCE(SUM(total_amount), 0) AS totalRevenue, COUNT(*) AS totalBookings
      FROM bookings WHERE status != 'cancelled'
    `);
    const paidResult = await db.execute(`
      SELECT COALESCE(SUM(amount), 0) AS totalCollected FROM payments
    `);
    const expensesResult = await db.execute(`
      SELECT COALESCE(SUM(amount), 0) AS totalExpenses FROM expenses
    `);
    const pendingResult = await db.execute(`
      SELECT COUNT(*) AS pendingCount FROM bookings WHERE status = 'pending'
    `);
    const pendingBalanceResult = await db.execute(`
      SELECT COALESCE(SUM(MAX(b.total_amount - COALESCE(p.paid, 0), 0)), 0) AS pendingBalance
      FROM bookings b
      LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = b.id
      WHERE b.status != 'cancelled'
    `);

    const totalRevenue = Number(revenueResult.rows[0].totalRevenue);
    const totalExpenses = Number(expensesResult.rows[0].totalExpenses);

    res.json({
      totalRevenue,
      totalBookings: Number(revenueResult.rows[0].totalBookings),
      totalCollected: Number(paidResult.rows[0].totalCollected),
      totalExpenses,
      netEarnings: totalRevenue - totalExpenses,
      pendingCount: Number(pendingResult.rows[0].pendingCount),
      pendingBalance: Number(pendingBalanceResult.rows[0].pendingBalance)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load summary report' });
  }
});

// Front-desk daily view: who's arriving/leaving today, cash taken today, who still owes money
router.get('/daily-summary', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const checkinsResult = await db.execute({
      sql: `
        SELECT bookings.*, rooms.name AS room_name
        FROM bookings JOIN rooms ON rooms.id = bookings.room_id
        WHERE checkin = ? AND status != 'cancelled'
        ORDER BY bookings.id
      `,
      args: [date]
    });
    const checkoutsResult = await db.execute({
      sql: `
        SELECT bookings.*, rooms.name AS room_name
        FROM bookings JOIN rooms ON rooms.id = bookings.room_id
        WHERE checkout = ? AND status != 'cancelled'
        ORDER BY bookings.id
      `,
      args: [date]
    });
    const cashTodayResult = await db.execute({
      sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE date(recorded_at) = ?`,
      args: [date]
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

    res.json({
      date,
      checkins: checkinsResult.rows.map(withBalance),
      checkouts: checkoutsResult.rows.map(withBalance),
      cashReceivedToday: Number(cashTodayResult.rows[0].total),
      outstandingTotal: outstandingResult.rows.reduce((sum, r) => sum + Number(r.balance), 0),
      outstandingBookings: outstandingResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load daily summary' });
  }
});

module.exports = router;
