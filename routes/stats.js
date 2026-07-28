const express = require('express');
const { db } = require('../db');

const router = express.Router();

// Public, honest social-proof numbers — real counts, not invented stats.
router.get('/public', async (req, res) => {
  try {
    const guestsResult = await db.execute(
      "SELECT COUNT(*) AS n FROM bookings WHERE status IN ('checked_out', 'checked_in')"
    );
    const reviewsResult = await db.execute(
      "SELECT COUNT(*) AS n, COALESCE(AVG(rating), 0) AS avg_rating FROM reviews WHERE status = 'approved'"
    );
    const eventsResult = await db.execute(
      "SELECT COUNT(*) AS n FROM venue_bookings WHERE status IN ('confirmed', 'completed')"
    );

    res.json({
      guestsHosted: Number(guestsResult.rows[0].n),
      reviewCount: Number(reviewsResult.rows[0].n),
      averageRating: Math.round(Number(reviewsResult.rows[0].avg_rating) * 10) / 10,
      eventsHosted: Number(eventsResult.rows[0].n)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

module.exports = router;
