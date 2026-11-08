import { Router } from 'express';
import { camel, query, withTransaction } from '../db.js';
import { logActivity } from '../activity.js';
import { requireRoles } from '../auth.js';
import { asyncHandler, clean, httpError } from '../http.js';

export const patientRouter = Router();

const GENDERS = ['female', 'male', 'other', 'unknown'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function readPatient(body) {
  const firstName = clean(body.firstName);
  const lastName = clean(body.lastName);
  const phone = clean(body.phone);
  if (!firstName || !lastName) throw httpError(400, 'First and last name are required');
  if (!phone) throw httpError(400, 'A phone number is required');
  const gender = clean(body.gender);
  if (gender && !GENDERS.includes(gender)) throw httpError(400, 'Choose a gender from the list');
  const bloodType = clean(body.bloodType);
  if (bloodType && !BLOOD.includes(bloodType)) throw httpError(400, 'Choose a blood type from the list');
  const dateOfBirth = clean(body.dateOfBirth);
  if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) throw httpError(400, 'Use a real date of birth');
  return {
    firstName,
    lastName,
    phone,
    gender,
    bloodType,
    dateOfBirth,
    email: clean(body.email)?.toLowerCase() || null,
    address: clean(body.address),
    allergies: clean(body.allergies),
    emergencyName: clean(body.emergencyName),
    emergencyPhone: clean(body.emergencyPhone),
  };
}

patientRouter.get('/', asyncHandler(async (req, res) => {
  const term = clean(req.query.q);
  const { rows } = await query(
    `SELECT id, mrn, first_name, last_name, date_of_birth, gender, phone, email, allergies
     FROM patients
     WHERE ($1::text IS NULL
        OR mrn ILIKE $1
        OR first_name ILIKE $1
        OR last_name ILIKE $1
        OR phone ILIKE $1
        OR (first_name || ' ' || last_name) ILIKE $1)
     ORDER BY last_name, first_name
     LIMIT 100`,
    [term ? `%${term}%` : null],
  );
  res.json({ patients: camel(rows) });
}));

patientRouter.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM patients WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw httpError(404, 'Patient not found');
  const clinical = ['admin', 'doctor', 'nurse'].includes(req.user.role);
  const seesMoney = ['admin', 'receptionist', 'accountant'].includes(req.user.role);
  const visits = await query(
    `SELECT appointment_id, scheduled_at, status, reason, doctor_name, doctor_specialty, encounter_id,
            CASE WHEN $2 THEN diagnosis ELSE NULL END AS diagnosis
     FROM visit_board
     WHERE patient_id = $1
     ORDER BY scheduled_at DESC`,
    [req.params.id, clinical],
  );
  const invoices = seesMoney
    ? await query(
      `SELECT b.id, b.invoice_number, b.status, b.total, b.amount_paid, b.balance, b.created_at
       FROM invoice_balances b
       WHERE b.patient_id = $1
       ORDER BY b.created_at DESC`,
      [req.params.id],
    )
    : { rows: [] };
  res.json({ patient: camel(rows[0]), visits: camel(visits.rows), invoices: camel(invoices.rows) });
}));

patientRouter.post('/', requireRoles('receptionist', 'nurse', 'doctor'), asyncHandler(async (req, res) => {
  const input = readPatient(req.body);
  const created = await withTransaction(async (client) => {
    const mrn = (await client.query(`SELECT 'CLN-' || nextval('patient_mrn_seq') AS mrn`)).rows[0].mrn;
    const { rows } = await client.query(
      `INSERT INTO patients (
         mrn, first_name, last_name, date_of_birth, gender, phone, email, address,
         blood_type, allergies, emergency_name, emergency_phone
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        mrn, input.firstName, input.lastName, input.dateOfBirth, input.gender, input.phone,
        input.email, input.address, input.bloodType, input.allergies, input.emergencyName, input.emergencyPhone,
      ],
    );
    await logActivity(client, {
      actorId: req.user.id,
      action: 'register',
      entity: 'patient',
      entityId: rows[0].id,
      detail: `${input.firstName} ${input.lastName} (${mrn})`,
    });
    return rows[0];
  });
  res.status(201).json({ patient: camel(created) });
}));

patientRouter.patch('/:id', requireRoles('receptionist', 'nurse', 'doctor'), asyncHandler(async (req, res) => {
  const input = readPatient(req.body);
  const { rows } = await query(
    `UPDATE patients SET
       first_name = $2, last_name = $3, date_of_birth = $4, gender = $5, phone = $6, email = $7,
       address = $8, blood_type = $9, allergies = $10, emergency_name = $11, emergency_phone = $12
     WHERE id = $1
     RETURNING *`,
    [
      req.params.id, input.firstName, input.lastName, input.dateOfBirth, input.gender, input.phone,
      input.email, input.address, input.bloodType, input.allergies, input.emergencyName, input.emergencyPhone,
    ],
  );
  if (!rows[0]) throw httpError(404, 'Patient not found');
  res.json({ patient: camel(rows[0]) });
}));
