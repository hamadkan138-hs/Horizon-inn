const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

router.use(adminAuth, requireRole('admin', 'staff'));

const RECEIVER_TYPES = ['owner', 'bank', 'staff'];

// A handover is a physical cash custody transfer — it must reflect what's
// actually IN THE DRAWER, not what a guest said their intended payment
// method would be when they booked. bookings.payment_method is that
// original intent (almost always 'pay_at_property' for a walk-in), which
// can diverge from how the money was actually settled — e.g. an advance
// paid via JazzCash with the balance collected in cash at checkout. Real
// settlement is recorded per-transaction on the payments table's own
// `method` column ('cash' / 'bank_transfer' / 'easypaisa' / 'jazzcash'),
// so that's what cash/bank/online totals are built from below — not from
// the booking-level field.
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

  const bookingIds = bookingsResult.rows.map((b) => b.id);
  const paymentsByBooking = {};
  if (bookingIds.length) {
    const placeholders = bookingIds.map(() => '?').join(',');
    const paymentsResult = await db.execute({
      sql: `SELECT booking_id, method, SUM(amount) AS total FROM payments WHERE booking_id IN (${placeholders}) GROUP BY booking_id, method`,
      args: bookingIds
    });
    paymentsResult.rows.forEach((r) => {
      const bucket = bucketFor(r.method);
      paymentsByBooking[r.booking_id] = paymentsByBooking[r.booking_id] || { cash: 0, bank: 0, online: 0 };
      paymentsByBooking[r.booking_id][bucket] += Number(r.total);
    });
  }

  const expensesResult = await db.execute(`
    SELECT id, category, description, amount, expense_date
    FROM expenses
    WHERE handover_id IS NULL
    ORDER BY expense_date ASC
  `);

  const totals = { cash: 0, bank: 0, online: 0 };
  const bookings = bookingsResult.rows.map((b) => {
    const p = paymentsByBooking[b.id] || { cash: 0, bank: 0, online: 0 };
    totals.cash += p.cash;
    totals.bank += p.bank;
    totals.online += p.online;
    return { ...b, cashAmount: p.cash, bankAmount: p.bank, onlineAmount: p.online };
  });
  // The handover's own bookings list is cash bookings only — a stay paid
  // entirely by bank/online never touches the till, so it has no business
  // showing up in a cash handover at all (its revenue is visible in Daily
  // Summary instead). Every checked-out/unswept booking still gets its
  // handover_id stamped below regardless of payment mix, so a pure-bank
  // booking doesn't linger in this query forever — it's just never shown
  // or counted here as cash.
  const cashBookings = bookings.filter((b) => b.cashAmount > 0);

  const expensesTotal = expensesResult.rows.reduce((sum, e) => sum + Number(e.amount), 0);
  const netCashHanded = totals.cash - expensesTotal;

  return {
    bookings: cashBookings,
    allSweptBookingIds: bookingsResult.rows.map((b) => b.id),
    expenses: expensesResult.rows,
    cashTotal: totals.cash,
    bankTotal: totals.bank,
    onlineTotal: totals.online,
    expensesTotal,
    netCashHanded,
    bookingCount: cashBookings.length
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

    // Zero pending bookings/expenses is a valid state, not an error — staff
    // must always be able to record a shift close-out (even an empty one)
    // instead of getting stuck unable to submit the handover form.
    const summary = await computeUnswept();

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

    // A staff -> staff handover is a custody transfer, not a settlement: the
    // cash stays inside the business, it just changes hands between shifts.
    // Only bank/owner handovers actually remove money from the business, so
    // only those claim the swept bookings/expenses (dropping them out of the
    // pending-handover total). A staff handover still creates the row above
    // — so who handed over to whom, and when, is on the record — it just
    // leaves handover_id untouched so the pending total is unaffected and
    // the same cash still shows up (correctly) in the next real handover.
    if (receiverType !== 'staff') {
      // Every checked-out/unswept booking closes out here, cash or not —
      // a bank/online-only stay never touches the till so it's excluded
      // from summary.bookings and the cash totals above, but it still
      // needs handover_id set or it would keep reappearing in every future
      // preview forever with nothing to actually collect.
      if (summary.allSweptBookingIds.length) {
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
    }

    const created = await db.execute({ sql: 'SELECT * FROM handovers WHERE id = ?', args: [handoverId] });
    res.status(201).json(created.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create handover' });
  }
});

module.exports = router;
module.exports.computeUnswept = computeUnswept;
