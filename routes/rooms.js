const express = require('express');
const { db } = require('../db');
const { isRoomAvailable } = require('../lib/availability');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { checkin, checkout } = req.query;
    const result = await db.execute('SELECT * FROM rooms ORDER BY price ASC');

    const rooms = await Promise.all(result.rows.map(async (room) => {
      const parsed = { ...room, features: JSON.parse(room.features), featured: !!room.featured };
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

module.exports = router;
