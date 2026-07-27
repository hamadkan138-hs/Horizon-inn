const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

router.use(adminAuth, requireRole('admin', 'staff'));

const RECEIVER_TYPES = ['owner', 'bank', 'staff'];

// A booking's single payment_method field is bucketed into the three cash
// "buckets" the handover cares about. 'pay_at_property' means the guest paid
// in person, which in practice at a small guest house is cash in hand.
function bucketFor(method) {
  if (method === 'bank_transfer') return 'bank';
  if (method === 'easypaisa' || method === 'jazzcash') return 'online';
  return 'cash';
}

async function computeUnswept() {
  const bookingsResult = await db.execute(`
    SELECT id, invoice_number, name, room_id, checkin, checkout, payment_method, total_amount, created_at
    FROM bookings
    WHERE status = 'checked_out' AND handover_id IS NULL
    ORDER BY created_at ASC
  `);
  const expensesResult = await db.execute(`
    SELECT id, category, description, amount, expense_date
    FROM expenses
    WHERE handover_id IS NULL
    ORDER BY expense_date ASC
  `);

  const totals = { cash: 0, bank: 0, online: 0 };
  bookingsResult.rows.forEach((b) => { totals[bucketFor(b.payment_method)] += Number(b.total_amount); });
  const expensesTotal = expensesResult.rows.reduce((sum, e) => sum + Number(e.amount), 0);
  const netCashHanded = totals.cash - expensesTotal;

  return {
    bookings: bookingsResult.rows,
    expenses: expensesResult.rows,
    cashTotal: totals.cash,
    bankTotal: totals.bank,
    onlineTotal: totals.online,
    expensesTotal,
    netCashHanded,
    bookingCount: bookingsResult.rows.length
  };
}

// Preview what a handover right now would sweep up, without actually doing
// it — this is what powers the confirmation modal.
router.get('/preview', async (req, res) => {
  try {
    const summary = await computeUnswept();
    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to build handover preview' });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM handovers ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load handover history' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const handoverResult = await db.execute({ sql: 'SELECT * FROM handovers WHERE id = ?', args: [req.params.id] });
    const handover = handoverResult.rows[0];
    if (!handover) return res.status(404).json({ error: 'Handover not found' });

    const bookingsResult = await db.execute({
      sql: `
        SELECT bookings.*, rooms.name AS room_name
        FROM bookings JOIN rooms ON rooms.id = bookings.room_id
        WHERE bookings.handover_id = ?
        ORDER BY bookings.checkout ASC
      `,
      args: [req.params.id]
    });
    res.json({ ...handover, bookings: bookingsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load handover' });
  }
});

// Create a handover — this is the one-way sweep. Every checked-out booking
// and every expense not already claimed by an earlier handover gets stamped
// with this handover's id, which is what makes them "Handed Over" and
// permanently excluded from every future handover.
router.post('/', async (req, res) => {
  try {
    const { receiverType, receiverName, note } = req.body;
    if (!RECEIVER_TYPES.includes(receiverType)) {
      return res.status(400).json({ error: `receiverType must be one of: ${RECEIVER_TYPES.join(', ')}` });
    }
    if (!receiverName || !receiverName.trim()) {
      return res.status(400).json({ error: 'Receiver name is required (owner name, bank name, or the staff taking over)' });
    }

    const summary = await computeUnswept();
    if (summary.bookingCount === 0 && summary.expenses.length === 0) {
      return res.status(400).json({ error: 'There is nothing to hand over right now — no checked-out bookings or expenses are pending.' });
    }

    const insertResult = await db.execute({
      sql: `
        INSERT INTO handovers (
          receiver_type, receiver_name, staff_name, cash_total, bank_total, online_total,
          expenses_total, net_cash_handed, booking_count, note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        receiverType, receiverName.trim(), req.user.username,
        summary.cashTotal, summary.bankTotal, summary.onlineTotal,
        summary.expensesTotal, summary.netCashHanded, summary.bookingCount, note || ''
      ]
    });
    const handoverId = Number(insertResult.lastInsertRowid);

    if (summary.bookings.length) {
      await db.execute({
        sql: `UPDATE bookings SET handover_id = ? WHERE status = 'checked_out' AND handover_id IS NULL`,
        args: [handoverId]
      });
    }
    if (summary.expenses.length) {
      await db.execute({
        sql: `UPDATE expenses SET handover_id = ? WHERE handover_id IS NULL`,
        args: [handoverId]
      });
    }

    const created = await db.execute({ sql: 'SELECT * FROM handovers WHERE id = ?', args: [handoverId] });
    res.status(201).json(created.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create handover' });
  }
});

module.exports = router;
