const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;
const { getDailySummary } = require('../lib/dailySummary');
const { sendDailySummaryEmail } = require('../lib/mailer');

const router = express.Router();

router.use(adminAuth, requireRole('admin', 'staff'));

const PERIOD_FORMAT = {
  daily: '%Y-%m-%d',
  weekly: '%Y-W%W',
  monthly: '%Y-%m'
};

function defaultRange(pastDays, futureDays = 0) {
  const to = new Date();
  to.setDate(to.getDate() + futureDays);
  const from = new Date();
  from.setDate(from.getDate() - pastDays);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

// Revenue grouped by day/week/month, based on confirmed-or-later bookings
router.get('/revenue', async (req, res) => {
  try {
    const range = PERIOD_FORMAT[req.query.range] ? req.query.range : 'daily';
    const { from, to } = req.query.from && req.query.to ? req.query : defaultRange(90, 180);

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
    const { from, to } = req.query.from && req.query.to ? req.query : defaultRange(14, 30);

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

// Payments grouped by method — for the payment-method distribution chart
router.get('/payment-methods', async (req, res) => {
  try {
    const { from, to } = req.query.from && req.query.to ? req.query : defaultRange(90);
    const result = await db.execute({
      sql: `
        SELECT method, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
        FROM payments
        WHERE date(recorded_at) BETWEEN ? AND ?
        GROUP BY method
        ORDER BY total DESC
      `,
      args: [from, to]
    });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load payment method report' });
  }
});

// Revenue grouped by room type — "which rooms earn the most" view
router.get('/room-revenue', async (req, res) => {
  try {
    const { from, to } = req.query.from && req.query.to ? req.query : defaultRange(90, 180);
    const result = await db.execute({
      sql: `
        SELECT rooms.name AS room_name,
               COALESCE(SUM(bookings.total_amount), 0) AS revenue,
               COUNT(*) AS bookings
        FROM bookings
        JOIN rooms ON rooms.id = bookings.room_id
        WHERE bookings.status != 'cancelled' AND bookings.checkin BETWEEN ? AND ?
        GROUP BY rooms.id
        ORDER BY revenue DESC
      `,
      args: [from, to]
    });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load room revenue report' });
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
    const summary = await getDailySummary(req.query.date);
    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load daily summary' });
  }
});

// "Today at a Glance" — a single call the admin dashboard's home screen
// uses to answer "what needs my attention right now" without the admin
// having to click through every tab. Pulls one small count/list from each
// area that can accumulate unattended work (cancellations, vouchers,
// abandoned leads, reviews, investor leads), reusing the same status
// values each of those tabs already filters by.
router.get('/overview', async (req, res) => {
  try {
    const daily = await getDailySummary();

    const [cancellations, pendingVouchers, openRecovery, pendingReviews, newLeads, lowStockMinibar] = await Promise.all([
      db.execute(`
        SELECT bookings.id, bookings.name, bookings.invoice_number, bookings.cancellation_requested_at
        FROM bookings
        WHERE cancellation_requested_at IS NOT NULL AND status != 'cancelled'
        ORDER BY cancellation_requested_at DESC
      `),
      db.execute(`
        SELECT id, code, amount, purchaser_name, purchaser_phone FROM gift_vouchers
        WHERE status = 'pending_payment' ORDER BY created_at DESC
      `),
      db.execute(`
        SELECT id, name, phone, checkin, checkout FROM abandoned_bookings
        WHERE status = 'open' ORDER BY created_at DESC
      `),
      db.execute(`
        SELECT id, guest_name, rating FROM reviews WHERE status = 'pending' ORDER BY created_at DESC
      `),
      db.execute(`
        SELECT id, full_name, phone FROM investor_leads WHERE status = 'new_lead' ORDER BY created_at DESC
      `),
      db.execute(`
        SELECT id, name, stock_quantity, low_stock_threshold FROM minibar_items
        WHERE active = 1 AND stock_quantity <= low_stock_threshold ORDER BY stock_quantity ASC
      `)
    ]);

    res.json({
      date: daily.date,
      arrivals: daily.checkins,
      departures: daily.checkouts,
      outstandingTotal: daily.outstandingTotal,
      outstandingCount: daily.outstandingBookings.length,
      cancellationRequests: cancellations.rows,
      pendingVouchers: pendingVouchers.rows,
      openRecovery: openRecovery.rows,
      pendingReviews: pendingReviews.rows,
      newLeads: newLeads.rows,
      lowStockMinibar: lowStockMinibar.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

// Lets an admin/staff member fire the automated daily summary email on
// demand — useful to confirm the mail credentials work right after
// deploying, without waiting for the next scheduled run.
router.post('/daily-summary/send-now', requireRole('admin', 'staff'), async (req, res) => {
  try {
    const result = await sendDailySummaryEmail();
    if (!result.sent) {
      return res.status(400).json({ error: result.reason });
    }
    res.json({ sent: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send the summary email' });
  }
});

module.exports = router;
