const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

const COMPLIANCE_STATUSES = ['pending', 'verified', 'signed', 'rejected'];
const WITHDRAWAL_TYPES = ['dividend', 'capital'];
const WITHDRAWAL_STATUSES = ['pending', 'processing', 'completed', 'rejected'];

router.use(adminAuth, requireRole('admin', 'investor'));

function generatePassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
}

async function currentValuation() {
  const result = await db.execute('SELECT * FROM valuation_snapshots ORDER BY created_at DESC, id DESC LIMIT 1');
  return result.rows[0] || null;
}

function lockupInfo(investor) {
  const start = new Date(`${investor.lockup_start_date}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + Number(investor.lockup_months));
  const now = new Date();
  const totalMs = Math.max(1, end - start);
  const elapsedMs = Math.min(totalMs, Math.max(0, now - start));
  return {
    lockupStart: investor.lockup_start_date,
    lockupEnd: end.toISOString().slice(0, 10),
    progressPercent: Math.round((elapsedMs / totalMs) * 1000) / 10,
    unlocked: now >= end,
    daysRemaining: Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)))
  };
}

// All-time net income is the base the dividend share is calculated
// against — the same revenue/expense figures behind the aggregate
// business dashboard, never a guest-level figure.
async function allTimeNetIncome() {
  const revenue = await db.execute(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM bookings WHERE status != 'cancelled'`);
  const expenses = await db.execute('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses');
  return Number(revenue.rows[0].total) - Number(expenses.rows[0].total);
}

async function investorEarnings(investor, valuationAmount) {
  const ownershipPercent = valuationAmount > 0 ? (Number(investor.capital_invested) / valuationAmount) * 100 : 0;
  const netIncome = await allTimeNetIncome();
  const accruedDividend = Math.max(0, netIncome * (ownershipPercent / 100));

  const paid = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawal_requests WHERE investor_id = ? AND type = 'dividend' AND status = 'completed'`,
    args: [investor.id]
  });
  const pending = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawal_requests WHERE investor_id = ? AND type = 'dividend' AND status IN ('pending', 'processing')`,
    args: [investor.id]
  });
  const capitalPaidOut = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawal_requests WHERE investor_id = ? AND type = 'capital' AND status IN ('completed', 'pending', 'processing')`,
    args: [investor.id]
  });

  const alreadyWithdrawn = Number(paid.rows[0].total);
  const pendingWithdrawal = Number(pending.rows[0].total);

  return {
    ownershipPercent: Math.round(ownershipPercent * 100) / 100,
    equityValue: Math.round(valuationAmount * (ownershipPercent / 100)),
    netIncomeAllTime: netIncome,
    accruedDividend: Math.round(accruedDividend),
    alreadyWithdrawnDividend: alreadyWithdrawn,
    pendingDividendRequests: pendingWithdrawal,
    availableToWithdraw: Math.max(0, Math.round(accruedDividend - alreadyWithdrawn - pendingWithdrawal)),
    capitalCommittedOrPaid: Number(capitalPaidOut.rows[0].total)
  };
}

/* ---------------- Admin: investor profile management ---------------- */

router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT investors.*, users.username
      FROM investors JOIN users ON users.id = investors.user_id
      ORDER BY investors.created_at ASC
    `);
    const valuation = await currentValuation();
    const valuationAmount = valuation ? Number(valuation.amount) : 0;
    const rows = await Promise.all(result.rows.map(async (inv) => ({
      id: inv.id,
      username: inv.username,
      investorCode: inv.investor_code,
      capitalInvested: Number(inv.capital_invested),
      ownershipPercent: valuationAmount > 0 ? Math.round((Number(inv.capital_invested) / valuationAmount) * 10000) / 100 : 0,
      spaStatus: inv.spa_status,
      accreditedStatus: inv.accredited_status,
      amlKycStatus: inv.aml_kyc_status,
      lockupMonths: inv.lockup_months,
      lockupStartDate: inv.lockup_start_date,
      dividendTurnaroundHours: inv.dividend_turnaround_hours,
      notes: inv.notes,
      createdAt: inv.created_at
    })));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load investor accounts' });
  }
});

router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { username, capitalInvested, lockupMonths, dividendTurnaroundHours } = req.body;
    if (!username || capitalInvested === undefined || capitalInvested === '') {
      return res.status(400).json({ error: 'Username and capital invested are required' });
    }
    const existing = await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [username] });
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'That username is already taken' });
    }

    const password = generatePassword();
    const hash = bcrypt.hashSync(password, 10);
    const userResult = await db.execute({
      sql: 'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      args: [username, hash, 'investor']
    });
    const userId = Number(userResult.lastInsertRowid);

    const investorResult = await db.execute({
      sql: `
        INSERT INTO investors (user_id, investor_code, capital_invested, lockup_months, dividend_turnaround_hours)
        VALUES (?, 'PENDING', ?, ?, ?)
      `,
      args: [userId, capitalInvested, lockupMonths || 6, dividendTurnaroundHours || 24]
    });
    const investorId = Number(investorResult.lastInsertRowid);
    const investorCode = `HZI-${String(investorId).padStart(4, '0')}`;
    await db.execute({ sql: 'UPDATE investors SET investor_code = ? WHERE id = ?', args: [investorCode, investorId] });

    res.status(201).json({
      id: investorId,
      username,
      investorCode,
      capitalInvested: Number(capitalInvested),
      generatedPassword: password
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create investor account' });
  }
});

router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { capitalInvested, spaStatus, accreditedStatus, amlKycStatus, lockupMonths, lockupStartDate, dividendTurnaroundHours, notes } = req.body;
    const existing = await db.execute({ sql: 'SELECT * FROM investors WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    for (const [field, value] of [['spaStatus', spaStatus], ['accreditedStatus', accreditedStatus], ['amlKycStatus', amlKycStatus]]) {
      if (value !== undefined && !COMPLIANCE_STATUSES.includes(value)) {
        return res.status(400).json({ error: `${field} must be one of: ${COMPLIANCE_STATUSES.join(', ')}` });
      }
    }

    const updates = [];
    const args = [];
    if (capitalInvested !== undefined) { updates.push('capital_invested = ?'); args.push(capitalInvested); }
    if (spaStatus !== undefined) { updates.push('spa_status = ?'); args.push(spaStatus); }
    if (accreditedStatus !== undefined) { updates.push('accredited_status = ?'); args.push(accreditedStatus); }
    if (amlKycStatus !== undefined) { updates.push('aml_kyc_status = ?'); args.push(amlKycStatus); }
    if (lockupMonths !== undefined) { updates.push('lockup_months = ?'); args.push(lockupMonths); }
    if (lockupStartDate !== undefined) { updates.push('lockup_start_date = ?'); args.push(lockupStartDate); }
    if (dividendTurnaroundHours !== undefined) { updates.push('dividend_turnaround_hours = ?'); args.push(dividendTurnaroundHours); }
    if (notes !== undefined) { updates.push('notes = ?'); args.push(notes); }
    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    args.push(req.params.id);
    await db.execute({ sql: `UPDATE investors SET ${updates.join(', ')} WHERE id = ?`, args });
    res.json({ updated: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update investor account' });
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT * FROM investors WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    const requestCount = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM withdrawal_requests WHERE investor_id = ?', args: [req.params.id] });
    if (Number(requestCount.rows[0].n) > 0) {
      return res.status(409).json({ error: `Cannot delete — this investor has ${requestCount.rows[0].n} withdrawal request(s) on record.` });
    }
    await db.execute({ sql: 'DELETE FROM investors WHERE id = ?', args: [req.params.id] });
    await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [existing.rows[0].user_id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete investor account' });
  }
});

/* ---------------- Self-service: the logged-in investor's own account ---------------- */

router.get('/me', async (req, res) => {
  try {
    const result = await db.execute({ sql: 'SELECT * FROM investors WHERE user_id = ?', args: [req.user.id] });
    const investor = result.rows[0];
    if (!investor) {
      return res.status(404).json({ error: 'No investor profile is linked to this account' });
    }
    const valuation = await currentValuation();
    const valuationAmount = valuation ? Number(valuation.amount) : 0;
    const earnings = await investorEarnings(investor, valuationAmount);

    res.json({
      id: investor.id,
      investorCode: investor.investor_code,
      capitalInvested: Number(investor.capital_invested),
      spaStatus: investor.spa_status,
      accreditedStatus: investor.accredited_status,
      amlKycStatus: investor.aml_kyc_status,
      dividendTurnaroundHours: investor.dividend_turnaround_hours,
      valuation: valuationAmount,
      lockup: lockupInfo(investor),
      ...earnings
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load your investor account' });
  }
});

/* ---------------- Hotel valuation ---------------- */

router.get('/valuation', async (req, res) => {
  try {
    const history = await db.execute('SELECT * FROM valuation_snapshots ORDER BY created_at ASC, id ASC');
    const capitalResult = await db.execute('SELECT COALESCE(SUM(capital_invested), 0) AS total FROM investors');
    const latest = history.rows[history.rows.length - 1] || null;
    const amount = latest ? Number(latest.amount) : 0;
    const totalCapitalRaised = Number(capitalResult.rows[0].total);

    res.json({
      current: latest ? { amount, note: latest.note, createdAt: latest.created_at } : null,
      history: history.rows.map((r) => ({ amount: Number(r.amount), note: r.note, createdAt: r.created_at })),
      totalCapitalRaised,
      remainingPool: Math.max(0, amount - totalCapitalRaised)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load valuation' });
  }
});

router.post('/valuation', requireRole('admin'), async (req, res) => {
  try {
    const { amount, note } = req.body;
    if (amount === undefined || amount === '' || Number(amount) <= 0) {
      return res.status(400).json({ error: 'A positive valuation amount is required' });
    }
    await db.execute({
      sql: 'INSERT INTO valuation_snapshots (amount, note, set_by) VALUES (?, ?, ?)',
      args: [amount, note || '', req.user.username]
    });
    res.status(201).json({ created: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record valuation' });
  }
});

/* ---------------- Upcoming projects ---------------- */

function parseProject(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    location: row.location,
    targetCapital: Number(row.target_capital),
    timeline: row.timeline,
    growthPotential: row.growth_potential,
    images: JSON.parse(row.images || '[]'),
    status: row.status,
    createdAt: row.created_at
  };
}

router.get('/projects', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM investment_projects ORDER BY created_at DESC');
    res.json(result.rows.map(parseProject));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load projects' });
  }
});

router.post('/projects', requireRole('admin'), async (req, res) => {
  try {
    const { name, description, location, targetCapital, timeline, growthPotential, images, status } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    const result = await db.execute({
      sql: `
        INSERT INTO investment_projects (name, description, location, target_capital, timeline, growth_potential, images, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        name, description || '', location || '', targetCapital || 0, timeline || '', growthPotential || '',
        JSON.stringify(Array.isArray(images) ? images : []), status || 'planned'
      ]
    });
    const created = await db.execute({ sql: 'SELECT * FROM investment_projects WHERE id = ?', args: [Number(result.lastInsertRowid)] });
    res.status(201).json(parseProject(created.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

router.patch('/projects/:id', requireRole('admin'), async (req, res) => {
  try {
    const { name, description, location, targetCapital, timeline, growthPotential, images, status } = req.body;
    const existing = await db.execute({ sql: 'SELECT id FROM investment_projects WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const updates = [];
    const args = [];
    if (name !== undefined) { updates.push('name = ?'); args.push(name); }
    if (description !== undefined) { updates.push('description = ?'); args.push(description); }
    if (location !== undefined) { updates.push('location = ?'); args.push(location); }
    if (targetCapital !== undefined) { updates.push('target_capital = ?'); args.push(targetCapital); }
    if (timeline !== undefined) { updates.push('timeline = ?'); args.push(timeline); }
    if (growthPotential !== undefined) { updates.push('growth_potential = ?'); args.push(growthPotential); }
    if (images !== undefined) { updates.push('images = ?'); args.push(JSON.stringify(images)); }
    if (status !== undefined) { updates.push('status = ?'); args.push(status); }
    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    args.push(req.params.id);
    await db.execute({ sql: `UPDATE investment_projects SET ${updates.join(', ')} WHERE id = ?`, args });
    const updated = await db.execute({ sql: 'SELECT * FROM investment_projects WHERE id = ?', args: [req.params.id] });
    res.json(parseProject(updated.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

router.delete('/projects/:id', requireRole('admin'), async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM investment_projects WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

/* ---------------- Withdrawal requests ---------------- */

router.get('/withdrawal-requests', async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const result = await db.execute(`
        SELECT withdrawal_requests.*, investors.investor_code, users.username
        FROM withdrawal_requests
        JOIN investors ON investors.id = withdrawal_requests.investor_id
        JOIN users ON users.id = investors.user_id
        ORDER BY withdrawal_requests.requested_at DESC
      `);
      return res.json(result.rows.map((r) => ({
        id: r.id, investorCode: r.investor_code, username: r.username, type: r.type,
        amount: Number(r.amount), status: r.status, requestedAt: r.requested_at,
        processedAt: r.processed_at, processedBy: r.processed_by, note: r.note
      })));
    }

    const investorResult = await db.execute({ sql: 'SELECT id FROM investors WHERE user_id = ?', args: [req.user.id] });
    const investor = investorResult.rows[0];
    if (!investor) return res.json([]);
    const result = await db.execute({
      sql: 'SELECT * FROM withdrawal_requests WHERE investor_id = ? ORDER BY requested_at DESC',
      args: [investor.id]
    });
    res.json(result.rows.map((r) => ({
      id: r.id, type: r.type, amount: Number(r.amount), status: r.status,
      requestedAt: r.requested_at, processedAt: r.processed_at, note: r.note
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load withdrawal requests' });
  }
});

router.post('/withdrawal-requests', requireRole('investor'), async (req, res) => {
  try {
    const { type, amount } = req.body;
    if (!WITHDRAWAL_TYPES.includes(type) || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: `Type must be one of: ${WITHDRAWAL_TYPES.join(', ')}, with a positive amount` });
    }
    const investorResult = await db.execute({ sql: 'SELECT * FROM investors WHERE user_id = ?', args: [req.user.id] });
    const investor = investorResult.rows[0];
    if (!investor) {
      return res.status(404).json({ error: 'No investor profile is linked to this account' });
    }

    if (type === 'dividend') {
      const valuation = await currentValuation();
      const earnings = await investorEarnings(investor, valuation ? Number(valuation.amount) : 0);
      if (Number(amount) > earnings.availableToWithdraw) {
        return res.status(400).json({ error: `Only Rs. ${Math.round(earnings.availableToWithdraw).toLocaleString('en-US')} is currently available to withdraw` });
      }
    } else {
      const lockup = lockupInfo(investor);
      if (!lockup.unlocked) {
        return res.status(400).json({ error: `Capital is locked up for ${lockup.daysRemaining} more day(s) (until ${lockup.lockupEnd})` });
      }
      const committed = await db.execute({
        sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawal_requests WHERE investor_id = ? AND type = 'capital' AND status IN ('pending','processing','completed')`,
        args: [investor.id]
      });
      const available = Number(investor.capital_invested) - Number(committed.rows[0].total);
      if (Number(amount) > available) {
        return res.status(400).json({ error: `Only Rs. ${Math.round(available).toLocaleString('en-US')} of principal capital is available to release` });
      }
    }

    await db.execute({
      sql: 'INSERT INTO withdrawal_requests (investor_id, type, amount) VALUES (?, ?, ?)',
      args: [investor.id, type, amount]
    });
    res.status(201).json({ requested: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit withdrawal request' });
  }
});

router.patch('/withdrawal-requests/:id', requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!WITHDRAWAL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${WITHDRAWAL_STATUSES.join(', ')}` });
    }
    const existing = await db.execute({ sql: 'SELECT id FROM withdrawal_requests WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Withdrawal request not found' });
    }
    await db.execute({
      sql: `UPDATE withdrawal_requests SET status = ?, processed_at = datetime('now'), processed_by = ? WHERE id = ?`,
      args: [status, req.user.username, req.params.id]
    });
    res.json({ updated: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update withdrawal request' });
  }
});

module.exports = router;
