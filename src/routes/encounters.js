import { Router } from 'express';
import { camel, query, withTransaction } from '../db.js';
import { logActivity } from '../activity.js';
import { writeServiceLines } from '../billing.js';
import { requireRoles } from '../auth.js';
import { asyncHandler, clean, httpError } from '../http.js';

export const encounterRouter = Router();

function measurement(value, min, max, label, integer = false) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw httpError(400, `${label} looks out of range`);
  if (integer && !Number.isInteger(number)) throw httpError(400, `${label} must be a whole number`);
  return number;
}

async function loadEncounter(id) {
  const { rows } = await query(
    `SELECT e.*,
            p.mrn, p.first_name, p.last_name, p.date_of_birth, p.gender, p.phone, p.allergies, p.blood_type,
            a.scheduled_at, a.status AS appointment_status, a.reason,
            d.full_name AS doctor_name, d.specialty AS doctor_specialty
     FROM encounters e
     JOIN patients p ON p.id = e.patient_id
     JOIN appointments a ON a.id = e.appointment_id
     JOIN users d ON d.id = e.doctor_id
     WHERE e.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const vitals = await query(
    `SELECT v.*, u.full_name AS recorded_by_name
     FROM vitals v JOIN users u ON u.id = v.recorded_by
     WHERE v.encounter_id = $1
     ORDER BY v.recorded_at`,
    [id],
  );
  const services = await query(
    `SELECT es.id, es.service_id, es.quantity, es.unit_price, s.name, s.code, s.category
     FROM encounter_services es JOIN services s ON s.id = es.service_id
     WHERE es.encounter_id = $1
     ORDER BY s.name`,
    [id],
  );
  const prescriptions = await query(
    `SELECT p.id, p.status, p.notes, p.created_at, p.dispensed_at,
            COALESCE(items.items, '[]'::json) AS items
     FROM prescriptions p
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
         'id', pi.id,
         'medicationId', pi.medication_id,
         'medicationName', pi.medication_name,
         'dosage', pi.dosage,
         'frequency', pi.frequency,
         'duration', pi.duration,
         'quantity', pi.quantity,
         'instructions', pi.instructions
       ) ORDER BY pi.id) AS items
       FROM prescription_items pi
       WHERE pi.prescription_id = p.id
     ) items ON true
     WHERE p.encounter_id = $1`,
    [id],
  );
  const invoices = await query(
    `SELECT id, invoice_number, status, total, amount_paid, balance
     FROM invoice_balances
     WHERE encounter_id = $1 AND status <> 'void'`,
    [id],
  );
  return camel({
    ...rows[0],
    vitals: vitals.rows,
    services: services.rows,
    prescription: prescriptions.rows[0] || null,
    invoice: invoices.rows[0] || null,
  });
}

async function savePrescription(client, encounter, body, clinicianId) {
  const items = (Array.isArray(body?.items) ? body.items : []).filter((item) => clean(item.medicationName) || item.medicationId);
  const existing = await client.query('SELECT * FROM prescriptions WHERE encounter_id = $1 FOR UPDATE', [encounter.id]);
  if (existing.rows[0]?.status === 'dispensed') return;
  if (items.length === 0) {
    if (existing.rows[0]) {
      await client.query('DELETE FROM prescription_items WHERE prescription_id = $1', [existing.rows[0].id]);
      await client.query(`UPDATE prescriptions SET status = 'cancelled', notes = $2 WHERE id = $1`, [
        existing.rows[0].id,
        clean(body?.notes),
      ]);
    }
    return;
  }

  let prescriptionId = existing.rows[0]?.id;
  if (!prescriptionId) {
    const created = await client.query(
      `INSERT INTO prescriptions (encounter_id, patient_id, doctor_id, status, notes)
       VALUES ($1, $2, $3, 'issued', $4)
       RETURNING id`,
      [encounter.id, encounter.patient_id, clinicianId, clean(body?.notes)],
    );
    prescriptionId = created.rows[0].id;
  } else {
    await client.query(
      `UPDATE prescriptions SET status = 'issued', notes = $2, doctor_id = $3 WHERE id = $1`,
      [prescriptionId, clean(body?.notes), clinicianId],
    );
    await client.query('DELETE FROM prescription_items WHERE prescription_id = $1', [prescriptionId]);
  }

  for (const item of items) {
    const quantity = Number(item.quantity || 1);
    if (!Number.isInteger(quantity) || quantity <= 0) throw httpError(400, 'Medication quantity must be a positive whole number');
    let medicationId = item.medicationId ? Number(item.medicationId) : null;
    let name = clean(item.medicationName);
    if (medicationId) {
      const medication = await client.query(
        'SELECT name, strength FROM medications WHERE id = $1 AND is_active',
        [medicationId],
      );
      if (!medication.rows[0]) throw httpError(400, 'That medication is not in the catalog');
      name = name || `${medication.rows[0].name} ${medication.rows[0].strength || ''}`.trim();
    }
    if (!name) throw httpError(400, 'Each medication needs a name');
    await client.query(
      `INSERT INTO prescription_items (
         prescription_id, medication_id, medication_name, dosage, frequency, duration, quantity, instructions
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [prescriptionId, medicationId, name, clean(item.dosage), clean(item.frequency), clean(item.duration), quantity, clean(item.instructions)],
    );
  }
}

encounterRouter.get('/queue', requireRoles('nurse', 'doctor'), asyncHandler(async (req, res) => {
  const mine = req.query.mine === '1' && req.user.role === 'doctor' ? req.user.id : null;
  const { rows } = await query(
    `SELECT * FROM visit_board
     WHERE status IN ('checked_in', 'with_nurse', 'with_doctor')
       AND ($1::int IS NULL OR doctor_id = $1)
     ORDER BY scheduled_at`,
    [mine],
  );
  res.json({ queue: camel(rows) });
}));

encounterRouter.get('/:id', requireRoles('nurse', 'doctor', 'pharmacist'), asyncHandler(async (req, res) => {
  const encounter = await loadEncounter(req.params.id);
  if (!encounter) throw httpError(404, 'Visit not found');
  if (req.user.role === 'pharmacist') {
    encounter.clinicalNotes = null;
    encounter.diagnosis = null;
  }
  res.json({ encounter });
}));

encounterRouter.post('/:id/vitals', requireRoles('nurse', 'doctor'), asyncHandler(async (req, res) => {
  const temperature = measurement(req.body.temperature, 30, 45, 'Temperature');
  const systolic = measurement(req.body.systolic, 50, 250, 'Systolic pressure', true);
  const diastolic = measurement(req.body.diastolic, 30, 150, 'Diastolic pressure', true);
  const pulse = measurement(req.body.pulse, 20, 250, 'Pulse', true);
  const respiratoryRate = measurement(req.body.respiratoryRate, 5, 80, 'Respiratory rate', true);
  const weightKg = measurement(req.body.weightKg, 0.5, 400, 'Weight');
  const heightCm = measurement(req.body.heightCm, 30, 250, 'Height');
  const spo2 = measurement(req.body.spo2, 50, 100, 'Oxygen saturation', true);
  const notes = clean(req.body.notes);
  if ([temperature, systolic, diastolic, pulse, respiratoryRate, weightKg, heightCm, spo2].every((value) => value == null)) {
    throw httpError(400, 'Record at least one measurement');
  }

  await withTransaction(async (client) => {
    const found = await client.query(
      `SELECT e.id, e.status, a.id AS appointment_id, a.status AS appointment_status
       FROM encounters e JOIN appointments a ON a.id = e.appointment_id
       WHERE e.id = $1 FOR UPDATE`,
      [req.params.id],
    );
    const encounter = found.rows[0];
    if (!encounter) throw httpError(404, 'Visit not found');
    if (encounter.status === 'closed') throw httpError(409, 'This visit is already closed');
    await client.query(
      `INSERT INTO vitals (
         encounter_id, recorded_by, temperature, systolic, diastolic, pulse,
         respiratory_rate, weight_kg, height_cm, spo2, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [encounter.id, req.user.id, temperature, systolic, diastolic, pulse, respiratoryRate, weightKg, heightCm, spo2, notes],
    );
    if (encounter.appointment_status === 'checked_in') {
      await client.query(`UPDATE appointments SET status = 'with_nurse' WHERE id = $1`, [encounter.appointment_id]);
    }
    await logActivity(client, {
      actorId: req.user.id,
      action: 'vitals',
      entity: 'encounter',
      entityId: encounter.id,
    });
  });

  res.status(201).json({ encounter: await loadEncounter(req.params.id) });
}));

encounterRouter.put('/:id', requireRoles('doctor'), asyncHandler(async (req, res) => {
  const complete = Boolean(req.body.complete);
  const diagnosis = clean(req.body.diagnosis);
  const chiefComplaint = clean(req.body.chiefComplaint);
  const clinicalNotes = clean(req.body.clinicalNotes);
  if (clinicalNotes && clinicalNotes.length > 4000) throw httpError(400, 'Clinical notes are too long');

  await withTransaction(async (client) => {
    const found = await client.query(
      `SELECT e.*, a.status AS appointment_status
       FROM encounters e JOIN appointments a ON a.id = e.appointment_id
       WHERE e.id = $1 FOR UPDATE OF e, a`,
      [req.params.id],
    );
    const encounter = found.rows[0];
    if (!encounter) throw httpError(404, 'Visit not found');
    if (encounter.status === 'closed') throw httpError(409, 'This visit is already closed');

    await client.query(
      `UPDATE encounters
       SET chief_complaint = COALESCE($2, chief_complaint),
           diagnosis = $3,
           clinical_notes = $4
       WHERE id = $1`,
      [encounter.id, chiefComplaint, diagnosis, clinicalNotes],
    );

    if (Array.isArray(req.body.services)) {
      await client.query('DELETE FROM encounter_services WHERE encounter_id = $1', [encounter.id]);
      for (const line of req.body.services) {
        const service = await client.query(
          'SELECT id, price, is_active FROM services WHERE id = $1',
          [line.serviceId],
        );
        if (!service.rows[0]?.is_active) throw httpError(400, 'One of the selected services is not available');
        const quantity = Number(line.quantity || 1);
        if (!Number.isInteger(quantity) || quantity <= 0) throw httpError(400, 'Service quantity must be a positive whole number');
        await client.query(
          `INSERT INTO encounter_services (encounter_id, service_id, quantity, unit_price)
           VALUES ($1, $2, $3, $4)`,
          [encounter.id, service.rows[0].id, quantity, service.rows[0].price],
        );
      }
    }

    if (req.body.prescription) {
      const clinicianId = req.user.role === 'doctor' ? req.user.id : encounter.doctor_id;
      await savePrescription(client, encounter, req.body.prescription, clinicianId);
    }

    if (complete) {
      if (!diagnosis) throw httpError(400, 'Add a diagnosis before closing the visit');
      const services = await client.query(
        'SELECT COUNT(*)::int AS count FROM encounter_services WHERE encounter_id = $1',
        [encounter.id],
      );
      if (services.rows[0].count < 1) throw httpError(400, 'Add at least one service before closing the visit');
      await client.query(`UPDATE encounters SET status = 'closed', closed_at = now() WHERE id = $1`, [encounter.id]);
      await client.query(`UPDATE appointments SET status = 'completed' WHERE id = $1`, [encounter.appointment_id]);
      await writeServiceLines(client, encounter.id, req.user.id);
      await logActivity(client, {
        actorId: req.user.id,
        action: 'close_visit',
        entity: 'encounter',
        entityId: encounter.id,
        detail: diagnosis,
      });
    } else if (['checked_in', 'with_nurse', 'with_doctor'].includes(encounter.appointment_status)) {
      await client.query(`UPDATE appointments SET status = 'with_doctor' WHERE id = $1`, [encounter.appointment_id]);
    }
  });

  res.json({ encounter: await loadEncounter(req.params.id) });
}));
