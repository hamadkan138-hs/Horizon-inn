const express = require('express');
const { db } = require('../db');
const { isRoomAvailable } = require('../lib/availability');
const { effectivePrice } = require('../lib/pricing');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { checkin, checkout, guests } = req.query;
    const includeInactive = req.query.includeInactive === '1';
    const result = await db.execute(
      includeInactive
        ? 'SELECT * FROM rooms ORDER BY price ASC'
        : 'SELECT * FROM rooms WHERE active = 1 ORDER BY price ASC'
    );

    const rooms = await Promise.all(result.rows.map(async (room) => {
      const parsed = {
        ...room,
        features: JSON.parse(room.features),
        images: JSON.parse(room.images || '[]'),
        featured: !!room.featured,
        active: !!room.active
      };
      if (checkin) {
        parsed.price = await effectivePrice(room, checkin, guests);
      }
      if (checkin && checkout) {
        parsed.available = await isRoomAvailable(room, checkin, checkout);
      }
      return parsed;
    }));

    res.json(rooms);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load rooms' });
  }
});

// Live room status board (admin/staff) — Available / Occupied / Booked
// (advance paid & locked), each with the relevant date range so front desk
// can see at a glance which rooms are free without cross-referencing the
// bookings list.
router.get('/status-board', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const roomsResult = await db.execute('SELECT * FROM rooms WHERE active = 1 ORDER BY price ASC');
    const bookingsResult = await db.execute({
      sql: `
        SELECT bookings.*, COALESCE(p.paid, 0) AS paid_total
        FROM bookings
        LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = bookings.id
        WHERE bookings.status IN ('confirmed', 'checked_in') AND bookings.checkout > ?
        ORDER BY bookings.checkin ASC
      `,
      args: [today]
    });

    const board = roomsResult.rows.map((room) => {
      const roomBookings = bookingsResult.rows.filter((b) => b.room_id === room.id);
      const occupied = roomBookings.find((b) => b.status === 'checked_in' && b.checkin <= today && b.checkout > today);
      const booked = !occupied && roomBookings.find((b) => b.status === 'confirmed');

      let status = 'available';
      let current = null;
      if (occupied) {
        status = 'occupied';
        current = occupied;
      } else if (booked) {
        status = 'booked';
        current = booked;
      }

      return {
        id: room.id,
        name: room.name,
        status,
        booking: current ? {
          id: current.id,
          guestName: current.name,
          checkin: current.checkin,
          checkout: current.checkout,
          advancePaid: Number(current.paid_total) > 0,
          paidTotal: Number(current.paid_total)
        } : null
      };
    });

    res.json(board);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load room status board' });
  }
});

// Duty-staff room management dashboard: one card per room. Categories with
// physical rooms registered (see routes/physicalRooms.js) get a stable,
// persistently-numbered grid built straight from that table; categories
// with none yet fall back to synthesizing "Unit 1 / Unit 2" placeholder
// slots from total_units, exactly as before this feature existed, so
// nothing breaks for data that hasn't adopted physical-room management.
router.get('/dashboard', adminAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const roomsResult = await db.execute('SELECT * FROM rooms WHERE active = 1 ORDER BY price ASC');
    const physicalRoomsResult = await db.execute('SELECT * FROM physical_rooms ORDER BY room_number ASC');

    const bookingsResult = await db.execute({
      sql: `
        SELECT bookings.*, COALESCE(p.paid, 0) AS paid_total
        FROM bookings
        LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = bookings.id
        WHERE
          (bookings.status = 'checked_in' AND bookings.checkin <= ? AND bookings.checkout > ?)
          OR (bookings.status = 'confirmed' AND bookings.checkin <= ? AND bookings.checkout > ?)
          OR (bookings.status = 'checked_out' AND bookings.cleaning_status = 'pending')
        ORDER BY bookings.id ASC
      `,
      args: [today, today, today, today]
    });

    const toSlotBooking = (b) => ({
      id: b.id,
      guestName: b.name,
      phone: b.phone,
      cnic: b.cnic,
      invoiceNumber: b.invoice_number,
      checkin: b.checkin,
      checkout: b.checkout,
      createdAt: b.created_at,
      checkedOutAt: b.checked_out_at,
      totalAmount: Number(b.total_amount),
      paidTotal: Number(b.paid_total),
      paymentStatus: b.payment_status
    });

    const bookingStatus = (b) => (b.status === 'checked_in' ? 'occupied' : b.status === 'confirmed' ? 'reserved' : 'cleaning');

    const board = roomsResult.rows.map((room) => {
      const roomBookings = bookingsResult.rows.filter((b) => b.room_id === room.id);
      const physicalRooms = physicalRoomsResult.rows.filter((pr) => pr.room_type_id === room.id);

      let slots;
      if (physicalRooms.length) {
        slots = physicalRooms.map((pr) => {
          if (pr.status === 'maintenance' || pr.status === 'inactive') {
            return { status: pr.status, physicalRoomId: pr.id, roomNumber: pr.room_number, floor: pr.floor, booking: null };
          }
          const match = roomBookings.find((b) => b.physical_room_id === pr.id);
          return {
            status: match ? bookingStatus(match) : 'available',
            physicalRoomId: pr.id,
            roomNumber: pr.room_number,
            floor: pr.floor,
            booking: match ? toSlotBooking(match) : null
          };
        });

        // Bookings for this category that predate physical-room assignment
        // (or whose assigned room was since deleted/reassigned) still need a
        // card so an active stay never silently disappears from the board.
        const assignedIds = new Set(physicalRooms.map((pr) => pr.id));
        const orphaned = roomBookings.filter((b) => !b.physical_room_id || !assignedIds.has(b.physical_room_id));
        orphaned.forEach((b) => {
          slots.push({ status: bookingStatus(b), physicalRoomId: null, roomNumber: null, floor: null, booking: toSlotBooking(b) });
        });
      } else {
        const occupied = roomBookings.filter((b) => b.status === 'checked_in');
        const cleaning = roomBookings.filter((b) => b.status === 'checked_out');
        const reserved = roomBookings.filter((b) => b.status === 'confirmed');

        const totalUnits = Number(room.total_units) || 1;
        slots = [];
        occupied.forEach((b) => { if (slots.length < totalUnits) slots.push({ status: 'occupied', physicalRoomId: null, roomNumber: null, floor: null, booking: toSlotBooking(b) }); });
        cleaning.forEach((b) => { if (slots.length < totalUnits) slots.push({ status: 'cleaning', physicalRoomId: null, roomNumber: null, floor: null, booking: toSlotBooking(b) }); });
        reserved.forEach((b) => { if (slots.length < totalUnits) slots.push({ status: 'reserved', physicalRoomId: null, roomNumber: null, floor: null, booking: toSlotBooking(b) }); });
        while (slots.length < totalUnits) slots.push({ status: 'available', physicalRoomId: null, roomNumber: null, floor: null, booking: null });
      }

      return {
        id: room.id,
        slug: room.slug,
        name: room.name,
        price: room.price,
        totalUnits: Number(room.total_units) || 1,
        slots: slots.map((slot, index) => ({ unit: index + 1, ...slot }))
      };
    });

    res.json(board);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load room dashboard' });
  }
});

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'room';
}

async function uniqueSlug(name) {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  while (true) {
    const existing = await db.execute({ sql: 'SELECT id FROM rooms WHERE slug = ?', args: [slug] });
    if (!existing.rows[0]) return slug;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
}

// Create a new room type (admin only)
router.post('/', adminAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, description, price, price1p, price3p, totalUnits, featured, features, images } = req.body;
    if (!name || !description || price === undefined || price === '' || !totalUnits) {
      return res.status(400).json({ error: 'Name, description, price and total units are required' });
    }

    const slug = await uniqueSlug(name);
    const imagesList = Array.isArray(images) ? images : [];
    const gradient = imagesList.length
      ? `url('${imagesList[0].startsWith('/') ? imagesList[0] : '/images/' + imagesList[0]}') center/cover no-repeat`
      : 'linear-gradient(135deg, #2a2a2e, #14161f)';

    const result = await db.execute({
      sql: `
        INSERT INTO rooms (slug, name, description, price, price_1p, price_3p, features, images, gradient, total_units, featured, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      args: [
        slug, name, description, price,
        price1p === undefined || price1p === '' ? null : price1p,
        price3p === undefined || price3p === '' ? null : price3p,
        JSON.stringify(Array.isArray(features) ? features : []),
        JSON.stringify(imagesList),
        gradient, totalUnits, featured ? 1 : 0
      ]
    });

    const created = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [Number(result.lastInsertRowid)] });
    const room = created.rows[0];
    res.status(201).json({
      ...room,
      features: JSON.parse(room.features),
      images: JSON.parse(room.images || '[]'),
      featured: !!room.featured,
      active: !!room.active
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Update room settings (admin only)
router.patch('/:id', adminAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, description, price, price1p, price3p, totalUnits, featured, features, images, active } = req.body;

    const existing = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const updates = [];
    const args = [];
    if (name !== undefined) { updates.push('name = ?'); args.push(name); }
    if (description !== undefined) { updates.push('description = ?'); args.push(description); }
    if (price !== undefined) { updates.push('price = ?'); args.push(price); }
    if (price1p !== undefined) { updates.push('price_1p = ?'); args.push(price1p === '' ? null : price1p); }
    if (price3p !== undefined) { updates.push('price_3p = ?'); args.push(price3p === '' ? null : price3p); }
    if (totalUnits !== undefined) { updates.push('total_units = ?'); args.push(totalUnits); }
    if (featured !== undefined) { updates.push('featured = ?'); args.push(featured ? 1 : 0); }
    if (active !== undefined) { updates.push('active = ?'); args.push(active ? 1 : 0); }
    if (features !== undefined) { updates.push('features = ?'); args.push(JSON.stringify(features)); }
    if (images !== undefined) { updates.push('images = ?'); args.push(JSON.stringify(images)); }

    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    args.push(req.params.id);
    await db.execute({ sql: `UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`, args });

    const updated = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [req.params.id] });
    const room = updated.rows[0];
    res.json({
      ...room,
      features: JSON.parse(room.features),
      images: JSON.parse(room.images || '[]'),
      featured: !!room.featured,
      active: !!room.active
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update room' });
  }
});

// Delete a room (admin only) — blocked if bookings reference it, since that
// would orphan real booking/financial history. Deactivate instead in that case.
router.delete('/:id', adminAuth, requireRole('admin'), async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT id FROM rooms WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const bookingCount = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM bookings WHERE room_id = ?', args: [req.params.id] });
    if (Number(bookingCount.rows[0].n) > 0) {
      return res.status(409).json({
        error: `Cannot delete — ${bookingCount.rows[0].n} booking(s) reference this room. Deactivate it instead to hide it from the site.`
      });
    }
    await db.execute({ sql: 'DELETE FROM rooms WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

module.exports = router;
