const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;
const { recomputeBookingTotal } = require('../lib/billing');
const { assertBookingUnlocked, BookingLockedError } = require('../lib/lock');
const { initRoomIfNeeded } = require('../lib/minibarEngine');

const router = express.Router();

function parseItem(row) {
  return {
    id: Number(row.id), name: row.name, price: Number(row.price), costPrice: Number(row.cost_price),
    stockQuantity: Number(row.stock_quantity), lowStockThreshold: Number(row.low_stock_threshold),
    active: !!row.active, createdAt: row.created_at
  };
}

function parseRefillRequest(row) {
  return {
    id: Number(row.id), physicalRoomId: Number(row.physical_room_id), roomNumber: row.room_number,
    requestedBy: row.requested_by, status: row.status, note: row.note,
    createdAt: row.created_at, fulfilledAt: row.fulfilled_at, fulfilledBy: row.fulfilled_by
  };
}

router.use(adminAuth, requireRole('admin', 'staff'));

/* ==================== Central store catalog ==================== */

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
    const { name, price, costPrice, stockQuantity, lowStockThreshold } = req.body;
    if (!name || !price || price <= 0) {
      return res.status(400).json({ error: 'A name and a price greater than 0 are required' });
    }
    const result = await db.execute({
      sql: 'INSERT INTO minibar_items (name, price, cost_price, stock_quantity, low_stock_threshold) VALUES (?, ?, ?, ?, ?)',
      args: [name.trim(), price, Number(costPrice) || 0, Number(stockQuantity) || 0, Number(lowStockThreshold) || 5]
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
    const { name, price, costPrice, lowStockThreshold, active } = req.body;
    const updates = [];
    const args = [];
    if (name !== undefined) { updates.push('name = ?'); args.push(name.trim()); }
    if (price !== undefined) { updates.push('price = ?'); args.push(price); }
    if (costPrice !== undefined) { updates.push('cost_price = ?'); args.push(costPrice); }
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

// Central warehouse restock (e.g. a supplier delivery) — takes the quantity
// to ADD, not the new total.
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

// Ad-hoc charge with no room tracking (e.g. sold at the front desk counter,
// or a booking with no physical room assigned) — decrements CENTRAL stock
// directly. Room-based sales go through /rooms/:id/consume instead, which
// decrements that room's own stock.
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

// Removing an item from the catalog (not the same as the audit log, which
// is never deletable) — restricted to admin as a basic guard against
// unauthorized changes to shared pricing data.
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM minibar_items WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete mini bar item' });
  }
});

/* ==================== Packages (Standard / Premium / custom) ==================== */

router.get('/packages', async (req, res) => {
  try {
    const packagesResult = await db.execute('SELECT * FROM minibar_packages ORDER BY name ASC');
    const itemsResult = await db.execute(`
      SELECT mpi.package_id, mpi.minibar_item_id, mpi.quantity, mi.name, mi.price
      FROM minibar_package_items mpi JOIN minibar_items mi ON mi.id = mpi.minibar_item_id
    `);
    const itemsByPackage = {};
    itemsResult.rows.forEach((r) => {
      if (!itemsByPackage[r.package_id]) itemsByPackage[r.package_id] = [];
      itemsByPackage[r.package_id].push({
        minibarItemId: Number(r.minibar_item_id), name: r.name, price: Number(r.price), quantity: Number(r.quantity)
      });
    });
    res.json(packagesResult.rows.map((p) => ({
      id: Number(p.id), name: p.name, active: !!p.active, items: itemsByPackage[p.id] || []
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load packages' });
  }
});

router.post('/packages', async (req, res) => {
  try {
    const { name, items } = req.body;
    if (!name) return res.status(400).json({ error: 'A name is required' });
    const result = await db.execute({ sql: 'INSERT INTO minibar_packages (name) VALUES (?)', args: [name.trim()] });
    const pkgId = Number(result.lastInsertRowid);
    for (const item of (Array.isArray(items) ? items : [])) {
      if (item.minibarItemId && Number(item.quantity) > 0) {
        await db.execute({
          sql: 'INSERT INTO minibar_package_items (package_id, minibar_item_id, quantity) VALUES (?, ?, ?)',
          args: [pkgId, item.minibarItemId, Number(item.quantity)]
        });
      }
    }
    res.status(201).json({ id: pkgId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create package' });
  }
});

router.patch('/packages/:id', async (req, res) => {
  try {
    const { name, active, items } = req.body;
    const updates = [];
    const args = [];
    if (name !== undefined) { updates.push('name = ?'); args.push(name.trim()); }
    if (active !== undefined) { updates.push('active = ?'); args.push(active ? 1 : 0); }
    if (updates.length) {
      args.push(req.params.id);
      await db.execute({ sql: `UPDATE minibar_packages SET ${updates.join(', ')} WHERE id = ?`, args });
    }
    if (Array.isArray(items)) {
      await db.execute({ sql: 'DELETE FROM minibar_package_items WHERE package_id = ?', args: [req.params.id] });
      for (const item of items) {
        if (item.minibarItemId && Number(item.quantity) > 0) {
          await db.execute({
            sql: 'INSERT INTO minibar_package_items (package_id, minibar_item_id, quantity) VALUES (?, ?, ?)',
            args: [req.params.id, item.minibarItemId, Number(item.quantity)]
          });
        }
      }
    }
    res.json({ updated: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update package' });
  }
});

/* ==================== Room-wise POS ==================== */

router.get('/rooms', async (req, res) => {
  try {
    const roomsResult = await db.execute(`
      SELECT pr.id, pr.room_number, pr.floor, pr.minibar_package_id, r.name AS room_type_name
      FROM physical_rooms pr JOIN rooms r ON r.id = pr.room_type_id
      ORDER BY pr.room_number ASC
    `);
    const bookingsResult = await db.execute(`
      SELECT id, name, physical_room_id FROM bookings WHERE status = 'checked_in' AND physical_room_id IS NOT NULL
    `);
    // "Low" for a ROOM means below its own package baseline (opening_stock) —
    // a room only ever holds a couple of units per item, so the central
    // catalog's low_stock_threshold (meant for warehouse-scale counts)
    // would flag every room as low the moment a single item is opened.
    const stockResult = await db.execute(`
      SELECT rms.physical_room_id,
             COUNT(*) AS itemCount,
             SUM(CASE WHEN rms.current_stock < rms.opening_stock THEN 1 ELSE 0 END) AS lowStockCount
      FROM room_minibar_stock rms
      GROUP BY rms.physical_room_id
    `);
    const bookingByRoom = {};
    bookingsResult.rows.forEach((b) => { bookingByRoom[b.physical_room_id] = b; });
    const stockByRoom = {};
    stockResult.rows.forEach((s) => { stockByRoom[s.physical_room_id] = s; });

    res.json(roomsResult.rows.map((r) => ({
      id: Number(r.id), roomNumber: r.room_number, floor: r.floor, roomTypeName: r.room_type_name,
      packageId: r.minibar_package_id ? Number(r.minibar_package_id) : null,
      activeBooking: bookingByRoom[r.id] ? { id: Number(bookingByRoom[r.id].id), guestName: bookingByRoom[r.id].name } : null,
      itemCount: stockByRoom[r.id] ? Number(stockByRoom[r.id].itemCount) : 0,
      lowStockCount: stockByRoom[r.id] ? Number(stockByRoom[r.id].lowStockCount) : 0,
      initialized: !!stockByRoom[r.id]
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load rooms' });
  }
});

router.get('/rooms/:id', async (req, res) => {
  try {
    const roomResult = await db.execute({ sql: 'SELECT * FROM physical_rooms WHERE id = ?', args: [req.params.id] });
    const room = roomResult.rows[0];
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const stockResult = await db.execute({
      sql: `
        SELECT rms.*, mi.name, mi.price, mi.low_stock_threshold, mi.active AS item_active
        FROM room_minibar_stock rms JOIN minibar_items mi ON mi.id = rms.minibar_item_id
        WHERE rms.physical_room_id = ? ORDER BY mi.name ASC
      `,
      args: [req.params.id]
    });
    const bookingResult = await db.execute({
      sql: `SELECT * FROM bookings WHERE physical_room_id = ? AND status = 'checked_in' ORDER BY created_at DESC LIMIT 1`,
      args: [req.params.id]
    });
    const logResult = await db.execute({
      sql: `
        SELECT mrl.*, mi.name AS item_name
        FROM minibar_room_log mrl JOIN minibar_items mi ON mi.id = mrl.minibar_item_id
        WHERE mrl.physical_room_id = ? ORDER BY mrl.created_at DESC LIMIT 50
      `,
      args: [req.params.id]
    });

    res.json({
      id: Number(room.id), roomNumber: room.room_number, floor: room.floor,
      packageId: room.minibar_package_id ? Number(room.minibar_package_id) : null,
      activeBooking: bookingResult.rows[0] ? {
        id: Number(bookingResult.rows[0].id), guestName: bookingResult.rows[0].name, invoiceNumber: bookingResult.rows[0].invoice_number
      } : null,
      stock: stockResult.rows.map((s) => ({
        minibarItemId: Number(s.minibar_item_id), name: s.name, price: Number(s.price),
        openingStock: Number(s.opening_stock), currentStock: Number(s.current_stock),
        lowStockThreshold: Number(s.low_stock_threshold), active: !!s.item_active
      })),
      log: logResult.rows.map((l) => ({
        id: Number(l.id), itemName: l.item_name, action: l.action, quantity: Number(l.quantity),
        unitPrice: Number(l.unit_price), penaltyAmount: Number(l.penalty_amount),
        chargedBookingId: l.charged_booking_id ? Number(l.charged_booking_id) : null,
        staffUsername: l.staff_username, note: l.note, createdAt: l.created_at
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load room detail' });
  }
});

// Manual (re)initialize — normally happens automatically at check-in, but
// staff can set up a room the first time or reset it to package levels.
router.post('/rooms/:id/init', async (req, res) => {
  try {
    const { packageId, force } = req.body;
    const roomResult = await db.execute({ sql: 'SELECT * FROM physical_rooms WHERE id = ?', args: [req.params.id] });
    if (!roomResult.rows[0]) return res.status(404).json({ error: 'Room not found' });

    let targetPackageId = packageId ? Number(packageId) : roomResult.rows[0].minibar_package_id;
    if (!targetPackageId) {
      const standard = await db.execute("SELECT id FROM minibar_packages WHERE name = 'Standard' LIMIT 1");
      targetPackageId = standard.rows[0] ? Number(standard.rows[0].id) : null;
    }
    if (!targetPackageId) return res.status(400).json({ error: 'No package available to initialize from' });

    if (packageId) {
      await db.execute({ sql: 'UPDATE physical_rooms SET minibar_package_id = ? WHERE id = ?', args: [targetPackageId, req.params.id] });
    }

    const existing = await db.execute({ sql: 'SELECT id FROM room_minibar_stock WHERE physical_room_id = ? LIMIT 1', args: [req.params.id] });
    if (existing.rows.length && !force) {
      return res.status(400).json({ error: 'Room already has tracked stock — pass force to reset it to the package levels.' });
    }

    const items = await db.execute({
      sql: `SELECT mpi.minibar_item_id, mpi.quantity, mi.price FROM minibar_package_items mpi JOIN minibar_items mi ON mi.id = mpi.minibar_item_id WHERE mpi.package_id = ?`,
      args: [targetPackageId]
    });

    for (const item of items.rows) {
      await db.execute({
        sql: `
          INSERT INTO room_minibar_stock (physical_room_id, minibar_item_id, opening_stock, current_stock)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(physical_room_id, minibar_item_id) DO UPDATE SET
            opening_stock = excluded.opening_stock, current_stock = excluded.current_stock, updated_at = datetime('now')
        `,
        args: [req.params.id, item.minibar_item_id, item.quantity, item.quantity]
      });
      await db.execute({
        sql: `INSERT INTO minibar_room_log (physical_room_id, minibar_item_id, action, quantity, unit_price, staff_username, note) VALUES (?, ?, 'init', ?, ?, ?, ?)`,
        args: [req.params.id, item.minibar_item_id, item.quantity, item.price, req.user.username, force ? 'Manually reset to package levels' : 'Manually initialized']
      });
    }

    res.json({ initialized: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to initialize room' });
  }
});

// POS action: guest takes an item from the room's mini bar.
router.post('/rooms/:id/consume', async (req, res) => {
  try {
    const { itemId, quantity } = req.body;
    const qty = Number(quantity);
    if (!itemId || !qty || qty <= 0) return res.status(400).json({ error: 'itemId and a positive quantity are required' });

    const roomResult = await db.execute({ sql: 'SELECT * FROM physical_rooms WHERE id = ?', args: [req.params.id] });
    const room = roomResult.rows[0];
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const stockResult = await db.execute({ sql: 'SELECT * FROM room_minibar_stock WHERE physical_room_id = ? AND minibar_item_id = ?', args: [req.params.id, itemId] });
    const stock = stockResult.rows[0];
    if (!stock || Number(stock.current_stock) < qty) {
      return res.status(400).json({ error: `Only ${stock ? stock.current_stock : 0} left in this room` });
    }

    const bookingResult = await db.execute({
      sql: `SELECT * FROM bookings WHERE physical_room_id = ? AND status = 'checked_in' ORDER BY created_at DESC LIMIT 1`,
      args: [req.params.id]
    });
    const booking = bookingResult.rows[0];
    if (!booking) return res.status(400).json({ error: 'No guest currently checked in to this room — cannot bill a charge' });
    assertBookingUnlocked(booking);

    const itemResult = await db.execute({ sql: 'SELECT * FROM minibar_items WHERE id = ?', args: [itemId] });
    const item = itemResult.rows[0];

    await db.execute({
      sql: `UPDATE room_minibar_stock SET current_stock = current_stock - ?, updated_at = datetime('now') WHERE physical_room_id = ? AND minibar_item_id = ?`,
      args: [qty, req.params.id, itemId]
    });
    await db.execute({
      sql: "INSERT INTO booking_charges (booking_id, description, amount, category) VALUES (?, ?, ?, 'amenity')",
      args: [booking.id, `Mini Bar (Room ${room.room_number}): ${item.name} x${qty}`, item.price * qty]
    });
    await db.execute({
      sql: `INSERT INTO minibar_room_log (physical_room_id, minibar_item_id, booking_id, action, quantity, unit_price, charged_booking_id, staff_username) VALUES (?, ?, ?, 'consume', ?, ?, ?, ?)`,
      args: [req.params.id, itemId, booking.id, -qty, item.price, booking.id, req.user.username]
    });
    const updatedBooking = await recomputeBookingTotal(booking.id);

    res.json({ charged: true, amount: item.price * qty, booking: updatedBooking });
  } catch (err) {
    if (err instanceof BookingLockedError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to record mini bar charge' });
  }
});

// Top up a room's stock, drawing from the central store.
router.post('/rooms/:id/refill', async (req, res) => {
  try {
    const { itemId, quantity } = req.body;
    const qty = Number(quantity);
    if (!itemId || !qty || qty <= 0) return res.status(400).json({ error: 'itemId and a positive quantity are required' });

    const itemResult = await db.execute({ sql: 'SELECT * FROM minibar_items WHERE id = ?', args: [itemId] });
    const item = itemResult.rows[0];
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (Number(item.stock_quantity) < qty) return res.status(400).json({ error: `Only ${item.stock_quantity} left in the central store` });

    await db.execute({ sql: 'UPDATE minibar_items SET stock_quantity = stock_quantity - ? WHERE id = ?', args: [qty, itemId] });
    await db.execute({
      sql: `
        INSERT INTO room_minibar_stock (physical_room_id, minibar_item_id, opening_stock, current_stock)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(physical_room_id, minibar_item_id) DO UPDATE SET current_stock = current_stock + ?, updated_at = datetime('now')
      `,
      args: [req.params.id, itemId, qty, qty]
    });
    await db.execute({
      sql: `INSERT INTO minibar_room_log (physical_room_id, minibar_item_id, action, quantity, unit_price, staff_username) VALUES (?, ?, 'refill', ?, ?, ?)`,
      args: [req.params.id, itemId, qty, item.price, req.user.username]
    });

    res.json({ refilled: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to refill room' });
  }
});

// Damage / missing item report — removes it from the room's tracked stock
// (it never returns to the central store) and can optionally bill the
// current guest a penalty.
router.post('/rooms/:id/damage', async (req, res) => {
  try {
    const { itemId, quantity, reason, type, penaltyAmount } = req.body;
    const qty = Number(quantity);
    const logAction = type === 'missing' ? 'missing' : 'damage';
    if (!itemId || !qty || qty <= 0) return res.status(400).json({ error: 'itemId and a positive quantity are required' });

    const roomResult = await db.execute({ sql: 'SELECT * FROM physical_rooms WHERE id = ?', args: [req.params.id] });
    const room = roomResult.rows[0];
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const stockResult = await db.execute({ sql: 'SELECT * FROM room_minibar_stock WHERE physical_room_id = ? AND minibar_item_id = ?', args: [req.params.id, itemId] });
    const currentStock = stockResult.rows[0] ? Number(stockResult.rows[0].current_stock) : 0;
    if (currentStock < qty) return res.status(400).json({ error: `Only ${currentStock} recorded in this room` });

    const itemResult = await db.execute({ sql: 'SELECT * FROM minibar_items WHERE id = ?', args: [itemId] });
    const item = itemResult.rows[0];

    await db.execute({
      sql: `UPDATE room_minibar_stock SET current_stock = current_stock - ?, updated_at = datetime('now') WHERE physical_room_id = ? AND minibar_item_id = ?`,
      args: [qty, req.params.id, itemId]
    });

    let chargedBookingId = null;
    const penalty = Number(penaltyAmount) || 0;
    if (penalty > 0) {
      const bookingResult = await db.execute({
        sql: `SELECT * FROM bookings WHERE physical_room_id = ? AND status = 'checked_in' ORDER BY created_at DESC LIMIT 1`,
        args: [req.params.id]
      });
      const booking = bookingResult.rows[0];
      if (booking) {
        assertBookingUnlocked(booking);
        await db.execute({
          sql: "INSERT INTO booking_charges (booking_id, description, amount, category) VALUES (?, ?, ?, 'other')",
          args: [booking.id, `Mini Bar ${logAction === 'missing' ? 'Missing' : 'Damage'} (Room ${room.room_number}): ${item.name} x${qty}`, penalty]
        });
        await recomputeBookingTotal(booking.id);
        chargedBookingId = booking.id;
      }
    }

    await db.execute({
      sql: `
        INSERT INTO minibar_room_log (physical_room_id, minibar_item_id, action, quantity, unit_price, penalty_amount, charged_booking_id, staff_username, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [req.params.id, itemId, logAction, -qty, item.price, penalty, chargedBookingId, req.user.username, reason || '']
    });

    res.json({ logged: true, chargedBookingId });
  } catch (err) {
    if (err instanceof BookingLockedError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to log damage/missing item' });
  }
});

// Simple, explainable heuristic (not a prediction model): suggest topping
// each item back up to whichever is larger — its package baseline, or
// enough for ~3 days at its recent average daily consumption rate.
router.get('/rooms/:id/suggestions', async (req, res) => {
  try {
    const stockResult = await db.execute({
      sql: `SELECT rms.*, mi.name, mi.price FROM room_minibar_stock rms JOIN minibar_items mi ON mi.id = rms.minibar_item_id WHERE rms.physical_room_id = ?`,
      args: [req.params.id]
    });
    const consumeResult = await db.execute({
      sql: `
        SELECT minibar_item_id, SUM(-quantity) AS totalConsumed, COUNT(DISTINCT date(created_at)) AS daysActive
        FROM minibar_room_log
        WHERE physical_room_id = ? AND action = 'consume' AND created_at >= datetime('now', '-30 days')
        GROUP BY minibar_item_id
      `,
      args: [req.params.id]
    });
    const consumeByItem = {};
    consumeResult.rows.forEach((r) => { consumeByItem[r.minibar_item_id] = r; });

    const suggestions = stockResult.rows.map((s) => {
      const usage = consumeByItem[s.minibar_item_id];
      const avgPerDay = usage && Number(usage.daysActive) ? Number(usage.totalConsumed) / Number(usage.daysActive) : 0;
      const targetLevel = Math.max(Number(s.opening_stock), Math.ceil(avgPerDay * 3));
      const suggestedQty = Math.max(0, targetLevel - Number(s.current_stock));
      return {
        minibarItemId: Number(s.minibar_item_id), name: s.name, currentStock: Number(s.current_stock),
        openingStock: Number(s.opening_stock), avgDailyConsumption: Math.round(avgPerDay * 10) / 10,
        suggestedRefillQty: suggestedQty
      };
    }).filter((s) => s.suggestedRefillQty > 0);

    res.json(suggestions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to compute refill suggestions' });
  }
});

/* ==================== Refill requests (housekeeping workflow) ==================== */

router.get('/refill-requests', async (req, res) => {
  try {
    const { status } = req.query;
    const result = status
      ? await db.execute({
          sql: `SELECT rr.*, pr.room_number FROM minibar_refill_requests rr JOIN physical_rooms pr ON pr.id = rr.physical_room_id WHERE rr.status = ? ORDER BY rr.created_at DESC`,
          args: [status]
        })
      : await db.execute(`SELECT rr.*, pr.room_number FROM minibar_refill_requests rr JOIN physical_rooms pr ON pr.id = rr.physical_room_id ORDER BY rr.created_at DESC`);
    res.json(result.rows.map(parseRefillRequest));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load refill requests' });
  }
});

router.post('/refill-requests', async (req, res) => {
  try {
    const { physicalRoomId, note } = req.body;
    if (!physicalRoomId) return res.status(400).json({ error: 'physicalRoomId is required' });
    const result = await db.execute({
      sql: 'INSERT INTO minibar_refill_requests (physical_room_id, requested_by, note) VALUES (?, ?, ?)',
      args: [physicalRoomId, req.user.username, note || '']
    });
    const created = await db.execute({
      sql: 'SELECT rr.*, pr.room_number FROM minibar_refill_requests rr JOIN physical_rooms pr ON pr.id = rr.physical_room_id WHERE rr.id = ?',
      args: [Number(result.lastInsertRowid)]
    });
    res.status(201).json(parseRefillRequest(created.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create refill request' });
  }
});

router.patch('/refill-requests/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['fulfilled', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be fulfilled or rejected' });
    const existing = await db.execute({ sql: 'SELECT * FROM minibar_refill_requests WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) return res.status(404).json({ error: 'Request not found' });
    await db.execute({
      sql: `UPDATE minibar_refill_requests SET status = ?, fulfilled_at = datetime('now'), fulfilled_by = ? WHERE id = ?`,
      args: [status, req.user.username, req.params.id]
    });
    const updated = await db.execute({
      sql: 'SELECT rr.*, pr.room_number FROM minibar_refill_requests rr JOIN physical_rooms pr ON pr.id = rr.physical_room_id WHERE rr.id = ?',
      args: [req.params.id]
    });
    res.json(parseRefillRequest(updated.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update refill request' });
  }
});

/* ==================== Analytics ==================== */

router.get('/analytics', async (req, res) => {
  try {
    let { from, to } = req.query;
    if (!from || !to) {
      to = new Date().toISOString().slice(0, 10);
      from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    const dailySales = await db.execute({
      sql: `
        SELECT date(created_at) AS day, SUM(-quantity * unit_price) AS revenue
        FROM minibar_room_log WHERE action = 'consume' AND date(created_at) BETWEEN ? AND ?
        GROUP BY day ORDER BY day ASC
      `,
      args: [from, to]
    });

    const monthlySalesRaw = await db.execute(`
      SELECT strftime('%Y-%m', created_at) AS month, SUM(-quantity * unit_price) AS revenue
      FROM minibar_room_log WHERE action = 'consume'
      GROUP BY month ORDER BY month DESC LIMIT 12
    `);

    const mostSold = await db.execute({
      sql: `
        SELECT mrl.minibar_item_id, mi.name, SUM(-mrl.quantity) AS totalQty, SUM(-mrl.quantity * mrl.unit_price) AS revenue
        FROM minibar_room_log mrl JOIN minibar_items mi ON mi.id = mrl.minibar_item_id
        WHERE mrl.action = 'consume' AND date(mrl.created_at) BETWEEN ? AND ?
        GROUP BY mrl.minibar_item_id ORDER BY totalQty DESC
      `,
      args: [from, to]
    });

    const margins = await db.execute(`
      SELECT mrl.minibar_item_id, mi.name, mi.price, mi.cost_price,
             SUM(-mrl.quantity) AS totalQty,
             SUM(-mrl.quantity * (mrl.unit_price - mi.cost_price)) AS totalProfit
      FROM minibar_room_log mrl JOIN minibar_items mi ON mi.id = mrl.minibar_item_id
      WHERE mrl.action = 'consume'
      GROUP BY mrl.minibar_item_id ORDER BY totalProfit DESC
    `);

    const damage = await db.execute(`
      SELECT action, COUNT(*) AS count, SUM(-quantity) AS totalQty, SUM(penalty_amount) AS totalPenalty
      FROM minibar_room_log WHERE action IN ('damage', 'missing') GROUP BY action
    `);

    res.json({
      range: { from, to },
      dailySales: dailySales.rows.map((r) => ({ day: r.day, revenue: Number(r.revenue) })),
      monthlySales: monthlySalesRaw.rows.map((r) => ({ month: r.month, revenue: Number(r.revenue) })).reverse(),
      mostSold: mostSold.rows.map((r) => ({ id: Number(r.minibar_item_id), name: r.name, quantity: Number(r.totalQty), revenue: Number(r.revenue) })),
      margins: margins.rows.map((r) => ({
        id: Number(r.minibar_item_id), name: r.name, price: Number(r.price), costPrice: Number(r.cost_price),
        quantitySold: Number(r.totalQty), totalProfit: Number(r.totalProfit)
      })),
      damage: damage.rows.map((r) => ({ action: r.action, count: Number(r.count), totalQty: Number(r.totalQty), totalPenalty: Number(r.totalPenalty) }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

module.exports = router;
