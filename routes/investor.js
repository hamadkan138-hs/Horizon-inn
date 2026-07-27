const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

// Every route below is financial-aggregate-only or explicitly column-limited.
// No query in this file may select guest name/email/phone/cnic/address or any
// other personally identifying booking field — that is the whole point of the
// investor role. Keep this file isolated from routes/reports.js and
// routes/bookings.js so a future change to those never leaks here.
router.use(adminAuth, requireRole('admin', 'investor'));

const PERIOD_FORMAT = {
  daily: '%Y-%m-%d',
  weekly: '%Y-W%W',
  monthly: '%Y-%m',
  yearly: '%Y'
};

// checkin-based queries (revenue/occupancy) need to look forward too, since
// bookings are frequently for future dates — a backward-only window would
// hide revenue the moment a booking is made. Expense/invoice queries are
// always for today-or-earlier, so they stay backward-only.
function defaultRange(pastDays, futureDays = 0) {
  const to = new Date();
  to.setDate(to.getDate() + futureDays);
  const from = new Date();
  from.setDate(from.getDate() - pastDays);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function resolveRange(req, pastDays = 90, futureDays = 0) {
  return req.query.from && req.query.to ? { from: req.query.from, to: req.query.to } : defaultRange(pastDays, futureDays);
}

router.get('/summary', async (req, res) => {
  try {
    const { from, to } = resolveRange(req, 90, 180);

    const revenueResult = await db.execute({
      sql: `SELECT COALESCE(SUM(total_amount), 0) AS totalRevenue, COUNT(*) AS totalBookings
            FROM bookings WHERE status != 'cancelled' AND checkin BETWEEN ? AND ?`,
      args: [from, to]
    });
    const collectedResult = await db.execute({
      sql: `SELECT COALESCE(SUM(amount), 0) AS totalCollected FROM payments WHERE date(recorded_at) BETWEEN ? AND ?`,
      args: [from, to]
    });
    const expensesResult = await db.execute({
      sql: `SELECT COALESCE(SUM(amount), 0) AS totalExpenses FROM expenses WHERE expense_date BETWEEN ? AND ?`,
      args: [from, to]
    });

    const totalRevenue = Number(revenueResult.rows[0].totalRevenue);
    const totalExpenses = Number(expensesResult.rows[0].totalExpenses);

    res.json({
      from,
      to,
      totalRevenue,
      totalBookings: Number(revenueResult.rows[0].totalBookings),
      totalCollected: Number(collectedResult.rows[0].totalCollected),
      totalExpenses,
      netProfit: totalRevenue - totalExpenses
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load financial summary' });
  }
});

router.get('/revenue-trend', async (req, res) => {
  try {
    const range = PERIOD_FORMAT[req.query.range] ? req.query.range : 'daily';
    const { from, to } = resolveRange(req, 90, 180);
    const result = await db.execute({
      sql: `
        SELECT strftime('${PERIOD_FORMAT[range]}', checkin) AS period, SUM(total_amount) AS revenue
        FROM bookings
        WHERE status != 'cancelled' AND checkin BETWEEN ? AND ?
        GROUP BY period ORDER BY period ASC
      `,
      args: [from, to]
    });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load revenue trend' });
  }
});

router.get('/expense-trend', async (req, res) => {
  try {
    const range = PERIOD_FORMAT[req.query.range] ? req.query.range : 'daily';
    const { from, to } = resolveRange(req);
    const result = await db.execute({
      sql: `
        SELECT strftime('${PERIOD_FORMAT[range]}', expense_date) AS period, SUM(amount) AS total
        FROM expenses
        WHERE expense_date BETWEEN ? AND ?
        GROUP BY period ORDER BY period ASC
      `,
      args: [from, to]
    });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load expense trend' });
  }
});

router.get('/expense-breakdown', async (req, res) => {
  try {
    const { from, to } = resolveRange(req);
    const result = await db.execute({
      sql: `
        SELECT category, COALESCE(SUM(amount), 0) AS total
        FROM expenses WHERE expense_date BETWEEN ? AND ?
        GROUP BY category ORDER BY total DESC
      `,
      args: [from, to]
    });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load expense breakdown' });
  }
});

router.get('/occupancy', async (req, res) => {
  try {
    const { from, to } = resolveRange(req, 14, 30);
    const roomsResult = await db.execute('SELECT total_units FROM rooms WHERE active = 1');
    const capacity = roomsResult.rows.reduce((sum, r) => sum + Number(r.total_units), 0);

    const bookingsResult = await db.execute({
      sql: `SELECT checkin, checkout FROM bookings WHERE status != 'cancelled' AND checkout > ? AND checkin < ?`,
      args: [from, to]
    });

    const days = [];
    const cursor = new Date(from);
    const end = new Date(to);
    while (cursor <= end) {
      days.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    const totalOccupied = days.reduce((sum, day) => sum + bookingsResult.rows.filter((b) => b.checkin <= day && b.checkout > day).length, 0);
    const totalCapacity = capacity * days.length;

    res.json({ overallRate: totalCapacity ? totalOccupied / totalCapacity : 0, capacity });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load occupancy' });
  }
});

// Deliberately selects ONLY invoice_number / created_at / total_amount — never
// name, email, phone, cnic, room, or any other guest-identifying column.
router.get('/invoices', async (req, res) => {
  try {
    const { from, to } = resolveRange(req);
    const result = await db.execute({
      sql: `
        SELECT invoice_number, created_at, total_amount
        FROM bookings
        WHERE status != 'cancelled' AND invoice_number != '' AND date(created_at) BETWEEN ? AND ?
        ORDER BY created_at DESC
        LIMIT 500
      `,
      args: [from, to]
    });
    const invoices = result.rows.map((row) => {
      const [date, time] = String(row.created_at).split(' ');
      return { invoiceNumber: row.invoice_number, date, time: time || '', amount: Number(row.total_amount) };
    });
    res.json(invoices);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load invoices' });
  }
});

module.exports = router;
