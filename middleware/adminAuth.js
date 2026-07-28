const bcrypt = require('bcryptjs');
const { db } = require('../db');

// Basic Auth sends credentials on every request (there's no single login
// endpoint), so brute-force protection has to live here rather than on one
// route. In-memory is fine at this app's scale — a single Node process,
// no horizontal scaling — and resets on deploy, which is an acceptable
// tradeoff for a small hospitality-business admin panel.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const attempts = new Map(); // username (lowercased) -> { count, lockedUntil }

function trackerKey(username) {
  return String(username || '').toLowerCase();
}

function isLockedOut(username) {
  const entry = attempts.get(trackerKey(username));
  if (!entry || !entry.lockedUntil) return false;
  if (Date.now() > entry.lockedUntil) {
    attempts.delete(trackerKey(username));
    return false;
  }
  return true;
}

function recordFailure(username) {
  const key = trackerKey(username);
  const entry = attempts.get(key) || { count: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  attempts.set(key, entry);
}

function recordSuccess(username) {
  attempts.delete(trackerKey(username));
}

async function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const separatorIndex = decoded.indexOf(':');
      const username = decoded.slice(0, separatorIndex);
      const password = decoded.slice(separatorIndex + 1);

      if (isLockedOut(username)) {
        return res.status(429).json({ error: 'Too many failed login attempts. Please try again in 15 minutes.' });
      }

      const result = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
      const user = result.rows[0];

      if (user && bcrypt.compareSync(password, user.password_hash)) {
        recordSuccess(username);
        req.user = { id: Number(user.id), username: user.username, role: user.role };
        return next();
      }

      recordFailure(username);
    } catch (err) {
      console.error('Auth error:', err);
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Horizon Inn Admin"');
  return res.status(401).json({ error: 'Authentication required' });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that' });
    }
    next();
  };
}

module.exports = adminAuth;
module.exports.requireRole = requireRole;
