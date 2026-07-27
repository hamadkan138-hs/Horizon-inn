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
    if (!username || !password || !['admin', 'staff'].includes(role)) {
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
