const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

router.use(adminAuth, requireRole('admin', 'staff'));

// Aggregate the bookings table into a guest directory, grouped by CNIC/passport
// (falling back to email for the rare booking missing one) so repeat guests
// show a combined visit history instead of one row per stay.
router.get('/', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT
        COALESCE(NULLIF(cnic, ''), email) AS guest_key,
        cnic,
        name,
        email,
        phone,
        COUNT(*) AS visit_count,
        SUM(CASE WHEN status != 'cancelled' THEN total_amount ELSE 0 END) AS total_spent,
        MAX(checkout) AS last_stay,
        MIN(created_at) AS first_seen
      FROM bookings
      GROUP BY guest_key
      ORDER BY last_stay DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load guests' });
  }
});

// Full booking history for one guest (admin drill-down)
router.get('/:guestKey/bookings', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `
        SELECT bookings.*, rooms.name AS room_name
        FROM bookings
        JOIN rooms ON rooms.id = bookings.room_id
        WHERE COALESCE(NULLIF(cnic, ''), email) = ?
        ORDER BY checkin DESC
      `,
      args: [req.params.guestKey]
    });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load guest history' });
  }
});

module.exports = router;
