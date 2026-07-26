const { db } = require('../db');

// A rate rule applies when the check-in date falls within its date range.
// If multiple rules match, the most recently created one wins.
async function findActiveRateRule(roomId, checkinDate) {
  const result = await db.execute({
    sql: `
      SELECT * FROM rate_rules
      WHERE room_id = ? AND start_date <= ? AND end_date >= ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    args: [roomId, checkinDate, checkinDate]
  });
  return result.rows[0] || null;
}

async function effectivePrice(room, checkinDate) {
  if (!checkinDate) return room.price;

  const rule = await findActiveRateRule(room.id, checkinDate);
  if (!rule) return room.price;

  if (rule.price_override !== null && rule.price_override !== undefined) {
    return rule.price_override;
  }
  if (rule.discount_percent !== null && rule.discount_percent !== undefined) {
    return Math.round(room.price * (1 - rule.discount_percent / 100) * 100) / 100;
  }
  return room.price;
}

function nightsBetween(checkin, checkout) {
  const ms = new Date(checkout).getTime() - new Date(checkin).getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

async function computeTotalAmount(room, checkin, checkout) {
  const nightlyRate = await effectivePrice(room, checkin);
  return nightlyRate * nightsBetween(checkin, checkout);
}

module.exports = { effectivePrice, nightsBetween, computeTotalAmount, findActiveRateRule };
