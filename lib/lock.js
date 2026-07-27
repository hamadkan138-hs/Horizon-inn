// Once a booking is checked out it becomes part of the permanent financial
// record — no charge, payment, tax, note, or detail on it may change again,
// not even by an admin. This is the single place that rule is enforced so it
// can't be silently bypassed by a route that forgets to check.
class BookingLockedError extends Error {
  constructor(message) {
    super(message);
    this.status = 423; // HTTP 423 Locked
  }
}

function assertBookingUnlocked(booking) {
  if (booking.status === 'checked_out') {
    throw new BookingLockedError('This booking is checked out and locked for editing. Completed stays cannot be modified.');
  }
}

module.exports = { assertBookingUnlocked, BookingLockedError };
