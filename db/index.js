const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

const DATABASE_URL = process.env.TURSO_DATABASE_URL
  || `file:${path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'horizon.db')}`;
const AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (DATABASE_URL.startsWith('file:')) {
  const dir = path.dirname(DATABASE_URL.slice('file:'.length));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const db = createClient(AUTH_TOKEN ? { url: DATABASE_URL, authToken: AUTH_TOKEN } : { url: DATABASE_URL });

function imageStyle(filename) {
  return `url('/images/${filename}') center/cover no-repeat`;
}

const SEED_ROOMS = [
  {
    slug: 'deluxe-room',
    name: 'Deluxe Room',
    description: 'Spacious room with premium bedding and modern amenities.',
    price: 199,
    features: JSON.stringify(['King-size bed', 'Marble bathroom', 'City view balcony', 'Smart TV & streaming']),
    gradient: imageStyle('deluxe-room.jpg'),
    total_units: 6,
    featured: 0
  },
  {
    slug: 'luxury-suite',
    name: 'Luxury Suite',
    description: 'Ultimate luxury with separate living area and panoramic views.',
    price: 349,
    features: JSON.stringify(['Separate living room', 'Jacuzzi bathtub', 'Panoramic view', 'Personal butler service']),
    gradient: imageStyle('luxury-suite.jpg'),
    total_units: 4,
    featured: 1
  },
  {
    slug: 'presidential-suite',
    name: 'Presidential Suite',
    description: 'The pinnacle of luxury with exclusive amenities and services.',
    price: 599,
    features: JSON.stringify(['Multi-room layout', 'Private sauna', '360° panoramic view', '24/7 concierge service']),
    gradient: imageStyle('presidential-suite.jpg'),
    total_units: 2,
    featured: 0
  }
];

let initPromise = null;

function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS rooms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          price INTEGER NOT NULL,
          features TEXT NOT NULL,
          gradient TEXT NOT NULL,
          total_units INTEGER NOT NULL DEFAULT 3,
          featured INTEGER NOT NULL DEFAULT 0
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS bookings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id INTEGER NOT NULL REFERENCES rooms(id),
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL,
          checkin TEXT NOT NULL,
          checkout TEXT NOT NULL,
          guests INTEGER NOT NULL,
          special_requests TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          cnic TEXT NOT NULL DEFAULT '',
          marital_status TEXT NOT NULL DEFAULT '',
          arrival_from TEXT NOT NULL DEFAULT '',
          departure_to TEXT NOT NULL DEFAULT '',
          arrival_time TEXT NOT NULL DEFAULT '',
          purpose_of_stay TEXT NOT NULL DEFAULT '',
          vehicle_number TEXT NOT NULL DEFAULT '',
          payment_method TEXT NOT NULL DEFAULT 'pay_at_property',
          transaction_id TEXT NOT NULL DEFAULT '',
          payment_status TEXT NOT NULL DEFAULT 'unpaid',
          terms_accepted INTEGER NOT NULL DEFAULT 0
        )
      `);

      // Bookings table existed before these columns were added in a later version.
      // ALTER TABLE ADD COLUMN is idempotent-safe here: each one either succeeds once
      // or fails with "duplicate column name" on repeat startups, which we ignore.
      const bookingColumns = [
        "cnic TEXT NOT NULL DEFAULT ''",
        "marital_status TEXT NOT NULL DEFAULT ''",
        "arrival_from TEXT NOT NULL DEFAULT ''",
        "departure_to TEXT NOT NULL DEFAULT ''",
        "arrival_time TEXT NOT NULL DEFAULT ''",
        "purpose_of_stay TEXT NOT NULL DEFAULT ''",
        "vehicle_number TEXT NOT NULL DEFAULT ''",
        "payment_method TEXT NOT NULL DEFAULT 'pay_at_property'",
        "transaction_id TEXT NOT NULL DEFAULT ''",
        "payment_status TEXT NOT NULL DEFAULT 'unpaid'",
        "terms_accepted INTEGER NOT NULL DEFAULT 0"
      ];
      for (const columnDef of bookingColumns) {
        try {
          await db.execute(`ALTER TABLE bookings ADD COLUMN ${columnDef}`);
        } catch (err) {
          if (!/duplicate column name/i.test(err.message)) throw err;
        }
      }

      await db.execute(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Upsert (not insert-only-if-empty) so a redeploy refreshes room copy/photos
      // in an already-seeded database without disturbing existing bookings, which
      // reference rooms by id and keep working since the id is preserved on conflict.
      for (const room of SEED_ROOMS) {
        await db.execute({
          sql: `
            INSERT INTO rooms (slug, name, description, price, features, gradient, total_units, featured)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              price = excluded.price,
              features = excluded.features,
              gradient = excluded.gradient,
              total_units = excluded.total_units,
              featured = excluded.featured
          `,
          args: [room.slug, room.name, room.description, room.price, room.features, room.gradient, room.total_units, room.featured]
        });
      }
    })();
  }
  return initPromise;
}

module.exports = { db, init };
