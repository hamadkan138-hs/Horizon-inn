const express = require('express');
const { db } = require('../db');
const { isRoomAvailable } = require('../lib/availability');
const { effectivePrice } = require('../lib/pricing');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { checkin, checkout, guests } = req.query;
    const includeInactive = req.query.includeInactive === '1';
    const result = await db.execute(
      includeInactive
        ? 'SELECT * FROM rooms ORDER BY price ASC'
        : 'SELECT * FROM rooms WHERE active = 1 ORDER BY price ASC'
    );

    const rooms = await Promise.all(result.rows.map(async (room) => {
      const parsed = {
        ...room,
        features: JSON.parse(room.features),
        images: JSON.parse(room.images || '[]'),
        featured: !!room.featured,
        active: !!room.active
      };
      if (checkin) {
        parsed.price = await effectivePrice(room, checkin, guests);
      }
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

// Update room settings (admin only)
router.patch('/:id', adminAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, description, price, price1p, price3p, totalUnits, featured, features, images, active } = req.body;

    const existing = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const updates = [];
    const args = [];
    if (name !== undefined) { updates.push('name = ?'); args.push(name); }
    if (description !== undefined) { updates.push('description = ?'); args.push(description); }
    if (price !== undefined) { updates.push('price = ?'); args.push(price); }
    if (price1p !== undefined) { updates.push('price_1p = ?'); args.push(price1p === '' ? null : price1p); }
    if (price3p !== undefined) { updates.push('price_3p = ?'); args.push(price3p === '' ? null : price3p); }
    if (totalUnits !== undefined) { updates.push('total_units = ?'); args.push(totalUnits); }
    if (featured !== undefined) { updates.push('featured = ?'); args.push(featured ? 1 : 0); }
    if (active !== undefined) { updates.push('active = ?'); args.push(active ? 1 : 0); }
    if (features !== undefined) { updates.push('features = ?'); args.push(JSON.stringify(features)); }
    if (images !== undefined) { updates.push('images = ?'); args.push(JSON.stringify(images)); }

    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    args.push(req.params.id);
    await db.execute({ sql: `UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`, args });

    const updated = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [req.params.id] });
    const room = updated.rows[0];
    res.json({
      ...room,
      features: JSON.parse(room.features),
      images: JSON.parse(room.images || '[]'),
      featured: !!room.featured,
      active: !!room.active
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update room' });
  }
});

module.exports = router;
