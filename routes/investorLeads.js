const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

const VALID_STATUSES = ['new_lead', 'contacted', 'meeting_scheduled', 'closed'];

function parseLead(row) {
  return {
    id: Number(row.id), fullName: row.full_name, phone: row.phone, email: row.email,
    location: row.location, investmentTier: row.investment_tier, investmentType: row.investment_type,
    notes: row.notes, status: row.status, createdAt: row.created_at,
    convertedInvestorId: row.converted_investor_id ? Number(row.converted_investor_id) : null
  };
}

// Public — the "Become a Partner" CTA on the client site submits here with no
// login required. Reading/managing leads afterward is admin/staff only.
router.post('/', async (req, res) => {
  try {
    const { fullName, phone, email, location, investmentTier, investmentType, notes } = req.body;
    if (!fullName || !phone) {
      return res.status(400).json({ error: 'Full name and phone/WhatsApp are required' });
    }
    const result = await db.execute({
      sql: `
        INSERT INTO investor_leads (full_name, phone, email, location, investment_tier, investment_type, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [fullName, phone, email || '', location || '', investmentTier || '', investmentType || '', notes || '']
    });
    const created = await db.execute({ sql: 'SELECT * FROM investor_leads WHERE id = ?', args: [Number(result.lastInsertRowid)] });
    res.status(201).json(parseLead(created.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit interest' });
  }
});

router.use(adminAuth, requireRole('admin', 'staff'));

router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const result = status
      ? await db.execute({ sql: 'SELECT * FROM investor_leads WHERE status = ? ORDER BY created_at DESC', args: [status] })
      : await db.execute('SELECT * FROM investor_leads ORDER BY created_at DESC');
    res.json(result.rows.map(parseLead));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load leads' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { status, notes, convertedInvestorId } = req.body;
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    const updates = [];
    const args = [];
    if (status !== undefined) { updates.push('status = ?'); args.push(status); }
    if (notes !== undefined) { updates.push('notes = ?'); args.push(notes); }
    if (convertedInvestorId !== undefined) { updates.push('converted_investor_id = ?'); args.push(convertedInvestorId); }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    args.push(req.params.id);
    await db.execute({ sql: `UPDATE investor_leads SET ${updates.join(', ')} WHERE id = ?`, args });
    const updated = await db.execute({ sql: 'SELECT * FROM investor_leads WHERE id = ?', args: [req.params.id] });
    if (!updated.rows[0]) return res.status(404).json({ error: 'Lead not found' });
    res.json(parseLead(updated.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM investor_leads WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

module.exports = router;
