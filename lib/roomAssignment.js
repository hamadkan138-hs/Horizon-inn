const { db } = require('../db');

// Picks a specific physical room for a booking: the lowest-numbered available
// one of the right type that isn't already held by an overlapping booking.
//
// Best-effort by design — a room category with no physical rooms registered
// yet (or, rarely, none free because the registered-room count doesn't match
// the category's total_units) returns null, and the caller falls back to the
// room dashboard's synthesized-slot display rather than failing the booking.
//
// Shared by the staff front desk (POST /api/bookings/quick) and the guest
// self-service kiosk so both assign rooms by exactly the same rule — a guest
// checking themselves in must never be able to land on a room the front desk
// would have considered taken.
async function findAvailablePhysicalRoom(roomTypeId, checkin, checkout) {
  const result = await db.execute({
    sql: `
      SELECT pr.id FROM physical_rooms pr
      WHERE pr.room_type_id = ? AND pr.status = 'available'
        AND pr.id NOT IN (
          SELECT physical_room_id FROM bookings
          WHERE physical_room_id IS NOT NULL
            AND status != 'cancelled'
            AND NOT (checkout <= ? OR checkin >= ?)
        )
      ORDER BY pr.room_number ASC
      LIMIT 1
    `,
    args: [roomTypeId, checkin, checkout]
  });
  return result.rows[0] ? result.rows[0].id : null;
}

module.exports = { findAvailablePhysicalRoom };
