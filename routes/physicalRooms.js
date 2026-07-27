const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

const STATUSES = ['available', 'maintenance', 'inactive'];

router.use(adminAuth, requireRole('admin', 'staff'));

function parseRoom(row) {
  return {
    id: row.id,
    roomNumber: row.room_number,
    roomTypeId: row.room_type_id,
    roomTypeName: row.room_type_name,
    floor: row.floor,
    priceOverride: row.price_override === null || row.price_override === undefined ? null : Number(row.price_override),
    categoryPrice: row.category_price === undefined ? null : Number(row.category_price),
    amenities: JSON.parse(row.amenities || '[]'),
    status: row.status,
    createdAt: row.created_at
  };
}

// Registering (or reactivating) a physical room only ever grows a
// category's bookable capacity to match its real inventory — it never
// shrinks total_units automatically. Shrinking capacity is a deliberate
// business decision left to the existing admin Room Settings panel, not an
// automatic side-effect of a housekeeping-level room-inventory edit.
async function growTotalUnitsIfNeeded(roomTypeId) {
  const countResult = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM physical_rooms WHERE room_type_id = ? AND status != 'inactive'`,
    args: [roomTypeId]
  });
  const activeCount = Number(countResult.rows[0].n);
  const roomResult = await db.execute({ sql: 'SELECT total_units FROM rooms WHERE id = ?', args: [roomTypeId] });
  const room = roomResult.rows[0];
  if (room && activeCount > Number(room.total_units)) {
    await db.execute({ sql: 'UPDATE rooms SET total_units = ? WHERE id = ?', args: [activeCount, roomTypeId] });
  }
}

const LIST_SQL = `
  SELECT physical_rooms.*, rooms.name AS room_type_name, rooms.price AS category_price
  FROM physical_rooms
  JOIN rooms ON rooms.id = physical_rooms.room_type_id
  ORDER BY rooms.name ASC, physical_rooms.room_number ASC
`;

router.get('/', async (req, res) => {
  try {
    const result = await db.execute(LIST_SQL);
    res.json(result.rows.map(parseRoom));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load rooms' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { roomNumber, roomTypeId, floor, priceOverride, amenities, status } = req.body;

    if (!roomNumber || !String(roomNumber).trim()) {
      return res.status(400).json({ error: 'Room number is required' });
    }
    if (!roomTypeId) {
      return res.status(400).json({ error: 'Room category is required' });
    }
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}` });
    }
    if (amenities !== undefined && !Array.isArray(amenities)) {
      return res.status(400).json({ error: 'Amenities must be a list' });
    }

    const typeResult = await db.execute({ sql: 'SELECT id FROM rooms WHERE id = ?', args: [roomTypeId] });
    if (!typeResult.rows[0]) {
      return res.status(400).json({ error: 'Selected room category does not exist' });
    }

    const existing = await db.execute({ sql: 'SELECT id FROM physical_rooms WHERE room_number = ?', args: [String(roomNumber).trim()] });
    if (existing.rows[0]) {
      return res.status(409).json({ error: `Room number "${roomNumber}" already exists` });
    }

    const insertResult = await db.execute({
      sql: `
        INSERT INTO physical_rooms (room_number, room_type_id, floor, price_override, amenities, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [
        String(roomNumber).trim(), roomTypeId, floor || '',
        priceOverride === undefined || priceOverride === '' ? null : priceOverride,
        JSON.stringify(Array.isArray(amenities) ? amenities : []),
        status || 'available'
      ]
    });

    await growTotalUnitsIfNeeded(roomTypeId);

    const created = await db.execute({ sql: LIST_SQL.replace('ORDER BY', 'WHERE physical_rooms.id = ' + Number(insertResult.lastInsertRowid) + ' ORDER BY') });
    res.status(201).json(parseRoom(created.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { roomNumber, roomTypeId, floor, priceOverride, amenities, status } = req.body;

    const existing = await db.execute({ sql: 'SELECT * FROM physical_rooms WHERE id = ?', args: [req.params.id] });
    const room = existing.rows[0];
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}` });
    }
    if (amenities !== undefined && !Array.isArray(amenities)) {
      return res.status(400).json({ error: 'Amenities must be a list' });
    }
    if (roomTypeId !== undefined) {
      const typeResult = await db.execute({ sql: 'SELECT id FROM rooms WHERE id = ?', args: [roomTypeId] });
      if (!typeResult.rows[0]) {
        return res.status(400).json({ error: 'Selected room category does not exist' });
      }
    }
    if (roomNumber !== undefined) {
      if (!String(roomNumber).trim()) {
        return res.status(400).json({ error: 'Room number is required' });
      }
      const dupe = await db.execute({ sql: 'SELECT id FROM physical_rooms WHERE room_number = ? AND id != ?', args: [String(roomNumber).trim(), req.params.id] });
      if (dupe.rows[0]) {
        return res.status(409).json({ error: `Room number "${roomNumber}" already exists` });
      }
    }

    const updates = [];
    const args = [];
    if (roomNumber !== undefined) { updates.push('room_number = ?'); args.push(String(roomNumber).trim()); }
    if (roomTypeId !== undefined) { updates.push('room_type_id = ?'); args.push(roomTypeId); }
    if (floor !== undefined) { updates.push('floor = ?'); args.push(floor); }
    if (priceOverride !== undefined) { updates.push('price_override = ?'); args.push(priceOverride === '' ? null : priceOverride); }
    if (amenities !== undefined) { updates.push('amenities = ?'); args.push(JSON.stringify(amenities)); }
    if (status !== undefined) { updates.push('status = ?'); args.push(status); }

    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    args.push(req.params.id);
    await db.execute({ sql: `UPDATE physical_rooms SET ${updates.join(', ')} WHERE id = ?`, args });

    await growTotalUnitsIfNeeded(roomTypeId !== undefined ? roomTypeId : room.room_type_id);

    const updated = await db.execute({ sql: LIST_SQL.replace('ORDER BY', `WHERE physical_rooms.id = ${req.params.id} ORDER BY`) });
    res.json(parseRoom(updated.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update room' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT id FROM physical_rooms WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const bookingCount = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM bookings WHERE physical_room_id = ?', args: [req.params.id] });
    if (Number(bookingCount.rows[0].n) > 0) {
      return res.status(409).json({
        error: `Cannot delete — ${bookingCount.rows[0].n} booking(s) are linked to this room. Set it to Inactive instead to retire it without losing booking history.`
      });
    }
    await db.execute({ sql: 'DELETE FROM physical_rooms WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

module.exports = router;
