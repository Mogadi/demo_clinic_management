import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { query } from '../db.js';
import { asyncHandler, httpError } from '../http.js';
import { publicUser, requireAuth, signToken } from '../auth.js';

export const authRouter = Router();

authRouter.get('/meta', (_req, res) => {
  res.json({
    name: config.clinicName,
    timezone: config.clinicTz,
    currency: config.currency,
  });
});

authRouter.post('/login', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const { rows } = await query(
    'SELECT id, full_name, email, role, phone, specialty, is_active, password_hash FROM users WHERE email = $1',
    [email],
  );
  const user = rows[0];
  const matches = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !matches) throw httpError(401, 'Email or password is incorrect');
  if (!user.is_active) throw httpError(403, 'This account is disabled');
  res.json({
    token: signToken(user),
    user: publicUser(user),
    clinic: { name: config.clinicName, timezone: config.clinicTz, currency: config.currency },
  });
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({
    user: req.user,
    clinic: { name: config.clinicName, timezone: config.clinicTz, currency: config.currency },
  });
}));
