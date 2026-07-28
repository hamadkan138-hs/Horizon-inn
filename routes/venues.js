const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

// Investors get read-only access (venue list + analytics); booking management
// (creating, verifying, invoicing) is admin/staff only, enforced per-route below.
router.use(adminAuth, requireRole('admin', 'staff', 'investor'));

function parseVenue(row) {
  return {
    id: Number(row.id), slug: row.slug, name: row.name, description: row.description,
    sizeSqft: Number(row.size_sqft), baseDayRate: Number(row.base_day_rate),
    isBuyout: !!row.is_buyout, active: !!row.active
  };
}

function parseBooking(row) {
  return {
    id: Number(row.id), venueId: Number(row.venue_id), venueName: row.venue_name || undefined,
    customerName: row.customer_name, customerPhone: row.customer_phone, customerEmail: row.customer_email,
    eventDate: row.event_date, eventType: row.event_type, guestCount: Number(row.guest_count),
    baseRate: Number(row.base_rate), lineItems: JSON.parse(row.line_items || '[]'),
    securityDeposit: Number(row.security_deposit), discountAmount: Number(row.discount_amount),
    gstPercent: Number(row.gst_percent), gstAmount: Number(row.gst_amount), totalAmount: Number(row.total_amount),
    paymentMethod: row.payment_method, transactionId: row.transaction_id,
    status: row.status, bookingCode: row.booking_code, notes: row.notes, createdBy: row.created_by,
    createdAt: row.created_at, verifiedBy: row.verified_by, verifiedAt: row.verified_at
  };
}

function generateBookingCode() {
  return `CG-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

const BOOKING_SELECT = `SELECT vb.*, v.name AS venue_name FROM venue_bookings vb JOIN venues v ON v.id = vb.venue_id`;

router.get('/', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM venues WHERE active = 1 ORDER BY id ASC');
    res.json(result.rows.map(parseVenue));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load venues' });
  }
});

router.get('/bookings', requireRole('admin', 'staff'), async (req, res) => {
  try {
    const { status, venueId, from, to } = req.query;
    const clauses = [];
    const args = [];
    if (status) { clauses.push('vb.status = ?'); args.push(status); }
    if (venueId) { clauses.push('vb.venue_id = ?'); args.push(venueId); }
    if (from) { clauses.push('vb.event_date >= ?'); args.push(from); }
    if (to) { clauses.push('vb.event_date <= ?'); args.push(to); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await db.execute({
      sql: `${BOOKING_SELECT} ${where} ORDER BY vb.event_date DESC, vb.id DESC`,
      args
    });
    res.json(result.rows.map(parseBooking));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load bookings' });
  }
});

router.get('/bookings/:id', requireRole('admin', 'staff'), async (req, res) => {
  try {
    const result = await db.execute({ sql: `${BOOKING_SELECT} WHERE vb.id = ?`, args: [req.params.id] });
    if (!result.rows[0]) return res.status(404).json({ error: 'Booking not found' });
    res.json(parseBooking(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load booking' });
  }
});

router.post('/bookings', requireRole('admin', 'staff'), async (req, res) => {
  try {
    const {
      venueId, customerName, customerPhone, customerEmail, eventDate, eventType, guestCount,
      lineItems, securityDeposit, discountAmount, gstPercent, paymentMethod, transactionId, notes
    } = req.body;

    if (!venueId || !customerName || !eventDate) {
      return res.status(400).json({ error: 'venueId, customerName, and eventDate are required' });
    }

    const venueResult = await db.execute({ sql: 'SELECT * FROM venues WHERE id = ?', args: [venueId] });
    const venue = venueResult.rows[0];
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    // Same-venue-same-date guard, DB-checked at insert time. A full-complex buyout
    // blocks (and is blocked by) any individual-venue booking that day, so booking
    // one space and booking the whole complex can never silently double-book.
    const isBuyout = !!venue.is_buyout;
    const conflictSql = isBuyout
      ? `SELECT COUNT(*) AS n FROM venue_bookings WHERE event_date = ? AND status != 'cancelled'`
      : `SELECT COUNT(*) AS n FROM venue_bookings vb JOIN venues v ON v.id = vb.venue_id
         WHERE vb.event_date = ? AND vb.status != 'cancelled' AND (vb.venue_id = ? OR v.is_buyout = 1)`;
    const conflictArgs = isBuyout ? [eventDate] : [eventDate, venueId];
    const conflict = await db.execute({ sql: conflictSql, args: conflictArgs });
    if (Number(conflict.rows[0].n) > 0) {
      return res.status(409).json({ error: 'That venue is already booked or held for this date' });
    }

    const items = Array.isArray(lineItems)
      ? lineItems.filter((li) => li && li.description && !Number.isNaN(Number(li.amount))).map((li) => ({ description: String(li.description), amount: Number(li.amount) }))
      : [];
    const itemsTotal = items.reduce((sum, li) => sum + li.amount, 0);
    const baseRate = Number(venue.base_day_rate);
    const deposit = Number(securityDeposit) || 0;
    const discount = Number(discountAmount) || 0;
    const gstRate = Number(gstPercent) || 0;
    const subtotal = baseRate + itemsTotal - discount;
    const gstAmount = Math.round(subtotal * (gstRate / 100));
    const totalAmount = subtotal + gstAmount + deposit;

    const bookingCode = generateBookingCode();
    const status = paymentMethod === 'card' ? 'confirmed' : 'pending_cash';

    const result = await db.execute({
      sql: `
        INSERT INTO venue_bookings (
          venue_id, customer_name, customer_phone, customer_email, event_date, event_type, guest_count,
          base_rate, line_items, security_deposit, discount_amount, gst_percent, gst_amount, total_amount,
          payment_method, transaction_id, status, booking_code, notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        venueId, customerName, customerPhone || '', customerEmail || '', eventDate, eventType || '', guestCount || 0,
        baseRate, JSON.stringify(items), deposit, discount, gstRate, gstAmount, totalAmount,
        paymentMethod || 'cash', transactionId || '', status, bookingCode, notes || '', req.user.username
      ]
    });

    const created = await db.execute({ sql: `${BOOKING_SELECT} WHERE vb.id = ?`, args: [Number(result.lastInsertRowid)] });
    res.status(201).json(parseBooking(created.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// Approve/reject a pending cash or bank-transfer booking. This is the lock step —
// once approved, the slot is a real confirmed booking, not just a hold.
router.patch('/bookings/:id/verify', requireRole('admin', 'staff'), async (req, res) => {
  try {
    const { action } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
    }
    const existing = await db.execute({ sql: 'SELECT * FROM venue_bookings WHERE id = ?', args: [req.params.id] });
    const booking = existing.rows[0];
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'pending_cash') {
      return res.status(400).json({ error: 'Only pending bookings can be verified' });
    }

    const newStatus = action === 'approve' ? 'confirmed' : 'cancelled';
    await db.execute({
      sql: "UPDATE venue_bookings SET status = ?, verified_by = ?, verified_at = datetime('now') WHERE id = ?",
      args: [newStatus, req.user.username, req.params.id]
    });
    const updated = await db.execute({ sql: `${BOOKING_SELECT} WHERE vb.id = ?`, args: [req.params.id] });
    res.json(parseBooking(updated.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to verify booking' });
  }
});

router.patch('/bookings/:id', requireRole('admin', 'staff'), async (req, res) => {
  try {
    const { status, notes } = req.body;
    const updates = [];
    const args = [];
    if (status !== undefined) { updates.push('status = ?'); args.push(status); }
    if (notes !== undefined) { updates.push('notes = ?'); args.push(notes); }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    args.push(req.params.id);
    await db.execute({ sql: `UPDATE venue_bookings SET ${updates.join(', ')} WHERE id = ?`, args });
    const updated = await db.execute({ sql: `${BOOKING_SELECT} WHERE vb.id = ?`, args: [req.params.id] });
    if (!updated.rows[0]) return res.status(404).json({ error: 'Booking not found' });
    res.json(parseBooking(updated.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// Aggregate financials only — no customer PII — so investors can see this too.
router.get('/analytics', async (req, res) => {
  try {
    const toDefault = new Date().toISOString().slice(0, 10);
    const fromDefaultDate = new Date();
    fromDefaultDate.setMonth(fromDefaultDate.getMonth() - 1);
    const from = req.query.from || fromDefaultDate.toISOString().slice(0, 10);
    const to = req.query.to || toDefault;

    const revenueResult = await db.execute({
      sql: `SELECT COALESCE(SUM(total_amount - security_deposit),0) AS revenue FROM venue_bookings
            WHERE status IN ('confirmed','completed') AND event_date BETWEEN ? AND ?`,
      args: [from, to]
    });
    const pendingResult = await db.execute(
      "SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS value FROM venue_bookings WHERE status = 'pending_cash'"
    );
    const expensesResult = await db.execute({
      sql: `SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE venue_id IS NOT NULL AND expense_date BETWEEN ? AND ?`,
      args: [from, to]
    });
    const venuesResult = await db.execute('SELECT * FROM venues WHERE active = 1 ORDER BY id ASC');
    const venues = venuesResult.rows.map(parseVenue);

    const daysInRange = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
    const perVenueOccupancy = {};
    for (const v of venues) {
      const bookedResult = await db.execute({
        sql: `SELECT COUNT(DISTINCT event_date) AS n FROM venue_bookings
              WHERE venue_id = ? AND status IN ('confirmed','completed') AND event_date BETWEEN ? AND ?`,
        args: [v.id, from, to]
      });
      perVenueOccupancy[v.name] = Math.round((Number(bookedResult.rows[0].n) / daysInRange) * 100);
    }

    const grossRevenue = Number(revenueResult.rows[0].revenue);
    const operatingExpenses = Number(expensesResult.rows[0].total);
    const netProfit = grossRevenue - operatingExpenses;
    const netMarginPct = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;
    const nonBuyoutVenues = venues.filter((v) => !v.isBuyout);
    const overallOccupancyPct = nonBuyoutVenues.length
      ? Math.round(nonBuyoutVenues.reduce((sum, v) => sum + (perVenueOccupancy[v.name] || 0), 0) / nonBuyoutVenues.length)
      : 0;

    const seriesResult = await db.execute(`
      SELECT strftime('%Y-%m', event_date) AS period,
             SUM(total_amount - security_deposit) AS revenue
      FROM venue_bookings WHERE status IN ('confirmed','completed')
      GROUP BY period ORDER BY period DESC LIMIT 6
    `);
    const revenueByMonth = seriesResult.rows.reverse();
    const expensesSeriesResult = await db.execute(`
      SELECT strftime('%Y-%m', expense_date) AS period, SUM(amount) AS total
      FROM expenses WHERE venue_id IS NOT NULL
      GROUP BY period ORDER BY period DESC LIMIT 6
    `);
    const expenseMap = Object.fromEntries(expensesSeriesResult.rows.map((r) => [r.period, Number(r.total)]));

    res.json({
      from, to,
      grossRevenue,
      pendingCashCount: Number(pendingResult.rows[0].n),
      pendingCashValue: Number(pendingResult.rows[0].value),
      operatingExpenses,
      netProfit,
      netMarginPct,
      occupancyPct: overallOccupancyPct,
      perVenueOccupancy,
      revenueByMonth: revenueByMonth.map((r) => ({
        period: r.period,
        revenue: Number(r.revenue) || 0,
        expenses: expenseMap[r.period] || 0
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

router.get('/analytics/export', async (req, res) => {
  try {
    const { from, to } = req.query;
    const result = await db.execute({
      sql: `${BOOKING_SELECT} WHERE vb.event_date BETWEEN ? AND ? ORDER BY vb.event_date ASC`,
      args: [from || '2000-01-01', to || '2999-12-31']
    });
    const header = ['Booking Code', 'Venue', 'Customer', 'Event Date', 'Status', 'Payment Method', 'Total Amount (PKR)'];
    const csvRows = [header.join(',')];
    for (const r of result.rows) {
      csvRows.push([
        r.booking_code, `"${r.venue_name}"`, `"${r.customer_name}"`, r.event_date,
        r.status, r.payment_method, r.total_amount
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="venue-bookings-report.csv"');
    res.send(csvRows.join('\n'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

module.exports = router;
