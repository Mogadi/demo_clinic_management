import { Router } from 'express';
import { camel, query, withTransaction } from '../db.js';
import { logActivity } from '../activity.js';
import { syncMedicationCharges } from '../billing.js';
import { requireRoles } from '../auth.js';
import { asyncHandler, clean, httpError } from '../http.js';

export const pharmacyRouter = Router();

const itemAggregate = `
  COALESCE((
    SELECT json_agg(json_build_object(
      'id', pi.id,
      'medicationId', pi.medication_id,
      'medicationName', pi.medication_name,
      'dosage', pi.dosage,
      'frequency', pi.frequency,
      'duration', pi.duration,
      'quantity', pi.quantity,
      'instructions', pi.instructions,
      'onHand', m.quantity_on_hand
    ) ORDER BY pi.id)
    FROM prescription_items pi
    LEFT JOIN medications m ON m.id = pi.medication_id
    WHERE pi.prescription_id = p.id
  ), '[]'::json) AS items
`;

pharmacyRouter.get('/prescriptions', requireRoles('doctor', 'pharmacist'), asyncHandler(async (req, res) => {
  const status = clean(req.query.status);
  const { rows } = await query(
    `SELECT p.id, p.status, p.notes, p.created_at, p.dispensed_at, p.encounter_id,
            pat.id AS patient_id, pat.mrn, pat.first_name, pat.last_name, pat.allergies,
            doc.full_name AS doctor_name,
            ${itemAggregate}
     FROM prescriptions p
     JOIN patients pat ON pat.id = p.patient_id
     JOIN users doc ON doc.id = p.doctor_id
     WHERE ($1::text IS NULL OR p.status = $1)
     ORDER BY p.created_at DESC
     LIMIT 50`,
    [status],
  );
  res.json({ prescriptions: camel(rows) });
}));

pharmacyRouter.post('/prescriptions/:id/dispense', requireRoles('pharmacist'), asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const found = await client.query('SELECT * FROM prescriptions WHERE id = $1 FOR UPDATE', [req.params.id]);
    const prescription = found.rows[0];
    if (!prescription) throw httpError(404, 'Prescription not found');
    if (prescription.status !== 'issued') throw httpError(409, 'Only an issued prescription can be dispensed');
    const items = await client.query('SELECT * FROM prescription_items WHERE prescription_id = $1', [prescription.id]);
    if (items.rows.length === 0) throw httpError(409, 'This prescription has no medications');

    for (const item of items.rows) {
      if (!item.medication_id) continue;
      const medication = await client.query(
        'SELECT id, name, quantity_on_hand FROM medications WHERE id = $1 FOR UPDATE',
        [item.medication_id],
      );
      if (!medication.rows[0]) throw httpError(409, `${item.medication_name} is no longer stocked`);
      if (medication.rows[0].quantity_on_hand < item.quantity) {
        throw httpError(409, `Not enough ${medication.rows[0].name} on hand (${medication.rows[0].quantity_on_hand} left, ${item.quantity} needed)`);
      }
      await client.query(
        'UPDATE medications SET quantity_on_hand = quantity_on_hand - $2 WHERE id = $1',
        [item.medication_id, item.quantity],
      );
      await client.query(
        `INSERT INTO stock_movements (medication_id, change_qty, reason, prescription_id, created_by)
         VALUES ($1, $2, 'dispense', $3, $4)`,
        [item.medication_id, -item.quantity, prescription.id, req.user.id],
      );
    }

    await client.query(
      `UPDATE prescriptions SET status = 'dispensed', dispensed_at = now(), dispensed_by = $2 WHERE id = $1`,
      [prescription.id, req.user.id],
    );
    await syncMedicationCharges(client, prescription.encounter_id, req.user.id);
    await logActivity(client, {
      actorId: req.user.id,
      action: 'dispense',
      entity: 'prescription',
      entityId: prescription.id,
    });
  });

  const { rows } = await query(
    `SELECT p.id, p.status, p.encounter_id, ${itemAggregate}
     FROM prescriptions p WHERE p.id = $1`,
    [req.params.id],
  );
  res.json({ prescription: camel(rows[0]) });
}));

pharmacyRouter.get('/medications', requireRoles('doctor', 'pharmacist', 'accountant'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM medications WHERE ($1::boolean IS TRUE OR is_active) ORDER BY name`,
    [req.query.all === '1'],
  );
  res.json({ medications: camel(rows) });
}));

pharmacyRouter.post('/medications', requireRoles('pharmacist'), asyncHandler(async (req, res) => {
  const name = clean(req.body.name);
  const sku = clean(req.body.sku)?.toUpperCase();
  const unitPrice = Number(req.body.unitPrice);
  const quantity = Number(req.body.quantityOnHand ?? 0);
  const reorderLevel = Number(req.body.reorderLevel ?? 0);
  if (!name || !sku) throw httpError(400, 'Name and SKU are required');
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw httpError(400, 'Enter a valid price');
  if (!Number.isInteger(quantity) || quantity < 0) throw httpError(400, 'Quantity on hand must be a whole number');
  if (!Number.isInteger(reorderLevel) || reorderLevel < 0) throw httpError(400, 'Reorder level must be a whole number');

  const { rows } = await query(
    `INSERT INTO medications (
       sku, name, form, strength, unit_price, quantity_on_hand, reorder_level,
       generic_name, manufacturer, supplier, batch_number, expiry_date, storage_location
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      sku, name, clean(req.body.form), clean(req.body.strength), unitPrice, quantity, reorderLevel,
      clean(req.body.genericName), clean(req.body.manufacturer), clean(req.body.supplier),
      clean(req.body.batchNumber), clean(req.body.expiryDate), clean(req.body.storageLocation),
    ],
  );
  res.status(201).json({ medication: camel(rows[0]) });
}));

pharmacyRouter.post('/medications/:id/receive', requireRoles('pharmacist'), asyncHandler(async (req, res) => {
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) throw httpError(400, 'Enter how many units arrived');
  const note = clean(req.body.note);

  const medication = await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE medications SET quantity_on_hand = quantity_on_hand + $2
       WHERE id = $1
       RETURNING *`,
      [req.params.id, quantity],
    );
    if (!updated.rows[0]) throw httpError(404, 'Medication not found');
    await client.query(
      `INSERT INTO stock_movements (medication_id, change_qty, reason, note, created_by)
       VALUES ($1, $2, 'receive', $3, $4)`,
      [req.params.id, quantity, note, req.user.id],
    );
    await logActivity(client, {
      actorId: req.user.id,
      action: 'receive_stock',
      entity: 'medication',
      entityId: updated.rows[0].id,
      detail: `${updated.rows[0].name} +${quantity}`,
    });
    return updated.rows[0];
  });
  res.json({ medication: camel(medication) });
}));
