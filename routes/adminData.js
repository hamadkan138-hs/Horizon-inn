const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;
const { ALL_TABLES, CUSTOMER_PAYMENT_TABLES, exportTables, emailBackup } = require('../lib/backup');

const router = express.Router();

router.use(adminAuth, requireRole('admin'));

// Full-site backup, admin-triggered on demand — everything except `media`
// (large base64 image blobs, regenerable by re-uploading). Returned directly
// as a downloadable file rather than only emailed, so it doesn't depend on
// email being configured or delivery succeeding.
router.get('/backup', async (req, res) => {
  try {
    const backup = await exportTables(ALL_TABLES);
    res.set('Content-Disposition', `attachment; filename="horizon-inn-backup-${backup.exportedAt.slice(0, 10)}.json"`);
    res.json(backup);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate backup' });
  }
});

const RESET_CONFIRMATION_PHRASE = 'DELETE CUSTOMER DATA';

// Clears every stored customer record and payment transaction while leaving
// the site's configuration and features untouched (room types & pricing,
// physical rooms, mini bar catalog/packages/stock, promo codes, corporate
// accounts, investor accounts, admin/staff logins, site content/media).
//
// Two append-only "locked ledger" tables reference bookings but are never
// themselves deleted (reviews, minibar_room_log) — their booking_id link is
// nulled instead, so the operational/audit history survives with the
// now-deleted customer identity simply detached from it.
router.post('/reset-customer-data', async (req, res) => {
  try {
    if (req.body.confirm !== RESET_CONFIRMATION_PHRASE) {
      return res.status(400).json({ error: `Type "${RESET_CONFIRMATION_PHRASE}" exactly to confirm this action.` });
    }

    const backupResult = await emailBackup(CUSTOMER_PAYMENT_TABLES, {
      subject: 'Horizon Inn — backup before customer data reset',
      note: 'This is an automatic safety-net backup of every customer and payment record, taken immediately before an admin reset that data. Keep this file.'
    });
    const backup = backupResult.backup || await exportTables(CUSTOMER_PAYMENT_TABLES);

    // Detach (don't delete) the two permanent, append-only logs from the
    // customer records about to disappear.
    await db.execute('UPDATE minibar_room_log SET booking_id = NULL, charged_booking_id = NULL');
    await db.execute('UPDATE reviews SET booking_id = NULL');

    const deleted = {};
    for (const table of ['booking_charges', 'booking_status_log', 'payments', 'gift_vouchers']) {
      const result = await db.execute(`DELETE FROM ${table}`);
      deleted[table] = result.rowsAffected ?? 0;
    }
    const bookingsResult = await db.execute('DELETE FROM bookings');
    deleted.bookings = bookingsResult.rowsAffected ?? 0;
    for (const table of ['venue_bookings', 'abandoned_bookings', 'messages']) {
      const result = await db.execute(`DELETE FROM ${table}`);
      deleted[table] = result.rowsAffected ?? 0;
    }

    res.json({
      reset: true,
      deleted,
      backupEmailed: backupResult.sent,
      backupEmailReason: backupResult.sent ? undefined : backupResult.reason,
      backup
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset customer data' });
  }
});

module.exports = router;
