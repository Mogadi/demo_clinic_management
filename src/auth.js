import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query } from './db.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.full_name }, config.jwtSecret, { expiresIn: '12h' });
}

export function publicUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    phone: row.phone,
    specialty: row.specialty,
    isActive: row.is_active,
  };
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const { rows } = await query(
      'SELECT id, full_name, email, role, phone, specialty, is_active FROM users WHERE id = $1',
      [payload.sub],
    );
    const user = rows[0];
    if (!user || !user.is_active) return res.status(401).json({ error: 'This account is disabled' });
    req.user = publicUser(user);
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Your role cannot do that' });
  };
}
