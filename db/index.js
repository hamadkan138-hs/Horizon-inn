const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'horizon.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
  );

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
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const roomCount = db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n;
if (roomCount === 0) {
  const insertRoom = db.prepare(`
    INSERT INTO rooms (slug, name, description, price, features, gradient, total_units, featured)
    VALUES (@slug, @name, @description, @price, @features, @gradient, @total_units, @featured)
  `);
  const seedRooms = [
    {
      slug: 'deluxe-room',
      name: 'Deluxe Room',
      description: 'Spacious room with premium bedding and modern amenities.',
      price: 199,
      features: JSON.stringify(['King-size bed', 'Marble bathroom', 'City view balcony', 'Smart TV & streaming']),
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      total_units: 6,
      featured: 0
    },
    {
      slug: 'luxury-suite',
      name: 'Luxury Suite',
      description: 'Ultimate luxury with separate living area and panoramic views.',
      price: 349,
      features: JSON.stringify(['Separate living room', 'Jacuzzi bathtub', 'Panoramic view', 'Personal butler service']),
      gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      total_units: 4,
      featured: 1
    },
    {
      slug: 'presidential-suite',
      name: 'Presidential Suite',
      description: 'The pinnacle of luxury with exclusive amenities and services.',
      price: 599,
      features: JSON.stringify(['Multi-room layout', 'Private sauna', '360° panoramic view', '24/7 concierge service']),
      gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      total_units: 2,
      featured: 0
    }
  ];
  const insertMany = db.transaction((rooms) => {
    for (const room of rooms) insertRoom.run(room);
  });
  insertMany(seedRooms);
}

module.exports = db;
