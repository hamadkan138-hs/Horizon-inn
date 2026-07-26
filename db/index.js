const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');

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

async function addColumnsIfMissing(table, columnDefs) {
  for (const columnDef of columnDefs) {
    try {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    } catch (err) {
      if (!/duplicate column name/i.test(err.message)) throw err;
    }
  }
}

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
          terms_accepted INTEGER NOT NULL DEFAULT 0,
          total_amount REAL NOT NULL DEFAULT 0,
          room_amount REAL NOT NULL DEFAULT 0,
          tax_percent REAL NOT NULL DEFAULT 0
        )
      `);

      // Additive migrations for columns introduced after the table already existed
      // in production. Each ALTER either succeeds once or fails harmlessly with
      // "duplicate column name" on repeat startups.
      await addColumnsIfMissing('bookings', [
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
        "terms_accepted INTEGER NOT NULL DEFAULT 0",
        "total_amount REAL NOT NULL DEFAULT 0",
        "room_amount REAL NOT NULL DEFAULT 0",
        "tax_percent REAL NOT NULL DEFAULT 0"
      ]);

      // One-time backfill: bookings created before room_amount existed still have
      // it at the column default (0). Their total_amount was the room charge in
      // full (no charges/tax existed yet), so that's the correct value to copy in.
      await db.execute(`
        UPDATE bookings SET room_amount = total_amount
        WHERE room_amount = 0 AND total_amount > 0
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS booking_charges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          booking_id INTEGER NOT NULL REFERENCES bookings(id),
          description TEXT NOT NULL,
          amount REAL NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          booking_id INTEGER NOT NULL REFERENCES bookings(id),
          amount REAL NOT NULL,
          method TEXT NOT NULL,
          transaction_id TEXT DEFAULT '',
          note TEXT DEFAULT '',
          recorded_by TEXT DEFAULT '',
          recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS rate_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id INTEGER NOT NULL REFERENCES rooms(id),
          name TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          price_override REAL,
          discount_percent REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          description TEXT DEFAULT '',
          amount REAL NOT NULL,
          expense_date TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'staff',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Seed rooms only if missing (by slug) — admin edits from the dashboard must
      // survive a restart/redeploy, so we no longer overwrite existing rows here.
      for (const room of SEED_ROOMS) {
        await db.execute({
          sql: `
            INSERT INTO rooms (slug, name, description, price, features, gradient, total_units, featured)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO NOTHING
          `,
          args: [room.slug, room.name, room.description, room.price, room.features, room.gradient, room.total_units, room.featured]
        });
      }

      // Seed the initial admin user from env vars so the login that already works
      // in production keeps working after this migration, with zero action needed.
      const userCountResult = await db.execute('SELECT COUNT(*) AS n FROM users');
      if (Number(userCountResult.rows[0].n) === 0) {
        const initialUser = process.env.ADMIN_USER || 'admin';
        const initialPass = process.env.ADMIN_PASSWORD || 'horizon2026';
        const hash = bcrypt.hashSync(initialPass, 10);
        await db.execute({
          sql: "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
          args: [initialUser, hash]
        });
      }
    })();
  }
  return initPromise;
}

module.exports = { db, init };
