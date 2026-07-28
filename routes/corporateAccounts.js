const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

const BILLING_TERMS = ['due_on_receipt', 'net_15', 'net_30'];

function parseAccount(row) {
  return {
    id: Number(row.id), companyName: row.company_name, contactPerson: row.contact_person,
    contactEmail: row.contact_email, contactPhone: row.contact_phone, billingTerms: row.billing_terms,
    agreedDiscountPercent: Number(row.agreed_discount_percent), notes: row.notes,
    active: !!row.active, createdAt: row.created_at
  };
}

router.use(adminAuth, requireRole('admin', 'staff'));

router.get('/', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM corporate_accounts WHERE active = 1 ORDER BY company_name ASC');
    res.json(result.rows.map(parseAccount));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load corporate accounts' });
  }
});

router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { companyName, contactPerson, contactEmail, contactPhone, billingTerms, agreedDiscountPercent, notes } = req.body;
    if (!companyName) return res.status(400).json({ error: 'Company name is required' });
    if (billingTerms && !BILLING_TERMS.includes(billingTerms)) {
      return res.status(400).json({ error: `billingTerms must be one of: ${BILLING_TERMS.join(', ')}` });
    }
    const result = await db.execute({
      sql: `
        INSERT INTO corporate_accounts (company_name, contact_person, contact_email, contact_phone, billing_terms, agreed_discount_percent, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [companyName, contactPerson || '', contactEmail || '', contactPhone || '', billingTerms || 'due_on_receipt', Number(agreedDiscountPercent) || 0, notes || '']
    });
    const created = await db.execute({ sql: 'SELECT * FROM corporate_accounts WHERE id = ?', args: [Number(result.lastInsertRowid)] });
    res.status(201).json(parseAccount(created.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create corporate account' });
  }
});

router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { companyName, contactPerson, contactEmail, contactPhone, billingTerms, agreedDiscountPercent, notes, active } = req.body;
    const updates = [];
    const args = [];
    if (companyName !== undefined) { updates.push('company_name = ?'); args.push(companyName); }
    if (contactPerson !== undefined) { updates.push('contact_person = ?'); args.push(contactPerson); }
    if (contactEmail !== undefined) { updates.push('contact_email = ?'); args.push(contactEmail); }
    if (contactPhone !== undefined) { updates.push('contact_phone = ?'); args.push(contactPhone); }
    if (billingTerms !== undefined) { updates.push('billing_terms = ?'); args.push(billingTerms); }
    if (agreedDiscountPercent !== undefined) { updates.push('agreed_discount_percent = ?'); args.push(Number(agreedDiscountPercent)); }
    if (notes !== undefined) { updates.push('notes = ?'); args.push(notes); }
    if (active !== undefined) { updates.push('active = ?'); args.push(active ? 1 : 0); }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    args.push(req.params.id);
    await db.execute({ sql: `UPDATE corporate_accounts SET ${updates.join(', ')} WHERE id = ?`, args });
    const updated = await db.execute({ sql: 'SELECT * FROM corporate_accounts WHERE id = ?', args: [req.params.id] });
    if (!updated.rows[0]) return res.status(404).json({ error: 'Account not found' });
    res.json(parseAccount(updated.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update corporate account' });
  }
});

module.exports = router;
