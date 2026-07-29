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

// Public, unauthenticated: lets prospective investors browsing the main site see
// upcoming expansion projects (name, renders, capital/timeline) without needing an
// investor login — everything below this route still requires admin/investor auth.
// Deliberately excludes valuationAmount/ownerEquityPercent/projectedMonthlyIncome:
// those feed the authenticated Share & ROI Calculator and are more sensitive than
// what this pitch page has ever shown a general, unauthenticated visitor.
router.get('/public/projects', async (req, res) => {
  try {
    const result = await db.execute(
      "SELECT * FROM investment_projects WHERE status != 'archived' ORDER BY created_at DESC"
    );
    res.json(result.rows.map((row) => {
      const { valuationAmount, ownerEquityPercent, projectedMonthlyIncome, ...publicFields } = parseProject(row);
      return publicFields;
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load projects' });
  }
});

router.use(adminAuth, requireRole('admin', 'investor'));

function generatePassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
}

async function currentValuation() {
  const result = await db.execute('SELECT * FROM valuation_snapshots ORDER BY created_at DESC, id DESC LIMIT 1');
  return result.rows[0] || null;
}

async function getTotalCapitalRaised() {
  const result = await db.execute('SELECT COALESCE(SUM(capital_invested), 0) AS total FROM investors');
  return Number(result.rows[0].total);
}

// Owner's retained equity is stored in the same generic settings key/value
// table used for site content — it's a single current-state number, not a
// history log like valuation_snapshots, so it doesn't need its own table.
async function getOwnerEquityPercent() {
  const result = await db.execute("SELECT value FROM settings WHERE key = 'owner_equity_percent'");
  return result.rows[0] ? Number(result.rows[0].value) : 0;
}

async function setOwnerEquityPercent(percent) {
  await db.execute({
    sql: `
      INSERT INTO settings (key, value, updated_at) VALUES ('owner_equity_percent', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `,
    args: [String(percent)]
  });
}

// When the owner has fixed a retained equity %, investors split only the
// remaining pool, proportional to their share of total capital raised —
// this keeps the owner's stake exactly fixed regardless of valuation
// swings or new capital coming in, which is the whole point of "fixing" it.
// Until an owner % is set, ownership keeps working the original way
// (capital invested as a direct fraction of current valuation) so existing
// investors' numbers don't shift just because this feature exists.
function computeOwnershipPercent(capitalInvested, valuationAmount, totalCapitalRaised, ownerEquityPercent) {
  if (ownerEquityPercent > 0 && totalCapitalRaised > 0) {
    const investablePoolPercent = Math.max(0, 100 - ownerEquityPercent);
    return (Number(capitalInvested) / totalCapitalRaised) * investablePoolPercent;
  }
  return valuationAmount > 0 ? (Number(capitalInvested) / valuationAmount) * 100 : 0;
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

async function investorEarnings(investor, valuationAmount, totalCapitalRaised, ownerEquityPercent) {
  const ownershipPercent = computeOwnershipPercent(investor.capital_invested, valuationAmount, totalCapitalRaised, ownerEquityPercent);
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
    const totalCapitalRaised = await getTotalCapitalRaised();
    const ownerEquityPercent = await getOwnerEquityPercent();
    const rows = await Promise.all(result.rows.map(async (inv) => ({
      id: inv.id,
      username: inv.username,
      investorCode: inv.investor_code,
      capitalInvested: Number(inv.capital_invested),
      ownershipPercent: Math.round(computeOwnershipPercent(inv.capital_invested, valuationAmount, totalCapitalRaised, ownerEquityPercent) * 100) / 100,
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
    const { username, capitalInvested, lockupMonths, dividendTurnaroundHours, password: requestedPassword } = req.body;
    if (!username || capitalInvested === undefined || capitalInvested === '') {
      return res.status(400).json({ error: 'Username and capital invested are required' });
    }
    if (requestedPassword && String(requestedPassword).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const existing = await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [username] });
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'That username is already taken' });
    }

    const password = requestedPassword ? String(requestedPassword) : generatePassword();
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

// Registered before /:id so the literal path "owner-equity" is never
// swallowed by the :id wildcard (Express matches routes in registration
// order, and /:id matches any single path segment).
router.get('/owner-equity', async (req, res) => {
  try {
    res.json({ percent: await getOwnerEquityPercent() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load owner equity setting' });
  }
});

router.patch('/owner-equity', requireRole('admin'), async (req, res) => {
  try {
    const { percent } = req.body;
    if (percent === undefined || percent === '' || Number(percent) < 0 || Number(percent) > 100) {
      return res.status(400).json({ error: 'Owner equity percent must be between 0 and 100' });
    }
    await setOwnerEquityPercent(Number(percent));
    res.json({ percent: Number(percent) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save owner equity setting' });
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
    // Admins have no investor profile of their own, but can preview any
    // investor's dashboard read-only (for testing/demoing) by passing
    // ?investorId=. Investors can never use this to view each other's data
    // — it only takes effect for the admin role.
    let investor;
    if (req.user.role === 'admin' && req.query.investorId) {
      const result = await db.execute({
        sql: `
          SELECT investors.*, users.username FROM investors
          JOIN users ON users.id = investors.user_id
          WHERE investors.id = ?
        `,
        args: [req.query.investorId]
      });
      investor = result.rows[0];
    } else {
      const result = await db.execute({
        sql: `
          SELECT investors.*, users.username FROM investors
          JOIN users ON users.id = investors.user_id
          WHERE investors.user_id = ?
        `,
        args: [req.user.id]
      });
      investor = result.rows[0];
    }
    if (!investor) {
      return res.status(404).json({ error: 'No investor profile is linked to this account' });
    }
    const valuation = await currentValuation();
    const valuationAmount = valuation ? Number(valuation.amount) : 0;
    const totalCapitalRaised = await getTotalCapitalRaised();
    const ownerEquityPercent = await getOwnerEquityPercent();
    const earnings = await investorEarnings(investor, valuationAmount, totalCapitalRaised, ownerEquityPercent);

    res.json({
      id: investor.id,
      username: investor.username,
      investorCode: investor.investor_code,
      capitalInvested: Number(investor.capital_invested),
      spaStatus: investor.spa_status,
      accreditedStatus: investor.accredited_status,
      amlKycStatus: investor.aml_kyc_status,
      dividendTurnaroundHours: investor.dividend_turnaround_hours,
      valuation: valuationAmount,
      totalCapitalRaised,
      ownerEquityPercent,
      isPreview: req.user.role === 'admin',
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
    const totalCapitalRaised = await getTotalCapitalRaised();
    const ownerEquityPercent = await getOwnerEquityPercent();
    const latest = history.rows[history.rows.length - 1] || null;
    const amount = latest ? Number(latest.amount) : 0;

    res.json({
      current: latest ? { amount, note: latest.note, createdAt: latest.created_at } : null,
      history: history.rows.map((r) => ({ amount: Number(r.amount), note: r.note, createdAt: r.created_at })),
      totalCapitalRaised,
      remainingPool: Math.max(0, amount - totalCapitalRaised),
      ownerEquityPercent
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
    valuationAmount: Number(row.valuation_amount) || 0,
    ownerEquityPercent: Number(row.owner_equity_percent) || 0,
    projectedMonthlyIncome: Number(row.projected_monthly_income) || 0,
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
    const {
      name, description, location, targetCapital, timeline, growthPotential, images, status,
      valuationAmount, ownerEquityPercent, projectedMonthlyIncome
    } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    const result = await db.execute({
      sql: `
        INSERT INTO investment_projects (
          name, description, location, target_capital, timeline, growth_potential, images, status,
          valuation_amount, owner_equity_percent, projected_monthly_income
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        name, description || '', location || '', targetCapital || 0, timeline || '', growthPotential || '',
        JSON.stringify(Array.isArray(images) ? images : []), status || 'planned',
        valuationAmount || 0, ownerEquityPercent || 0, projectedMonthlyIncome || 0
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
    const {
      name, description, location, targetCapital, timeline, growthPotential, images, status,
      valuationAmount, ownerEquityPercent, projectedMonthlyIncome
    } = req.body;
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
    if (valuationAmount !== undefined) { updates.push('valuation_amount = ?'); args.push(valuationAmount); }
    if (ownerEquityPercent !== undefined) { updates.push('owner_equity_percent = ?'); args.push(ownerEquityPercent); }
    if (projectedMonthlyIncome !== undefined) { updates.push('projected_monthly_income = ?'); args.push(projectedMonthlyIncome); }
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
      // While previewing a specific investor's dashboard, scope this down to
      // that investor's own history instead of the full business-wide list.
      if (req.query.investorId) {
        const result = await db.execute({
          sql: 'SELECT * FROM withdrawal_requests WHERE investor_id = ? ORDER BY requested_at DESC',
          args: [req.query.investorId]
        });
        return res.json(result.rows.map((r) => ({
          id: r.id, type: r.type, amount: Number(r.amount), status: r.status,
          requestedAt: r.requested_at, processedAt: r.processed_at, note: r.note
        })));
      }
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
      const totalCapitalRaised = await getTotalCapitalRaised();
      const ownerEquityPercent = await getOwnerEquityPercent();
      const earnings = await investorEarnings(investor, valuation ? Number(valuation.amount) : 0, totalCapitalRaised, ownerEquityPercent);
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
