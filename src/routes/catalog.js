import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { camel, query } from '../db.js';
import { requireRoles } from '../auth.js';
import { asyncHandler, clean, httpError } from '../http.js';

export const catalogRouter = Router();

const ROLES = ['admin', 'receptionist', 'nurse', 'doctor', 'pharmacist', 'accountant'];
const CATEGORIES = ['consultation', 'procedure', 'lab'];

catalogRouter.get('/doctors', requireRoles('receptionist', 'nurse', 'doctor', 'accountant'), asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT id, full_name, specialty FROM users WHERE role = 'doctor' AND is_active ORDER BY full_name`,
  );
  res.json({ doctors: camel(rows) });
}));

catalogRouter.get('/services', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM services WHERE ($1::boolean IS TRUE OR is_active) ORDER BY category, name`,
    [req.query.all === '1' && ['admin', 'accountant'].includes(req.user.role)],
  );
  res.json({ services: camel(rows) });
}));

catalogRouter.post('/services', requireRoles('accountant'), asyncHandler(async (req, res) => {
  const service = readService(req.body);
  const { rows } = await query(
    `INSERT INTO services (code, name, category, price) VALUES ($1, $2, $3, $4) RETURNING *`,
    [service.code, service.name, service.category, service.price],
  );
  res.status(201).json({ service: camel(rows[0]) });
}));

catalogRouter.patch('/services/:id', requireRoles('accountant'), asyncHandler(async (req, res) => {
  const service = readService(req.body, true);
  const { rows } = await query(
    `UPDATE services
     SET name = COALESCE($2, name),
         category = COALESCE($3, category),
         price = COALESCE($4, price),
         is_active = COALESCE($5, is_active)
     WHERE id = $1
     RETURNING *`,
    [req.params.id, service.name, service.category, service.price, req.body.isActive],
  );
  if (!rows[0]) throw httpError(404, 'Service not found');
  res.json({ service: camel(rows[0]) });
}));

catalogRouter.get('/staff', requireRoles(), asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT id, full_name, email, role, phone, specialty, is_active, created_at
     FROM users ORDER BY role, full_name`,
  );
  res.json({ staff: camel(rows) });
}));

catalogRouter.post('/staff', requireRoles(), asyncHandler(async (req, res) => {
  const fullName = clean(req.body.fullName);
  const email = clean(req.body.email)?.toLowerCase();
  const role = clean(req.body.role);
  const password = String(req.body.password || '');
  if (!fullName || !email || !ROLES.includes(role)) throw httpError(400, 'Name, email, and a valid role are required');
  if (password.length < 8) throw httpError(400, 'Use a password of at least 8 characters');
  const { rows } = await query(
    `INSERT INTO users (full_name, email, password_hash, role, phone, specialty)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, full_name, email, role, phone, specialty, is_active`,
    [fullName, email, await bcrypt.hash(password, 10), role, clean(req.body.phone), clean(req.body.specialty)],
  );
  res.status(201).json({ staff: camel(rows[0]) });
}));

catalogRouter.patch('/staff/:id', requireRoles(), asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.user.id && req.body.isActive === false) {
    throw httpError(409, 'You cannot disable your own account');
  }
  const role = clean(req.body.role);
  if (role && !ROLES.includes(role)) throw httpError(400, 'Choose a valid role');
  const password = req.body.password ? String(req.body.password) : null;
  if (password && password.length < 8) throw httpError(400, 'Use a password of at least 8 characters');
  const { rows } = await query(
    `UPDATE users
     SET full_name = COALESCE($2, full_name),
         role = COALESCE($3, role),
         phone = COALESCE($4, phone),
         specialty = COALESCE($5, specialty),
         is_active = COALESCE($6, is_active),
         password_hash = COALESCE($7, password_hash)
     WHERE id = $1
     RETURNING id, full_name, email, role, phone, specialty, is_active`,
    [
      req.params.id,
      clean(req.body.fullName),
      role,
      clean(req.body.phone),
      clean(req.body.specialty),
      req.body.isActive,
      password ? await bcrypt.hash(password, 10) : null,
    ],
  );
  if (!rows[0]) throw httpError(404, 'Staff member not found');
  res.json({ staff: camel(rows[0]) });
}));

function readService(body, partial = false) {
  const name = clean(body.name);
  const code = clean(body.code)?.toUpperCase();
  const category = clean(body.category);
  const price = body.price === undefined || body.price === '' ? null : Number(body.price);
  if (!partial && (!name || !code || !CATEGORIES.includes(category))) {
    throw httpError(400, 'Code, name, and category are required');
  }
  if (category && !CATEGORIES.includes(category)) throw httpError(400, 'Choose a service category');
  if (price != null && (!Number.isFinite(price) || price < 0)) throw httpError(400, 'Enter a valid price');
  return { name, code, category, price };
}

export const dashboardRouter = Router();

dashboardRouter.get('/', asyncHandler(async (req, res) => {
  const tz = config.clinicTz;
  const role = req.user.role;
  const [today, waiting, toDispense, openInvoices, lowStockCount, revenue, schedule, queue, stock, activity] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS count FROM appointments
       WHERE (scheduled_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date
         AND status <> 'cancelled'`,
      [tz],
    ),
    query(
      `SELECT COUNT(*)::int AS count FROM appointments WHERE status IN ('checked_in', 'with_nurse', 'with_doctor')`,
    ),
    query(`SELECT COUNT(*)::int AS count FROM prescriptions WHERE status = 'issued'`),
    query(`SELECT COUNT(*)::int AS count FROM invoices WHERE status IN ('issued', 'partial')`),
    query(`SELECT COUNT(*)::int AS count FROM low_stock`),
    query(
      `SELECT COALESCE(SUM(amount), 0) AS revenue FROM payments
       WHERE (paid_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date`,
      [tz],
    ),
    query(
      `SELECT appointment_id, scheduled_at, status, reason, mrn, first_name, last_name, doctor_name, doctor_id
       FROM visit_board
       WHERE (scheduled_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date
       ORDER BY scheduled_at
       LIMIT 12`,
      [tz],
    ),
    query(
      `SELECT appointment_id, encounter_id, scheduled_at, status, reason, first_name, last_name, doctor_name
       FROM visit_board
       WHERE status IN ('checked_in', 'with_nurse', 'with_doctor')
       ORDER BY scheduled_at
       LIMIT 8`,
    ),
    query(`SELECT * FROM low_stock ORDER BY quantity_on_hand LIMIT 6`),
    query(
      `SELECT a.action, a.detail, a.created_at, u.full_name AS actor_name
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.created_at DESC
       LIMIT 8`,
    ),
  ]);

  const seesMoney = ['admin', 'receptionist', 'accountant'].includes(role);
  const seesQueue = ['admin', 'receptionist', 'nurse', 'doctor'].includes(role);
  const seesStock = ['admin', 'pharmacist'].includes(role);

  res.json({
    counts: {
      today: today.rows[0].count,
      waiting: waiting.rows[0].count,
      toDispense: seesStock || role === 'doctor' || role === 'admin' ? toDispense.rows[0].count : null,
      openInvoices: seesMoney ? openInvoices.rows[0].count : null,
      lowStock: seesStock ? lowStockCount.rows[0].count : null,
    },
    revenueToday: seesMoney ? revenue.rows[0].revenue : null,
    schedule: seesQueue || role === 'accountant' ? camel(schedule.rows) : null,
    queue: seesQueue ? camel(queue.rows) : [],
    lowStock: seesStock ? camel(stock.rows) : [],
    activity: ['admin', 'receptionist', 'accountant'].includes(role) ? camel(activity.rows) : [],
  });
}));
