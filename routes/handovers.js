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
  // Cash is tracked per PAYMENT, not per booking. A guest can hand over cash
  // as an advance, or mid-stay, well before they actually check out — that
  // money is physically in the till the moment it's collected and needs to
  // be handed over at end of shift regardless of the booking's status.
  // Gating cash on `status = 'checked_out'` (the original design) meant a
  // shift's cash silently didn't show up in the handover until every one of
  // that day's guests had checked out — real cash sitting in the drawer,
  // invisible here, even though Daily Summary (which counts payments, not
  // checkouts) already showed it as received. handover_id now lives on the
  // payments table itself for exactly this reason.
  const cashPaymentsResult = await db.execute(`
    SELECT payments.id, payments.booking_id, payments.amount, payments.method, payments.recorded_at,
           bookings.name, bookings.invoice_number
    FROM payments
    JOIN bookings ON bookings.id = payments.booking_id
    WHERE payments.handover_id IS NULL
      AND payments.method NOT IN ('bank_transfer', 'easypaisa', 'jazzcash')
    ORDER BY payments.recorded_at ASC
  `);
  const cashTotal = cashPaymentsResult.rows.reduce((sum, p) => sum + Number(p.amount), 0);

  // Bank/online are reference-only here (Daily Summary is where they're
  // actually tracked), so they don't need the same precision — still derived
  // from checked-out/unswept bookings as before, not from individual
  // payments, and not swept themselves (nothing to sweep: they never
  // touched the till).
  const bookingsResult = await db.execute(`
    SELECT id FROM bookings WHERE status = 'checked_out' AND handover_id IS NULL
  `);
  const bookingIds = bookingsResult.rows.map((b) => b.id);
  let bankTotal = 0;
  let onlineTotal = 0;
  if (bookingIds.length) {
    const placeholders = bookingIds.map(() => '?').join(',');
    const nonCashResult = await db.execute({
      sql: `
        SELECT method, SUM(amount) AS total FROM payments
        WHERE booking_id IN (${placeholders}) AND method IN ('bank_transfer', 'easypaisa', 'jazzcash')
        GROUP BY method
      `,
      args: bookingIds
    });
    nonCashResult.rows.forEach((r) => {
      if (bucketFor(r.method) === 'bank') bankTotal += Number(r.total);
      else onlineTotal += Number(r.total);
    });
  }

  const expensesResult = await db.execute(`
    SELECT id, category, description, amount, expense_date
    FROM expenses
    WHERE handover_id IS NULL
    ORDER BY expense_date ASC
  `);
  const expensesTotal = expensesResult.rows.reduce((sum, e) => sum + Number(e.amount), 0);
  const netCashHanded = cashTotal - expensesTotal;

  return {
    payments: cashPaymentsResult.rows,
    allSweptBookingIds: bookingIds,
    expenses: expensesResult.rows,
    cashTotal,
    bankTotal,
    onlineTotal,
    expensesTotal,
    netCashHanded,
    bookingCount: cashPaymentsResult.rows.length
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
      // Sweep the actual cash payments this handover covers — regardless of
      // whether their booking has checked out yet (see computeUnswept()).
      if (summary.payments.length) {
        await db.execute({
          sql: `UPDATE payments SET handover_id = ? WHERE handover_id IS NULL AND method NOT IN ('bank_transfer', 'easypaisa', 'jazzcash')`,
          args: [handoverId]
        });
      }
      // Every checked-out/unswept booking closes out here too, cash or not —
      // a bank/online-only stay never touches the till so it's excluded
      // from summary.payments and the cash totals above, but it still
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
