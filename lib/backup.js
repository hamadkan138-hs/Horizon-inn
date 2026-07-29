const { db } = require('../db');
const { getTransporter } = require('./mailer');

// Every table in the app except `media` (base64 image blobs — large, and
// regenerable by re-uploading, so excluded to keep backups small enough to
// email as an attachment).
const ALL_TABLES = [
  'rooms', 'bookings', 'booking_charges', 'payments', 'rate_rules', 'expenses',
  'users', 'messages', 'settings', 'handovers', 'physical_rooms',
  'investors', 'valuation_snapshots', 'withdrawal_requests', 'investment_projects',
  'venues', 'catering_items', 'investor_leads', 'reviews', 'promo_codes',
  'gift_vouchers', 'corporate_accounts', 'abandoned_bookings', 'booking_status_log',
  'venue_bookings', 'minibar_items', 'minibar_packages', 'minibar_package_items',
  'room_minibar_stock', 'minibar_room_log', 'minibar_refill_requests'
];

// The tables touched by the "reset customer & payment data" admin action —
// used to scope the safety-net backup taken right before that reset runs.
const CUSTOMER_PAYMENT_TABLES = [
  'bookings', 'booking_charges', 'booking_status_log', 'payments',
  'venue_bookings', 'gift_vouchers', 'abandoned_bookings', 'messages',
  'reviews', 'minibar_room_log'
];

async function exportTables(tableNames) {
  const tables = {};
  for (const name of tableNames) {
    const result = await db.execute(`SELECT * FROM ${name}`);
    tables[name] = result.rows;
  }
  return { exportedAt: new Date().toISOString(), tables };
}

async function emailBackup(tableNames, { subject, note }) {
  const transporter = getTransporter();
  if (!transporter) {
    return { sent: false, reason: 'Email is not configured on this server (set EMAIL_USER and EMAIL_APP_PASSWORD).' };
  }

  const backup = await exportTables(tableNames);
  const to = process.env.EMAIL_TO || process.env.EMAIL_USER;
  const filename = `horizon-inn-backup-${backup.exportedAt.slice(0, 10)}.json`;

  await transporter.sendMail({
    from: `"Horizon Inn" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text: note,
    attachments: [{
      filename,
      content: JSON.stringify(backup, null, 2),
      contentType: 'application/json'
    }]
  });

  return { sent: true, backup };
}

module.exports = { ALL_TABLES, CUSTOMER_PAYMENT_TABLES, exportTables, emailBackup };
