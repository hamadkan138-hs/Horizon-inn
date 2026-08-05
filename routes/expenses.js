const express = require('express');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

router.use(adminAuth, requireRole('admin', 'staff'));

router.get('/', async (req, res) => {
  try {
    const result = req.query.date
      ? await db.execute({
          sql: 'SELECT * FROM expenses WHERE expense_date = ? ORDER BY id DESC',
          args: [req.query.date]
        })
      : await db.execute('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load expenses' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { category, description, amount, expenseDate } = req.body;
    if (!category || !amount || !expenseDate) {
      return res.status(400).json({ error: 'Category, amount and date are required' });
    }
    const result = await db.execute({
      sql: 'INSERT INTO expenses (category, description, amount, expense_date) VALUES (?, ?, ?, ?)',
      args: [category, description || '', amount, expenseDate]
    });
    const created = await db.execute({ sql: 'SELECT * FROM expenses WHERE id = ?', args: [Number(result.lastInsertRowid)] });
    res.status(201).json(created.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add expense' });
  }
});

// Editing a past expense (as opposed to logging a new one) is a correction
// to the financial record, not day-to-day front-desk work — admin only,
// same split as DELETE below. Front desk keeps POST above so a shift can
// still log today's cash spend and have it subtracted from their handover.
router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { category, description, amount, expenseDate } = req.body;
    const existing = await db.execute({ sql: 'SELECT * FROM expenses WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    if (!category || !amount || !expenseDate) {
      return res.status(400).json({ error: 'Category, amount and date are required' });
    }
    await db.execute({
      sql: 'UPDATE expenses SET category = ?, description = ?, amount = ?, expense_date = ? WHERE id = ?',
      args: [category, description || '', amount, expenseDate, req.params.id]
    });
    const updated = await db.execute({ sql: 'SELECT * FROM expenses WHERE id = ?', args: [req.params.id] });
    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT * FROM expenses WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    await db.execute({ sql: 'DELETE FROM expenses WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

module.exports = router;
