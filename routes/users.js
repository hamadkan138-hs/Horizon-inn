const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

router.use(adminAuth, requireRole('admin'));

router.get('/', async (req, res) => {
  try {
    const result = await db.execute('SELECT id, username, role, created_at FROM users ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load staff accounts' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    // 'investor' is deliberately excluded — an investor-role login with no
    // matching row in the investors table is broken (their dashboard 404s
    // with "no investor profile linked"). Investor accounts must always be
    // created atomically via POST /api/investor-accounts instead, which
    // creates the login and the profile together.
    // 'kiosk' is a deliberately low-privilege role for the unattended lobby
    // check-in device: it can reach /api/kiosk and nothing else, so a tablet
    // left in a public space can't be used to read the guest directory,
    // reports, or cash records even if someone gets at the browser.
    if (!username || !password || !['admin', 'staff', 'kiosk'].includes(role)) {
      return res.status(400).json({ error: 'Username, password, and a valid role are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [username] });
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'That username is already taken' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.execute({
      sql: 'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      args: [username, hash, role]
    });
    const created = await db.execute({
      sql: 'SELECT id, username, role, created_at FROM users WHERE id = ?',
      args: [Number(result.lastInsertRowid)]
    });
    res.status(201).json(created.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create staff account' });
  }
});

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let pass = '';
  for (let i = 0; i < 12; i++) pass += chars[Math.floor(Math.random() * chars.length)];
  return pass;
}

// Passwords are one-way bcrypt hashes — there is no "saved password" to look
// up or show an admin, by design, so the only way to help a locked-out staff
// member is to set a brand-new one. Returned once in the response; never
// stored anywhere in readable form.
router.patch('/:id/reset-password', async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Staff account not found' });
    }
    if (existing.rows[0].role === 'investor') {
      return res.status(400).json({ error: 'Reset investor passwords from the Investor Accounts tab instead.' });
    }
    const requestedPassword = req.body.password;
    if (requestedPassword && String(requestedPassword).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const newPassword = requestedPassword ? String(requestedPassword) : generatePassword();
    const hash = bcrypt.hashSync(newPassword, 10);
    await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hash, req.params.id] });
    res.json({ reset: true, newPassword });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account while logged in' });
    }
    const existing = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Staff account not found' });
    }
    if (existing.rows[0].role === 'investor') {
      return res.status(400).json({ error: 'Remove investor accounts from the Investor Accounts tab instead — it also cleans up their capital and withdrawal records.' });
    }
    await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete staff account' });
  }
});

module.exports = router;
