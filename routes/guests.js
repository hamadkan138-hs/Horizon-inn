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

// Front-desk lookup: given a CNIC, say whether the guest is known (with
// their last name/phone/address and visit count for a quick history glance)
// and whether they currently occupy a room (an active confirmed/checked-in
// booking), so the front desk screen can jump straight to check-in or
// check-out without the operator picking through the full bookings list.
router.get('/lookup', async (req, res) => {
  try {
    const cnic = (req.query.cnic || '').trim();
    if (!cnic) {
      return res.status(400).json({ error: 'CNIC is required' });
    }

    const historyResult = await db.execute({
      sql: `
        SELECT name, phone, address, COUNT(*) AS visit_count, MAX(checkout) AS last_stay
        FROM bookings
        WHERE cnic = ?
        GROUP BY cnic
        ORDER BY MAX(created_at) DESC
        LIMIT 1
      `,
      args: [cnic]
    });

    const activeResult = await db.execute({
      sql: `
        SELECT bookings.*, rooms.name AS room_name, physical_rooms.room_number AS physical_room_number,
               COALESCE(p.paid, 0) AS paid_total
        FROM bookings
        JOIN rooms ON rooms.id = bookings.room_id
        LEFT JOIN physical_rooms ON physical_rooms.id = bookings.physical_room_id
        LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = bookings.id
        WHERE bookings.cnic = ? AND bookings.status IN ('confirmed', 'checked_in')
        ORDER BY bookings.created_at DESC
        LIMIT 1
      `,
      args: [cnic]
    });

    const history = historyResult.rows[0] || null;
    const active = activeResult.rows[0] || null;

    res.json({
      cnic,
      found: !!history,
      name: history ? history.name : '',
      phone: history ? history.phone : '',
      address: history ? history.address : '',
      visitCount: history ? Number(history.visit_count) : 0,
      lastStay: history ? history.last_stay : null,
      activeBooking: active ? {
        id: active.id,
        roomId: active.room_id,
        roomName: active.room_name,
        roomNumber: active.room_number || active.physical_room_number || '',
        checkin: active.checkin,
        checkout: active.checkout,
        status: active.status,
        createdAt: active.created_at,
        totalAmount: Number(active.total_amount),
        paidTotal: Number(active.paid_total)
      } : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to look up guest' });
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
