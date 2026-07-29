const { db } = require('../db');

// Applies a physical room's assigned package (or Standard, if the room has
// none set) to seed its current stock — but ONLY the first time that room
// is ever tracked. A room that already has stock rows keeps them: real
// inventory reflects whatever housekeeping actually restocked, not a
// number this function invents on every check-in.
async function initRoomIfNeeded(physicalRoomId, actorUsername) {
  if (!physicalRoomId) return { initialized: false };

  const existing = await db.execute({
    sql: 'SELECT id FROM room_minibar_stock WHERE physical_room_id = ? LIMIT 1',
    args: [physicalRoomId]
  });
  if (existing.rows.length) return { initialized: false };

  const roomResult = await db.execute({ sql: 'SELECT * FROM physical_rooms WHERE id = ?', args: [physicalRoomId] });
  const room = roomResult.rows[0];
  if (!room) return { initialized: false };

  let packageId = room.minibar_package_id;
  if (!packageId) {
    const standard = await db.execute("SELECT id FROM minibar_packages WHERE name = 'Standard' LIMIT 1");
    packageId = standard.rows[0] ? Number(standard.rows[0].id) : null;
  }
  if (!packageId) return { initialized: false };

  const items = await db.execute({
    sql: `
      SELECT mpi.minibar_item_id, mpi.quantity, mi.price
      FROM minibar_package_items mpi
      JOIN minibar_items mi ON mi.id = mpi.minibar_item_id
      WHERE mpi.package_id = ?
    `,
    args: [packageId]
  });

  for (const item of items.rows) {
    await db.execute({
      sql: `
        INSERT INTO room_minibar_stock (physical_room_id, minibar_item_id, opening_stock, current_stock)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(physical_room_id, minibar_item_id) DO NOTHING
      `,
      args: [physicalRoomId, item.minibar_item_id, item.quantity, item.quantity]
    });
    await db.execute({
      sql: `
        INSERT INTO minibar_room_log (physical_room_id, minibar_item_id, action, quantity, unit_price, staff_username, note)
        VALUES (?, ?, 'init', ?, ?, ?, ?)
      `,
      args: [physicalRoomId, item.minibar_item_id, item.quantity, item.price, actorUsername || 'system', 'Auto-initialized at check-in']
    });
  }

  return { initialized: true, packageId };
}

module.exports = { initRoomIfNeeded };
