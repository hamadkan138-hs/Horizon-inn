const { db } = require('../db');

// Two date ranges overlap unless one ends before the other begins.
async function countOverlappingBookings(roomId, checkin, checkout, excludeBookingId) {
  const result = await db.execute({
    sql: `
      SELECT COUNT(*) AS n FROM bookings
      WHERE room_id = ?
        AND status != 'cancelled'
        AND NOT (checkout <= ? OR checkin >= ?)
        AND (? IS NULL OR id != ?)
    `,
    args: [roomId, checkin, checkout, excludeBookingId ?? null, excludeBookingId ?? null]
  });
  return Number(result.rows[0].n);
}

async function isRoomAvailable(room, checkin, checkout) {
  const overlapping = await countOverlappingBookings(room.id, checkin, checkout);
  return overlapping < room.total_units;
}

module.exports = { countOverlappingBookings, isRoomAvailable };
