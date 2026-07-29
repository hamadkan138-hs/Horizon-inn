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

const LEGACY_PLACEHOLDER_SLUGS = ['deluxe-room', 'luxury-suite', 'presidential-suite'];

const SEED_ROOMS = [
  {
    slug: 'deluxe-twin-room',
    name: 'Deluxe Twin Room',
    description: 'A bright, spacious room with two plush beds and a cozy lounge nook, framed by floor-to-ceiling curtained windows. Thoughtfully finished for a relaxed, home-like stay — whether you\'re travelling solo, as a couple, or with family.',
    price: 9500,
    price_1p: 9000,
    price_3p: 10000,
    features: JSON.stringify([
      'Complimentary breakfast for 2',
      'Inverter AC (heat & cool)',
      'High-speed WiFi',
      '75" LED TV',
      '1 complimentary laundry suit',
      'Extra mattress available on request'
    ]),
    images: JSON.stringify(['deluxe-twin-room-1.jpg']),
    gradient: imageStyle('deluxe-twin-room-1.jpg'),
    total_units: 2,
    featured: 0,
    active: 1
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
          featured INTEGER NOT NULL DEFAULT 0,
          price_1p INTEGER,
          price_3p INTEGER,
          images TEXT NOT NULL DEFAULT '[]',
          active INTEGER NOT NULL DEFAULT 1
        )
      `);

      await addColumnsIfMissing('rooms', [
        'price_1p INTEGER',
        'price_3p INTEGER',
        "images TEXT NOT NULL DEFAULT '[]'",
        'active INTEGER NOT NULL DEFAULT 1'
      ]);

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
          tax_percent REAL NOT NULL DEFAULT 0,
          invoice_number TEXT NOT NULL DEFAULT '',
          invoice_token TEXT NOT NULL DEFAULT '',
          room_number TEXT NOT NULL DEFAULT '',
          address TEXT NOT NULL DEFAULT '',
          invoice_notes TEXT NOT NULL DEFAULT ''
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
        "tax_percent REAL NOT NULL DEFAULT 0",
        "invoice_number TEXT NOT NULL DEFAULT ''",
        "invoice_token TEXT NOT NULL DEFAULT ''",
        "room_number TEXT NOT NULL DEFAULT ''",
        "address TEXT NOT NULL DEFAULT ''",
        "invoice_notes TEXT NOT NULL DEFAULT ''"
      ]);

      // One-time backfill: bookings created before room_amount existed still have
      // it at the column default (0). Their total_amount was the room charge in
      // full (no charges/tax existed yet), so that's the correct value to copy in.
      await db.execute(`
        UPDATE bookings SET room_amount = total_amount
        WHERE room_amount = 0 AND total_amount > 0
      `);

      // Backfill invoice numbers/tokens for bookings created before invoicing existed.
      await db.execute(`
        UPDATE bookings
        SET invoice_number = 'INV-' || strftime('%Y', created_at) || '-' || substr('0000' || id, -4, 4)
        WHERE invoice_number = ''
      `);
      await db.execute(`
        UPDATE bookings SET invoice_token = lower(hex(randomblob(12)))
        WHERE invoice_token = ''
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

      // Simple key/value store for admin-editable site content (hero text, offers,
      // policies, contact details) so those no longer require a code change.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Uploaded images stored directly in the database (base64) rather than on local
      // disk, because Render's free-tier filesystem is ephemeral and would lose any
      // uploaded photo on the next deploy/restart. Fine at guest-house scale.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS media (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          data TEXT NOT NULL,
          size INTEGER NOT NULL,
          category TEXT NOT NULL DEFAULT 'general',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // A cash handover sweeps every checked-out booking and every expense that
      // hasn't already been claimed by an earlier handover, snapshots the totals,
      // and stamps handover_id onto each of them. Once stamped, those rows are
      // permanently excluded from every future handover's totals — that's what
      // makes a handover an immutable, one-way ledger entry.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS handovers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          receiver_type TEXT NOT NULL,
          receiver_name TEXT NOT NULL DEFAULT '',
          staff_name TEXT NOT NULL,
          cash_total REAL NOT NULL DEFAULT 0,
          bank_total REAL NOT NULL DEFAULT 0,
          online_total REAL NOT NULL DEFAULT 0,
          expenses_total REAL NOT NULL DEFAULT 0,
          net_cash_handed REAL NOT NULL DEFAULT 0,
          booking_count INTEGER NOT NULL DEFAULT 0,
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      await addColumnsIfMissing('bookings', ['handover_id INTEGER']);
      await addColumnsIfMissing('expenses', ['handover_id INTEGER']);

      // Exact moment checkout completed — the "payment timestamp" shown on
      // invoices, stored in UTC (like every other timestamp in this app) and
      // converted to Pakistan Standard Time only at display time.
      await addColumnsIfMissing('bookings', ['checked_out_at TEXT']);

      // Lightweight housekeeping flag: set to 'pending' the moment a stay is
      // checked out (the room needs cleaning before it can be shown as
      // available again), cleared once staff mark the room clean. Purely
      // operational — never touches the financial record, so it stays
      // writable even after the booking itself is locked by checkout.
      await addColumnsIfMissing('bookings', ["cleaning_status TEXT NOT NULL DEFAULT ''"]);

      // Individual numbered physical rooms, layered on top of the existing
      // room-type (category) model rather than replacing it. A category's
      // price/features/total_units still drive pricing and availability
      // exactly as before — physical_rooms exist so duty staff can manage a
      // real inventory (room number, floor, status) and so the dashboard can
      // show a stable, persistently-numbered grid instead of synthesizing
      // "Unit 1 / Unit 2" placeholders each request.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS physical_rooms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_number TEXT UNIQUE NOT NULL,
          room_type_id INTEGER NOT NULL REFERENCES rooms(id),
          floor TEXT NOT NULL DEFAULT '',
          price_override REAL,
          amenities TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'available',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Which specific physical room a booking occupies, when one was
      // assigned (front-desk / quick-assign flows assign one automatically
      // if the category has physical rooms registered; nullable so bookings
      // made before this feature, or for categories with no physical rooms
      // yet, keep working exactly as before).
      await addColumnsIfMissing('bookings', ['physical_room_id INTEGER']);

      // Lets the investor dashboard split income into Room Bookings vs
      // Amenities (barbecue, bonfire, etc.) vs Event Rentals instead of one
      // undifferentiated "extra charges" bucket. Existing rows default to
      // 'other' rather than guessing a category for historical data.
      await addColumnsIfMissing('booking_charges', ["category TEXT NOT NULL DEFAULT 'other'"]);
      await addColumnsIfMissing('bookings', ['cancellation_requested_at TEXT']);

      const DEFAULT_SETTINGS = {
        hero_eyebrow: 'Est. 2026 · Boutique Hospitality',
        hero_heading: 'Welcome to Horizon Inn',
        hero_subtext: 'Experience luxury and tranquility like never before',
        offers_enabled: '0',
        offers_text: '',
        policies_text: [
          'Check-in / Check-out: Check-in from 2:00 PM, check-out by 12:00 PM. Early check-in or late check-out is subject to availability.',
          'Identification: A valid CNIC or passport matching the booking details is required from every guest at check-in.',
          'Cancellation Policy: Cancellations made 24 hours or more before check-in are fully refundable. Cancellations within 24 hours, or no-shows, are non-refundable.',
          'Damage Policy: Guests are responsible for any damage to the room or property beyond normal wear and tear, and will be charged for repair or replacement.',
          'House Rules: No smoking indoors. Quiet hours are from 11:00 PM to 7:00 AM. Only registered guests are permitted in guest rooms. Pets are not allowed unless pre-approved.'
        ].join('\n\n'),
        contact_address: 'Abdara Road, University Town, Peshawar, Pakistan (Near Doctor Habib Aesthetics Hospital)',
        contact_phone: '0333 3564462',
        contact_email: 'horizoninn55@gmail.com',
        contact_hours: '24/7 — Front Desk & Guest Support Available',
        contact_map_embed: 'https://www.google.com/maps?q=Horizon+inn,+center,+Abdara+Rd,+Town,+Peshawar,+44000&output=embed',
        contact_map_link: 'https://maps.app.goo.gl/TRSYxnbcatfw5N9W6',
        contact_facebook: 'https://www.facebook.com/share/1LurheLi14/?mibextid=wwXIfr',
        payment_bank_title: 'Horizon Inn',
        payment_bank_name: 'Habib Metropolitan Bank',
        payment_bank_account: '6042420311714123136',
        payment_bank_iban: 'PK37MPBL0424027140123136',
        payment_bank_branch: 'Abdara Road',
        payment_easypaisa_title: 'Hamad Ullah',
        payment_easypaisa_number: '0333 3564462',
        payment_jazzcash_title: '',
        payment_jazzcash_number: '',
        // Total owner/investor capital invested in the property. Used only
        // to compute the ROI figure on the investor dashboard — deliberately
        // excluded from the public GET /api/settings response (see
        // routes/settings.js) since, unlike contact/payment info, it has no
        // reason to ever be visible to an unauthenticated site visitor.
        investor_capital_invested: ''
      };
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        await db.execute({
          sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
          args: [key, value]
        });
      }

      // ---------------------------------------------------------------
      // Investor accounts (fractional ownership tracking) — layered on
      // top of the existing users/investor role rather than replacing it.
      // A users row with role='investor' still handles login; this table
      // holds the business data specific to being an investor (capital,
      // compliance flags, lockup terms) a login row alone can't carry.
      // ---------------------------------------------------------------
      await db.execute(`
        CREATE TABLE IF NOT EXISTS investors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
          investor_code TEXT UNIQUE NOT NULL,
          capital_invested REAL NOT NULL DEFAULT 0,
          spa_status TEXT NOT NULL DEFAULT 'pending',
          accredited_status TEXT NOT NULL DEFAULT 'pending',
          aml_kyc_status TEXT NOT NULL DEFAULT 'pending',
          lockup_months INTEGER NOT NULL DEFAULT 6,
          lockup_start_date TEXT NOT NULL DEFAULT (date('now')),
          dividend_turnaround_hours INTEGER NOT NULL DEFAULT 24,
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // A history of valuation figures, not just one current number — the
      // "asset growth trend" chart needs multiple points over time, and
      // every change stays auditable rather than overwriting the only
      // record of what the property was valued at last quarter.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS valuation_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          amount REAL NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          set_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Dividend/capital withdrawals are requests, not automated transfers
      // — this app has no payment-disbursement integration. An admin marks
      // a request completed only after actually paying the investor
      // outside this system, the same way every other payment here is a
      // manual record of money that already moved.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS withdrawal_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          investor_id INTEGER NOT NULL REFERENCES investors(id),
          type TEXT NOT NULL,
          amount REAL NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          requested_at TEXT NOT NULL DEFAULT (datetime('now')),
          processed_at TEXT,
          processed_by TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT ''
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS investment_projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          location TEXT NOT NULL DEFAULT '',
          target_capital REAL NOT NULL DEFAULT 0,
          timeline TEXT NOT NULL DEFAULT '',
          growth_potential TEXT NOT NULL DEFAULT '',
          images TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'planned',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Crescent Grove Event & Hospitality Complex — bookable spaces (Lawn & Fire Pit,
      // Meeting Hall, Cafe & Lounge, Full Complex Buyout) are day-rate rentals, not
      // per-night room stays, so they get their own table rather than being forced
      // into `rooms`' per-night/per-unit-pool model.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS venues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          size_sqft INTEGER NOT NULL DEFAULT 0,
          base_day_rate REAL NOT NULL DEFAULT 0,
          is_buyout INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1
        )
      `);
      await addColumnsIfMissing('venues', [
        "amenities TEXT NOT NULL DEFAULT '[]'",
        'capacity INTEGER NOT NULL DEFAULT 0',
        "images TEXT NOT NULL DEFAULT '[]'"
      ]);

      // Public-facing catering add-ons shown in each facility's detail view —
      // shared across venues rather than per-venue, since the same menu applies
      // to any space (events pick items regardless of which room they booked).
      await db.execute(`
        CREATE TABLE IF NOT EXISTS catering_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          price REAL NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1
        )
      `);

      // Prospective-investor leads captured from the public site's "Become a
      // Partner" CTA — a sales queue, deliberately separate from `investors`
      // (real onboarded accounts with login access, capital ledgers, etc).
      await db.execute(`
        CREATE TABLE IF NOT EXISTS investor_leads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          phone TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          location TEXT NOT NULL DEFAULT '',
          investment_tier TEXT NOT NULL DEFAULT '',
          investment_type TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'new_lead',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await addColumnsIfMissing('investor_leads', ['converted_investor_id INTEGER']);

      // Guest reviews — 'site' reviews are guest-submitted and start 'pending'
      // until an admin approves them; 'google'/'tripadvisor' entries are
      // manually added by an admin from real external reviews and are
      // inserted already 'approved', since they were already public elsewhere.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guest_name TEXT NOT NULL,
          rating INTEGER NOT NULL,
          comment TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'site',
          status TEXT NOT NULL DEFAULT 'pending',
          booking_id INTEGER REFERENCES bookings(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Sales/growth features: a single reusable "code" applied at hotel
      // checkout can resolve to a promo code, a gift voucher, or another
      // guest's referral code — kept as separate tables since they mean
      // different things (a % discount vs. real prepaid money vs. crediting
      // a specific past guest), but all checked from the same booking field.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS promo_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT UNIQUE NOT NULL,
          discount_percent REAL NOT NULL,
          max_uses INTEGER,
          used_count INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          expires_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS gift_vouchers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT UNIQUE NOT NULL,
          amount REAL NOT NULL,
          purchaser_name TEXT NOT NULL DEFAULT '',
          purchaser_email TEXT NOT NULL DEFAULT '',
          purchaser_phone TEXT NOT NULL DEFAULT '',
          recipient_name TEXT NOT NULL DEFAULT '',
          payment_method TEXT NOT NULL DEFAULT 'cash',
          transaction_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending_payment',
          redeemed_booking_id INTEGER REFERENCES bookings(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          activated_at TEXT,
          redeemed_at TEXT,
          expires_at TEXT
        )
      `);

      await addColumnsIfMissing('bookings', ['referral_code TEXT', 'referred_by_code TEXT']);

      // Corporate/B2B accounts for repeat Crescent Grove clients (companies
      // booking the Meeting Hall regularly) — saved terms so each booking
      // doesn't need re-negotiating, distinct from a one-off event guest.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS corporate_accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_name TEXT NOT NULL,
          contact_person TEXT NOT NULL DEFAULT '',
          contact_email TEXT NOT NULL DEFAULT '',
          contact_phone TEXT NOT NULL DEFAULT '',
          billing_terms TEXT NOT NULL DEFAULT 'due_on_receipt',
          agreed_discount_percent REAL NOT NULL DEFAULT 0,
          notes TEXT NOT NULL DEFAULT '',
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      // Captures a still-interested visitor (name/email/phone typed into the
      // booking form) before they necessarily finish booking, so staff can
      // follow up on genuine drop-off instead of losing that lead entirely.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS abandoned_bookings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          room_id INTEGER REFERENCES rooms(id),
          checkin TEXT,
          checkout TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Append-only trail of every booking status change — who changed it,
      // from what, to what, and (for cancellations) why. Never updated or
      // deleted, only inserted, same as the handover ledger.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS booking_status_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          booking_id INTEGER NOT NULL REFERENCES bookings(id),
          from_status TEXT NOT NULL,
          to_status TEXT NOT NULL,
          changed_by TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL DEFAULT '',
          changed_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS venue_bookings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          venue_id INTEGER NOT NULL REFERENCES venues(id),
          customer_name TEXT NOT NULL,
          customer_phone TEXT NOT NULL DEFAULT '',
          customer_email TEXT NOT NULL DEFAULT '',
          event_date TEXT NOT NULL,
          event_type TEXT NOT NULL DEFAULT '',
          guest_count INTEGER NOT NULL DEFAULT 0,
          base_rate REAL NOT NULL DEFAULT 0,
          line_items TEXT NOT NULL DEFAULT '[]',
          security_deposit REAL NOT NULL DEFAULT 0,
          discount_amount REAL NOT NULL DEFAULT 0,
          gst_percent REAL NOT NULL DEFAULT 0,
          gst_amount REAL NOT NULL DEFAULT 0,
          total_amount REAL NOT NULL DEFAULT 0,
          payment_method TEXT NOT NULL DEFAULT 'cash',
          transaction_id TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending_cash',
          booking_code TEXT UNIQUE NOT NULL,
          notes TEXT DEFAULT '',
          created_by TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          verified_by TEXT DEFAULT '',
          verified_at TEXT
        )
      `);

      // Lets investor reports split event-complex operating costs out from the
      // hotel's own expenses. NULL (the existing default) means unchanged, existing
      // hotel-side behavior; only rows explicitly tagged count toward venue P&L.
      await addColumnsIfMissing('expenses', ['venue_id INTEGER']);
      await addColumnsIfMissing('venue_bookings', ['corporate_account_id INTEGER']);

      const SEED_VENUES = [
        {
          slug: 'lawn-firepit', name: 'Outdoor Lawn & Fire Pit Courtyard',
          description: 'Private events, bonfires, and party bookings on the outdoor lawn with fire pit.',
          size_sqft: 2178, base_day_rate: 40000, is_buyout: 0, capacity: 80,
          amenities: ['Stone Fire Pit', 'Canopy Sail Shade', 'Ambient String Lighting', 'Lounge Seating', 'Firewood Service', 'Outdoor Sound System']
        },
        {
          slug: 'meeting-hall', name: 'Executive Meeting Hall',
          description: 'Corporate meetings, workshops, and presentations.',
          size_sqft: 600, base_day_rate: 25000, is_buyout: 0, capacity: 20,
          amenities: ['Smart A/V & Projector', 'High-Speed Wi-Fi', 'Conference Seating for 12', 'Glass-Walled Privacy', 'Climate Control', 'Whiteboard & Flipchart']
        },
        {
          slug: 'cafe-lounge', name: 'Crescent Grove Cafe & Lounge',
          description: 'Daily dining, coffee, and event catering space.',
          size_sqft: 760, base_day_rate: 30000, is_buyout: 0, capacity: 40,
          amenities: ['Espresso Bar', 'Ambient String Lighting', 'Lounge & Table Seating', 'High-Speed Wi-Fi', 'Dedicated Bar Staff']
        },
        {
          slug: 'full-complex', name: 'Full Complex Buyout',
          description: 'Exclusive whole-facility day/evening rental.',
          size_sqft: 3538, base_day_rate: 75000, is_buyout: 1, capacity: 140,
          amenities: ['All Facility Amenities Included', 'Dedicated Event Manager', 'Dedicated Valet', 'Priority Catering Slots', 'Full Venue Exclusivity']
        }
      ];
      for (const v of SEED_VENUES) {
        await db.execute({
          sql: `
            INSERT INTO venues (slug, name, description, size_sqft, base_day_rate, is_buyout, capacity, amenities)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO NOTHING
          `,
          args: [v.slug, v.name, v.description, v.size_sqft, v.base_day_rate, v.is_buyout, v.capacity, JSON.stringify(v.amenities)]
        });
        // Backfill amenities/capacity on venues that already existed before this
        // migration (created with the old, narrower schema) — only touches rows
        // still at the untouched default, never overwrites an admin's own edits.
        await db.execute({
          sql: `UPDATE venues SET capacity = ?, amenities = ? WHERE slug = ? AND capacity = 0 AND amenities = '[]'`,
          args: [v.capacity, JSON.stringify(v.amenities), v.slug]
        });
      }

      const CATERING_ITEMS = [
        { category: 'platters', name: 'Continental Platter', description: 'Assorted sandwiches, wraps, and finger food for up to 10 guests.', price: 6500 },
        { category: 'platters', name: 'Live BBQ Add-On', description: 'Grilled seekh kebab, chicken tikka, and boti, served live at your event.', price: 950 },
        { category: 'high_tea', name: 'Classic High Tea', description: 'Assorted pastries, samosas, and tea/coffee service for up to 10 guests.', price: 5500 },
        { category: 'high_tea', name: 'Premium High Tea', description: 'Classic High Tea plus scones, cakes, and a mocktail selection.', price: 8500 },
        { category: 'espresso_bar', name: 'Espresso Bar (per guest)', description: 'Barista-served espresso, cappuccino, and latte for the duration of your event.', price: 450 },
        { category: 'espresso_bar', name: 'Specialty Coffee Add-On (per guest)', description: 'Adds cold brew and flavored syrups to the Espresso Bar package.', price: 200 }
      ];
      for (const item of CATERING_ITEMS) {
        const existing = await db.execute({ sql: 'SELECT id FROM catering_items WHERE name = ?', args: [item.name] });
        if (!existing.rows[0]) {
          await db.execute({
            sql: 'INSERT INTO catering_items (category, name, description, price) VALUES (?, ?, ?, ?)',
            args: [item.category, item.name, item.description, item.price]
          });
        }
      }

      // Default exit-intent promo code, so that feature works without extra
      // manual setup — admin can deactivate/replace it from the Promo Codes tab.
      await db.execute({
        sql: 'INSERT INTO promo_codes (code, discount_percent) VALUES (?, ?) ON CONFLICT(code) DO NOTHING',
        args: ['WELCOME5', 5]
      });

      // In-room mini bar inventory. Consuming an item both decrements stock
      // and adds a billed charge to the guest's booking (see routes/minibar.js),
      // so the count here stays a real reflection of what's left, not just a
      // manual tally disconnected from what guests were actually charged for.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS minibar_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          price REAL NOT NULL,
          stock_quantity INTEGER NOT NULL DEFAULT 0,
          low_stock_threshold INTEGER NOT NULL DEFAULT 5,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      const minibarSeed = [
        ['Mineral Water (500ml)', 100, 30],
        ['Coca-Cola (Can)', 150, 24],
        ['Sprite (Can)', 150, 24],
        ["Lay's Chips", 200, 20],
        ['Kit Kat', 180, 20]
      ];
      for (const [name, price, stock] of minibarSeed) {
        const existing = await db.execute({ sql: 'SELECT id FROM minibar_items WHERE name = ?', args: [name] });
        if (!existing.rows.length) {
          await db.execute({
            sql: 'INSERT INTO minibar_items (name, price, stock_quantity) VALUES (?, ?, ?)',
            args: [name, price, stock]
          });
        }
      }
      // Cost price for margin reporting — a rough 55% of retail as a starting
      // estimate; admin should correct these to actual supplier cost.
      await addColumnsIfMissing('minibar_items', ['cost_price REAL NOT NULL DEFAULT 0']);
      await db.execute("UPDATE minibar_items SET cost_price = ROUND(price * 0.55) WHERE cost_price = 0");

      // Two-tier mini bar model: `minibar_items` above is now the CENTRAL
      // STORE catalog (hotel-wide warehouse stock + retail price + cost).
      // Each physical room additionally carries its own current stock
      // (room_minibar_stock), refilled FROM the central store, consumed BY
      // guests during their stay, and reset via a package template
      // (minibar_packages) the first time a room is tracked.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS minibar_packages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS minibar_package_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          package_id INTEGER NOT NULL REFERENCES minibar_packages(id),
          minibar_item_id INTEGER NOT NULL REFERENCES minibar_items(id),
          quantity INTEGER NOT NULL DEFAULT 1
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS room_minibar_stock (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          physical_room_id INTEGER NOT NULL REFERENCES physical_rooms(id),
          minibar_item_id INTEGER NOT NULL REFERENCES minibar_items(id),
          opening_stock INTEGER NOT NULL DEFAULT 0,
          current_stock INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(physical_room_id, minibar_item_id)
        )
      `);
      // Append-only. No route ever updates or deletes a row here — it's the
      // permanent record of every stock movement (who, what, when, why),
      // same "locked ledger" principle as the cash handover log.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS minibar_room_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          physical_room_id INTEGER NOT NULL REFERENCES physical_rooms(id),
          minibar_item_id INTEGER NOT NULL REFERENCES minibar_items(id),
          booking_id INTEGER REFERENCES bookings(id),
          action TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          unit_price REAL NOT NULL DEFAULT 0,
          penalty_amount REAL NOT NULL DEFAULT 0,
          charged_booking_id INTEGER REFERENCES bookings(id),
          staff_username TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS minibar_refill_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          physical_room_id INTEGER NOT NULL REFERENCES physical_rooms(id),
          requested_by TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          fulfilled_at TEXT,
          fulfilled_by TEXT
        )
      `);
      await addColumnsIfMissing('physical_rooms', ['minibar_package_id INTEGER']);

      // Seed two starter packages (Standard / Premium) built from the item
      // catalog above, and assign every existing physical room to Standard
      // by default — admin can change either from the Mini Bar tab.
      const minibarItemRows = await db.execute('SELECT id, name FROM minibar_items');
      const minibarIdByName = {};
      minibarItemRows.rows.forEach((r) => { minibarIdByName[r.name] = Number(r.id); });

      const packageSeed = {
        Standard: { 'Mineral Water (500ml)': 2, 'Coca-Cola (Can)': 1, 'Sprite (Can)': 1 },
        Premium: { 'Mineral Water (500ml)': 3, 'Coca-Cola (Can)': 2, 'Sprite (Can)': 2, "Lay's Chips": 1, 'Kit Kat': 1 }
      };
      const packageIdByName = {};
      for (const pkgName of Object.keys(packageSeed)) {
        const existing = await db.execute({ sql: 'SELECT id FROM minibar_packages WHERE name = ?', args: [pkgName] });
        let pkgId;
        if (existing.rows.length) {
          pkgId = Number(existing.rows[0].id);
        } else {
          const created = await db.execute({ sql: 'INSERT INTO minibar_packages (name) VALUES (?)', args: [pkgName] });
          pkgId = Number(created.lastInsertRowid);
          for (const [itemName, qty] of Object.entries(packageSeed[pkgName])) {
            if (minibarIdByName[itemName]) {
              await db.execute({
                sql: 'INSERT INTO minibar_package_items (package_id, minibar_item_id, quantity) VALUES (?, ?, ?)',
                args: [pkgId, minibarIdByName[itemName], qty]
              });
            }
          }
        }
        packageIdByName[pkgName] = pkgId;
      }
      await db.execute({
        sql: 'UPDATE physical_rooms SET minibar_package_id = ? WHERE minibar_package_id IS NULL',
        args: [packageIdByName.Standard]
      });

      // Retire the old generic placeholder rooms now that Horizon Inn has real room
      // content. Delete them if nothing ever booked them; otherwise just hide them from
      // the public listing (active = 0) so any historical booking still resolves fine.
      for (const slug of LEGACY_PLACEHOLDER_SLUGS) {
        const roomResult = await db.execute({ sql: 'SELECT id FROM rooms WHERE slug = ?', args: [slug] });
        const room = roomResult.rows[0];
        if (!room) continue;
        const bookingCount = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM bookings WHERE room_id = ?', args: [room.id] });
        if (Number(bookingCount.rows[0].n) === 0) {
          await db.execute({ sql: 'DELETE FROM rooms WHERE id = ?', args: [room.id] });
        } else {
          await db.execute({ sql: 'UPDATE rooms SET active = 0 WHERE id = ?', args: [room.id] });
        }
      }

      // Seed rooms only if missing (by slug) — admin edits from the dashboard must
      // survive a restart/redeploy, so we no longer overwrite existing rows here.
      for (const room of SEED_ROOMS) {
        await db.execute({
          sql: `
            INSERT INTO rooms (slug, name, description, price, price_1p, price_3p, features, images, gradient, total_units, featured, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO NOTHING
          `,
          args: [
            room.slug, room.name, room.description, room.price, room.price_1p, room.price_3p,
            room.features, room.images, room.gradient, room.total_units, room.featured, room.active
          ]
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
