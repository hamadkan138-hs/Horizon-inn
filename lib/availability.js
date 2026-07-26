const db = require('../db');

// Two date ranges overlap unless one ends before the other begins.
function countOverlappingBookings(roomId, checkin, checkout, excludeBookingId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM bookings
    WHERE room_id = ?
      AND status != 'cancelled'
      AND NOT (checkout <= ? OR checkin >= ?)
      AND (? IS NULL OR id != ?)
  `).get(roomId, checkin, checkout, excludeBookingId ?? null, excludeBookingId ?? null);
  return row.n;
}

function isRoomAvailable(room, checkin, checkout) {
  return countOverlappingBookings(room.id, checkin, checkout) < room.total_units;
}

module.exports = { countOverlappingBookings, isRoomAvailable };
