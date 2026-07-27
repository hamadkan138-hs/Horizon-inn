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

// Rooms can define a lower/higher nightly rate for single or triple occupancy
// (price_1p / price_3p). room.price is always the base (2-guest) rate and is
// used whenever a tier isn't set for the requested guest count.
function basePriceForGuests(room, guests) {
  const count = Number(guests) || 2;
  if (count <= 1 && room.price_1p !== null && room.price_1p !== undefined) {
    return room.price_1p;
  }
  if (count >= 3 && room.price_3p !== null && room.price_3p !== undefined) {
    return room.price_3p;
  }
  return room.price;
}

async function effectivePrice(room, checkinDate, guests) {
  const basePrice = basePriceForGuests(room, guests);
  if (!checkinDate) return basePrice;

  const rule = await findActiveRateRule(room.id, checkinDate);
  if (!rule) return basePrice;

  if (rule.price_override !== null && rule.price_override !== undefined) {
    return rule.price_override;
  }
  if (rule.discount_percent !== null && rule.discount_percent !== undefined) {
    return Math.round(basePrice * (1 - rule.discount_percent / 100) * 100) / 100;
  }
  return basePrice;
}

function nightsBetween(checkin, checkout) {
  const ms = new Date(checkout).getTime() - new Date(checkin).getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

async function computeTotalAmount(room, checkin, checkout, guests) {
  const nightlyRate = await effectivePrice(room, checkin, guests);
  return nightlyRate * nightsBetween(checkin, checkout);
}

module.exports = { effectivePrice, nightsBetween, computeTotalAmount, findActiveRateRule };
