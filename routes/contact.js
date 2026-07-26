const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const insertResult = await db.execute({
      sql: 'INSERT INTO messages (name, email, message) VALUES (?, ?, ?)',
      args: [name, email, message]
    });

    const id = Number(insertResult.lastInsertRowid);
    const savedResult = await db.execute({ sql: 'SELECT * FROM messages WHERE id = ?', args: [id] });
    res.status(201).json(savedResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save your message' });
  }
});

router.get('/', adminAuth, async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM messages ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

module.exports = router;
