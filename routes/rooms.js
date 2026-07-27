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

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'room';
}

async function uniqueSlug(name) {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  while (true) {
    const existing = await db.execute({ sql: 'SELECT id FROM rooms WHERE slug = ?', args: [slug] });
    if (!existing.rows[0]) return slug;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
}

// Create a new room type (admin only)
router.post('/', adminAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, description, price, price1p, price3p, totalUnits, featured, features, images } = req.body;
    if (!name || !description || price === undefined || price === '' || !totalUnits) {
      return res.status(400).json({ error: 'Name, description, price and total units are required' });
    }

    const slug = await uniqueSlug(name);
    const imagesList = Array.isArray(images) ? images : [];
    const gradient = imagesList.length
      ? `url('${imagesList[0].startsWith('/') ? imagesList[0] : '/images/' + imagesList[0]}') center/cover no-repeat`
      : 'linear-gradient(135deg, #2a2a2e, #14161f)';

    const result = await db.execute({
      sql: `
        INSERT INTO rooms (slug, name, description, price, price_1p, price_3p, features, images, gradient, total_units, featured, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      args: [
        slug, name, description, price,
        price1p === undefined || price1p === '' ? null : price1p,
        price3p === undefined || price3p === '' ? null : price3p,
        JSON.stringify(Array.isArray(features) ? features : []),
        JSON.stringify(imagesList),
        gradient, totalUnits, featured ? 1 : 0
      ]
    });

    const created = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [Number(result.lastInsertRowid)] });
    const room = created.rows[0];
    res.status(201).json({
      ...room,
      features: JSON.parse(room.features),
      images: JSON.parse(room.images || '[]'),
      featured: !!room.featured,
      active: !!room.active
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create room' });
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

// Delete a room (admin only) — blocked if bookings reference it, since that
// would orphan real booking/financial history. Deactivate instead in that case.
router.delete('/:id', adminAuth, requireRole('admin'), async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT id FROM rooms WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const bookingCount = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM bookings WHERE room_id = ?', args: [req.params.id] });
    if (Number(bookingCount.rows[0].n) > 0) {
      return res.status(409).json({
        error: `Cannot delete — ${bookingCount.rows[0].n} booking(s) reference this room. Deactivate it instead to hide it from the site.`
      });
    }
    await db.execute({ sql: 'DELETE FROM rooms WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

module.exports = router;
