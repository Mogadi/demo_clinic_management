import { Router } from 'express';
import { camel, query, withTransaction } from '../db.js';
import { logActivity } from '../activity.js';
import { requireRoles } from '../auth.js';
import { asyncHandler, clean, httpError } from '../http.js';

export const billingRouter = Router();

const METHODS = ['cash', 'card', 'insurance', 'transfer'];

billingRouter.get('/invoices', requireRoles('receptionist', 'accountant'), asyncHandler(async (req, res) => {
  const status = clean(req.query.status);
  const { rows } = await query(
    `SELECT b.*, p.first_name, p.last_name, p.mrn
     FROM invoice_balances b
     JOIN patients p ON p.id = b.patient_id
     WHERE (
       $1::text IS NULL
       OR ($1 = 'open' AND b.status IN ('issued', 'partial'))
       OR b.status = $1
     )
     ORDER BY b.created_at DESC
     LIMIT 100`,
    [status],
  );
  res.json({ invoices: camel(rows) });
}));

billingRouter.get('/invoices/:id', requireRoles('receptionist', 'accountant'), asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req.params.id);
  if (!invoice) throw httpError(404, 'Invoice not found');
  res.json({ invoice });
}));

billingRouter.post('/invoices/:id/payments', requireRoles('receptionist', 'accountant'), asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  const method = clean(req.body.method);
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'Enter a payment amount');
  if (!METHODS.includes(method)) throw httpError(400, 'Choose a payment method');

  await withTransaction(async (client) => {
    const found = await client.query('SELECT id, invoice_number, status FROM invoices WHERE id = $1', [req.params.id]);
    if (!found.rows[0]) throw httpError(404, 'Invoice not found');
    await client.query(
      `INSERT INTO payments (invoice_id, amount, method, reference, received_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, amount, method, clean(req.body.reference), req.user.id],
    );
    await logActivity(client, {
      actorId: req.user.id,
      action: 'payment',
      entity: 'invoice',
      entityId: Number(req.params.id),
      detail: `${found.rows[0].invoice_number} ${method}`,
    });
  });

  res.status(201).json({ invoice: await loadInvoice(req.params.id) });
}));

billingRouter.post('/invoices/:id/void', requireRoles('accountant'), asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const found = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!found.rows[0]) throw httpError(404, 'Invoice not found');
    if (found.rows[0].status === 'void') return;
    const payments = await client.query('SELECT COUNT(*)::int AS count FROM payments WHERE invoice_id = $1', [req.params.id]);
    if (payments.rows[0].count > 0) throw httpError(409, 'Void is only available before a payment is taken');
    await client.query(`UPDATE invoices SET status = 'void' WHERE id = $1`, [req.params.id]);
    await logActivity(client, {
      actorId: req.user.id,
      action: 'void_invoice',
      entity: 'invoice',
      entityId: Number(req.params.id),
      detail: found.rows[0].invoice_number,
    });
  });
  res.json({ invoice: await loadInvoice(req.params.id) });
}));

async function loadInvoice(id) {
  const { rows } = await query(
    `SELECT b.*, p.first_name, p.last_name, p.mrn, p.phone
     FROM invoice_balances b
     JOIN patients p ON p.id = b.patient_id
     WHERE b.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const lines = await query(
    `SELECT id, kind, description, quantity, unit_price, line_total
     FROM invoice_lines WHERE invoice_id = $1 ORDER BY id`,
    [id],
  );
  const payments = await query(
    `SELECT pay.id, pay.amount, pay.method, pay.reference, pay.paid_at, u.full_name AS received_by_name
     FROM payments pay
     LEFT JOIN users u ON u.id = pay.received_by
     WHERE pay.invoice_id = $1
     ORDER BY pay.paid_at`,
    [id],
  );
  return camel({ ...rows[0], lines: lines.rows, payments: payments.rows });
}
