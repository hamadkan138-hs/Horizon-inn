const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;
const { recomputeBookingTotal } = require('../lib/billing');
const { assertBookingUnlocked, BookingLockedError } = require('../lib/lock');

const router = express.Router();

function parseItem(row) {
  return {
    id: Number(row.id), name: row.name, price: Number(row.price),
    stockQuantity: Number(row.stock_quantity), lowStockThreshold: Number(row.low_stock_threshold),
    active: !!row.active, createdAt: row.created_at
  };
}

router.use(adminAuth, requireRole('admin', 'staff'));

router.get('/', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM minibar_items ORDER BY name ASC');
    res.json(result.rows.map(parseItem));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load mini bar items' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, price, stockQuantity, lowStockThreshold } = req.body;
    if (!name || !price || price <= 0) {
      return res.status(400).json({ error: 'A name and a price greater than 0 are required' });
    }
    const result = await db.execute({
      sql: 'INSERT INTO minibar_items (name, price, stock_quantity, low_stock_threshold) VALUES (?, ?, ?, ?)',
      args: [name.trim(), price, Number(stockQuantity) || 0, Number(lowStockThreshold) || 5]
    });
    const created = await db.execute({ sql: 'SELECT * FROM minibar_items WHERE id = ?', args: [Number(result.lastInsertRowid)] });
    res.status(201).json(parseItem(created.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add mini bar item' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { name, price, lowStockThreshold, active } = req.body;
    const updates = [];
    const args = [];
    if (name !== undefined) { updates.push('name = ?'); args.push(name.trim()); }
    if (price !== undefined) { updates.push('price = ?'); args.push(price); }
    if (lowStockThreshold !== undefined) { updates.push('low_stock_threshold = ?'); args.push(lowStockThreshold); }
    if (active !== undefined) { updates.push('active = ?'); args.push(active ? 1 : 0); }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    args.push(req.params.id);

    await db.execute({ sql: `UPDATE minibar_items SET ${updates.join(', ')} WHERE id = ?`, args });
    const updated = await db.execute({ sql: 'SELECT * FROM minibar_items WHERE id = ?', args: [req.params.id] });
    if (!updated.rows[0]) return res.status(404).json({ error: 'Item not found' });
    res.json(parseItem(updated.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update mini bar item' });
  }
});

// Add stock (e.g. after restocking from a supplier) — takes the quantity to
// ADD, not the new total, so staff don't have to do the arithmetic.
router.post('/:id/restock', async (req, res) => {
  try {
    const quantity = Number(req.body.quantity);
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' });
    }
    await db.execute({ sql: 'UPDATE minibar_items SET stock_quantity = stock_quantity + ? WHERE id = ?', args: [quantity, req.params.id] });
    const updated = await db.execute({ sql: 'SELECT * FROM minibar_items WHERE id = ?', args: [req.params.id] });
    if (!updated.rows[0]) return res.status(404).json({ error: 'Item not found' });
    res.json(parseItem(updated.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to restock item' });
  }
});

// Records a guest taking an item from the mini bar: decrements stock AND
// bills the booking for it, in one action, so the two never drift apart.
router.post('/:id/consume', async (req, res) => {
  try {
    const { bookingId, quantity } = req.body;
    const qty = Number(quantity);
    if (!bookingId || !qty || qty <= 0) {
      return res.status(400).json({ error: 'bookingId and a positive quantity are required' });
    }

    const itemResult = await db.execute({ sql: 'SELECT * FROM minibar_items WHERE id = ?', args: [req.params.id] });
    const item = itemResult.rows[0];
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.stock_quantity < qty) {
      return res.status(400).json({ error: `Only ${item.stock_quantity} left in stock` });
    }

    const bookingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [bookingId] });
    if (!bookingResult.rows[0]) return res.status(404).json({ error: 'Booking not found' });
    assertBookingUnlocked(bookingResult.rows[0]);

    await db.execute({ sql: 'UPDATE minibar_items SET stock_quantity = stock_quantity - ? WHERE id = ?', args: [qty, req.params.id] });
    await db.execute({
      sql: "INSERT INTO booking_charges (booking_id, description, amount, category) VALUES (?, ?, ?, 'amenity')",
      args: [bookingId, `Mini Bar: ${item.name} x${qty}`, item.price * qty]
    });
    const booking = await recomputeBookingTotal(bookingId);

    res.json({ charged: true, amount: item.price * qty, booking });
  } catch (err) {
    if (err instanceof BookingLockedError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to record mini bar charge' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM minibar_items WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete mini bar item' });
  }
});

module.exports = router;
