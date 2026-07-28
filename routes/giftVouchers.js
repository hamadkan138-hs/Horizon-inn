const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

function parseVoucher(row) {
  return {
    id: Number(row.id), code: row.code, amount: Number(row.amount),
    purchaserName: row.purchaser_name, purchaserEmail: row.purchaser_email, purchaserPhone: row.purchaser_phone,
    recipientName: row.recipient_name, paymentMethod: row.payment_method, transactionId: row.transaction_id,
    status: row.status, redeemedBookingId: row.redeemed_booking_id ? Number(row.redeemed_booking_id) : null,
    createdAt: row.created_at, activatedAt: row.activated_at, redeemedAt: row.redeemed_at, expiresAt: row.expires_at
  };
}

function generateVoucherCode() {
  return `GIFT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// Public: buy a voucher. Starts pending_payment — same trust model as a cash
// hotel booking, an admin verifies the payment before the code can be used.
router.post('/', async (req, res) => {
  try {
    const { amount, purchaserName, purchaserEmail, purchaserPhone, recipientName, paymentMethod, transactionId } = req.body;
    const amountNum = Number(amount);
    if (!purchaserName || !purchaserPhone || !amountNum || amountNum < 1000) {
      return res.status(400).json({ error: 'Purchaser name, phone, and an amount of at least Rs. 1,000 are required' });
    }
    const code = generateVoucherCode();
    const result = await db.execute({
      sql: `
        INSERT INTO gift_vouchers (code, amount, purchaser_name, purchaser_email, purchaser_phone, recipient_name, payment_method, transaction_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [code, amountNum, purchaserName, purchaserEmail || '', purchaserPhone, recipientName || '', paymentMethod || 'cash', transactionId || '']
    });
    const created = await db.execute({ sql: 'SELECT * FROM gift_vouchers WHERE id = ?', args: [Number(result.lastInsertRowid)] });
    res.status(201).json(parseVoucher(created.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit voucher purchase' });
  }
});

router.use(adminAuth, requireRole('admin', 'staff'));

router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const result = status
      ? await db.execute({ sql: 'SELECT * FROM gift_vouchers WHERE status = ? ORDER BY created_at DESC', args: [status] })
      : await db.execute('SELECT * FROM gift_vouchers ORDER BY created_at DESC');
    res.json(result.rows.map(parseVoucher));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load vouchers' });
  }
});

router.patch('/:id/activate', async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT * FROM gift_vouchers WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) return res.status(404).json({ error: 'Voucher not found' });
    if (existing.rows[0].status !== 'pending_payment') {
      return res.status(400).json({ error: 'Only a pending voucher can be activated' });
    }
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    await db.execute({
      sql: "UPDATE gift_vouchers SET status = 'active', activated_at = datetime('now'), expires_at = ? WHERE id = ?",
      args: [expiresAt.toISOString().slice(0, 10), req.params.id]
    });
    const updated = await db.execute({ sql: 'SELECT * FROM gift_vouchers WHERE id = ?', args: [req.params.id] });
    res.json(parseVoucher(updated.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to activate voucher' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM gift_vouchers WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete voucher' });
  }
});

module.exports = router;
