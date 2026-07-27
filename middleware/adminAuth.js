const bcrypt = require('bcryptjs');
const { db } = require('../db');

async function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const separatorIndex = decoded.indexOf(':');
      const username = decoded.slice(0, separatorIndex);
      const password = decoded.slice(separatorIndex + 1);

      const result = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
      const user = result.rows[0];

      if (user && bcrypt.compareSync(password, user.password_hash)) {
        req.user = { id: Number(user.id), username: user.username, role: user.role };
        return next();
      }
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
