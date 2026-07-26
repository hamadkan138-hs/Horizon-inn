const express = require('express');
const db = require('../db');
const { isRoomAvailable } = require('../lib/availability');

const router = express.Router();

router.get('/', (req, res) => {
  const { checkin, checkout } = req.query;
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY price ASC').all();

  const result = rooms.map((room) => {
    const parsed = { ...room, features: JSON.parse(room.features), featured: !!room.featured };
    if (checkin && checkout) {
      parsed.available = isRoomAvailable(room, checkin, checkout);
    }
    return parsed;
  });

  res.json(result);
});

module.exports = router;
