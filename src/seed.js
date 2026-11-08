import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { query, withTransaction } from './db.js';
import { logActivity } from './activity.js';
import { syncMedicationCharges, writeServiceLines } from './billing.js';

const DEMO_PASSWORD = 'Clinic123!';

export async function seedIfEmpty() {
  const existing = await query('SELECT COUNT(*)::int AS count FROM users');
  if (existing.rows[0].count > 0) return false;

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  await withTransaction(async (client) => {
    const users = {};
    async function addUser(fullName, email, role, specialty, phone) {
      const { rows } = await client.query(
        `INSERT INTO users (full_name, email, password_hash, role, specialty, phone)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [fullName, email, passwordHash, role, specialty, phone],
      );
      users[email] = rows[0].id;
    }

    await addUser('Aline Uwase', 'admin@harborlight.clinic', 'admin', null, '+250788000001');
    await addUser('Eric Habimana', 'desk@harborlight.clinic', 'receptionist', null, '+250788000002');
    await addUser('Diane Mukamana', 'nurse@harborlight.clinic', 'nurse', null, '+250788000003');
    await addUser('Dr. Amira Hassan', 'amira@harborlight.clinic', 'doctor', 'General practice', '+250788000004');
    await addUser('Dr. Omar Khalid', 'omar@harborlight.clinic', 'doctor', 'Pediatrics', '+250788000005');
    await addUser('Patrick Ndayisaba', 'pharmacy@harborlight.clinic', 'pharmacist', null, '+250788000006');
    await addUser('Grace Ingabire', 'accounts@harborlight.clinic', 'accountant', null, '+250788000007');

    const services = {};
    const serviceRows = [
      ['CONS-GP', 'General consultation', 'consultation', 15000],
      ['CONS-PD', 'Pediatric consultation', 'consultation', 12000],
      ['PROC-WD', 'Wound dressing', 'procedure', 8000],
      ['LAB-CBC', 'Complete blood count', 'lab', 7000],
      ['LAB-ECG', 'Electrocardiogram', 'lab', 10000],
    ];
    for (const [code, name, category, price] of serviceRows) {
      const { rows } = await client.query(
        `INSERT INTO services (code, name, category, price) VALUES ($1, $2, $3, $4) RETURNING id`,
        [code, name, category, price],
      );
      services[code] = rows[0].id;
    }

    const meds = {};
    const medicationRows = [
      ['PARA-500', 'Paracetamol', 'tablet', '500 mg', 100, 200, 40],
      ['AMOX-500', 'Amoxicillin', 'capsule', '500 mg', 250, 40, 24],
      ['LORA-10', 'Loratadine', 'tablet', '10 mg', 150, 90, 20],
      ['ORS-1', 'Oral rehydration salts', 'sachet', '1 sachet', 300, 60, 20],
      ['ZINC-SYR', 'Zinc syrup', 'syrup', '20 mg/5 ml', 4500, 4, 12],
      ['IBUP-200', 'Ibuprofen', 'tablet', '200 mg', 120, 120, 30],
    ];
    for (const [sku, name, form, strength, unitPrice, onHand, reorder] of medicationRows) {
      const { rows } = await client.query(
        `INSERT INTO medications (sku, name, form, strength, unit_price, quantity_on_hand, reorder_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [sku, name, form, strength, unitPrice, onHand, reorder],
      );
      meds[sku] = rows[0].id;
    }

    async function addPatient(first, last, dob, gender, phone, address, blood, allergies, emergencyName, emergencyPhone) {
      const mrn = (await client.query(`SELECT 'CLN-' || nextval('patient_mrn_seq') AS mrn`)).rows[0].mrn;
      const { rows } = await client.query(
        `INSERT INTO patients (
           mrn, first_name, last_name, date_of_birth, gender, phone, address, blood_type, allergies, emergency_name, emergency_phone
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [mrn, first, last, dob, gender, phone, address, blood, allergies, emergencyName, emergencyPhone],
      );
      return rows[0].id;
    }

    const layla = await addPatient('Layla', 'Nasser', '1994-04-12', 'female', '+250788110001', 'Nyamirambo, Kigali', 'O+', 'penicillin', 'Nadia Nasser', '+250788110009');
    const yusuf = await addPatient('Yusuf', 'Rahman', '1982-11-02', 'male', '+250788110002', 'Kimihurura, Kigali', 'A+', null, 'Amina Rahman', '+250788110008');
    const hana = await addPatient('Hana', 'Idris', '2018-06-19', 'female', '+250788110003', 'Remera, Kigali', null, 'peanuts', 'Samira Idris', '+250788110007');
    const malik = await addPatient('Malik', 'Okonkwo', '1975-01-28', 'male', '+250788110004', 'Kicukiro, Kigali', 'B+', null, 'Ada Okonkwo', '+250788110006');
    const sofia = await addPatient('Sofia', 'Alvarez', '1990-09-09', 'female', '+250788110005', 'Nyarutarama, Kigali', 'AB+', 'ibuprofen', 'Luis Alvarez', '+250788110010');
    const jonah = await addPatient('Jonah', 'Berg', '2001-02-14', 'male', '+250788110011', 'Gisozi, Kigali', 'O-', null, 'Marta Berg', '+250788110012');
    const priya = await addPatient('Priya', 'Shah', '1988-12-01', 'female', '+250788110013', 'Kanombe, Kigali', 'A-', null, 'Ravi Shah', '+250788110014');
    const elias = await addPatient('Elias', 'Moreau', '2021-08-23', 'male', '+250788110015', 'Muhima, Kigali', null, null, 'Claire Moreau', '+250788110016');

    async function book({ patientId, doctorEmail, day, hour, minute, reason, status, by }) {
      const { rows } = await client.query(
        `INSERT INTO appointments (patient_id, doctor_id, scheduled_at, duration_min, reason, status, created_by)
         VALUES (
           $1, $2,
           ((date_trunc('day', now() AT TIME ZONE $3)
             + make_interval(days => $4, hours => $5, mins => $6)) AT TIME ZONE $3),
           30, $7, $8, $9
         )
         RETURNING id, scheduled_at`,
        [patientId, users[doctorEmail], config.clinicTz, day, hour, minute, reason, status, users[by]],
      );
      return rows[0];
    }

    const laylaVisit = await book({
      patientId: layla, doctorEmail: 'amira@harborlight.clinic', day: 0, hour: 8, minute: 30,
      reason: 'Sneezing and itchy eyes', status: 'completed', by: 'desk@harborlight.clinic',
    });
    const jonahVisit = await book({
      patientId: jonah, doctorEmail: 'amira@harborlight.clinic', day: 0, hour: 9, minute: 15,
      reason: 'Cough and fever for three days', status: 'completed', by: 'desk@harborlight.clinic',
    });
    const yusufVisit = await book({
      patientId: yusuf, doctorEmail: 'amira@harborlight.clinic', day: 0, hour: 10, minute: 0,
      reason: 'Chest tightness on climbing stairs', status: 'with_doctor', by: 'desk@harborlight.clinic',
    });
    await book({
      patientId: hana, doctorEmail: 'omar@harborlight.clinic', day: 0, hour: 10, minute: 45,
      reason: 'Vaccination follow-up', status: 'checked_in', by: 'desk@harborlight.clinic',
    });
    await book({
      patientId: malik, doctorEmail: 'amira@harborlight.clinic', day: 0, hour: 11, minute: 30,
      reason: 'Blood pressure review', status: 'scheduled', by: 'desk@harborlight.clinic',
    });
    await book({
      patientId: elias, doctorEmail: 'omar@harborlight.clinic', day: 0, hour: 14, minute: 0,
      reason: 'Fever and poor feeding', status: 'scheduled', by: 'desk@harborlight.clinic',
    });
    await book({
      patientId: sofia, doctorEmail: 'amira@harborlight.clinic', day: 1, hour: 9, minute: 0,
      reason: 'Rash on both arms', status: 'scheduled', by: 'desk@harborlight.clinic',
    });
    await book({
      patientId: priya, doctorEmail: 'omar@harborlight.clinic', day: -1, hour: 9, minute: 0,
      reason: 'Well-child visit', status: 'no_show', by: 'desk@harborlight.clinic',
    });

    async function openEncounter(appointment, patientId, doctorEmail, complaint, status) {
      const { rows } = await client.query(
        `INSERT INTO encounters (appointment_id, patient_id, doctor_id, chief_complaint, status, closed_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 'closed' THEN $6::timestamptz ELSE NULL END)
         RETURNING id`,
        [appointment.id, patientId, users[doctorEmail], complaint, status, appointment.scheduled_at],
      );
      return rows[0].id;
    }

    const laylaEncounter = await openEncounter(laylaVisit, layla, 'amira@harborlight.clinic', 'Sneezing and itchy eyes', 'closed');
    await client.query(
      `UPDATE encounters SET diagnosis = $2, clinical_notes = $3 WHERE id = $1`,
      [laylaEncounter, 'Allergic rhinitis', 'No fever. Avoid the known penicillin allergy. Loratadine for ten days.'],
    );
    await client.query(
      `INSERT INTO encounter_services (encounter_id, service_id, quantity, unit_price)
       VALUES ($1, $2, 1, 15000)`,
      [laylaEncounter, services['CONS-GP']],
    );
    const laylaRx = await client.query(
      `INSERT INTO prescriptions (encounter_id, patient_id, doctor_id, status, dispensed_at, dispensed_by)
       VALUES ($1, $2, $3, 'dispensed', $4::timestamptz, $5)
       RETURNING id`,
      [laylaEncounter, layla, users['amira@harborlight.clinic'], laylaVisit.scheduled_at, users['pharmacy@harborlight.clinic']],
    );
    await client.query(
      `INSERT INTO prescription_items (prescription_id, medication_id, medication_name, dosage, frequency, duration, quantity, instructions)
       VALUES ($1, $2, 'Loratadine 10 mg', '10 mg', 'Once daily', '10 days', 10, 'Take in the evening')`,
      [laylaRx.rows[0].id, meds['LORA-10']],
    );
    await client.query('UPDATE medications SET quantity_on_hand = quantity_on_hand - 10 WHERE id = $1', [meds['LORA-10']]);
    await client.query(
      `INSERT INTO stock_movements (medication_id, change_qty, reason, prescription_id, created_by)
       VALUES ($1, -10, 'dispense', $2, $3)`,
      [meds['LORA-10'], laylaRx.rows[0].id, users['pharmacy@harborlight.clinic']],
    );
    await writeServiceLines(client, laylaEncounter, users['accounts@harborlight.clinic']);
    await syncMedicationCharges(client, laylaEncounter, users['pharmacy@harborlight.clinic']);
    await client.query(
      `INSERT INTO payments (invoice_id, amount, method, reference, received_by, paid_at)
       SELECT id, total, 'cash', 'RCPT-1001', $2, $3::timestamptz
       FROM invoices WHERE encounter_id = $1 AND status <> 'void'`,
      [laylaEncounter, users['accounts@harborlight.clinic'], laylaVisit.scheduled_at],
    );

    const jonahEncounter = await openEncounter(jonahVisit, jonah, 'amira@harborlight.clinic', 'Cough and fever for three days', 'closed');
    await client.query(
      `UPDATE encounters SET diagnosis = $2, clinical_notes = $3 WHERE id = $1`,
      [jonahEncounter, 'Acute bronchitis', 'Chest is clear. Finish the antibiotic course and return if breathing worsens.'],
    );
    await client.query(
      `INSERT INTO encounter_services (encounter_id, service_id, quantity, unit_price)
       VALUES ($1, $2, 1, 15000)`,
      [jonahEncounter, services['CONS-GP']],
    );
    const jonahRx = await client.query(
      `INSERT INTO prescriptions (encounter_id, patient_id, doctor_id, status)
       VALUES ($1, $2, $3, 'issued')
       RETURNING id`,
      [jonahEncounter, jonah, users['amira@harborlight.clinic']],
    );
    await client.query(
      `INSERT INTO prescription_items (prescription_id, medication_id, medication_name, dosage, frequency, duration, quantity, instructions)
       VALUES ($1, $2, 'Amoxicillin 500 mg', '500 mg', 'Three times a day', '7 days', 21, 'Finish the course')`,
      [jonahRx.rows[0].id, meds['AMOX-500']],
    );
    await writeServiceLines(client, jonahEncounter, users['amira@harborlight.clinic']);

    const yusufEncounter = await openEncounter(yusufVisit, yusuf, 'amira@harborlight.clinic', 'Chest tightness on climbing stairs', 'open');
    await client.query(
      `INSERT INTO vitals (
         encounter_id, recorded_by, temperature, systolic, diastolic, pulse, respiratory_rate, weight_kg, height_cm, spo2, notes
       ) VALUES ($1, $2, 36.8, 148, 92, 88, 16, 81, 176, 98, 'Patient is comfortable at rest')`,
      [yusufEncounter, users['nurse@harborlight.clinic']],
    );

    await client.query(
      `INSERT INTO encounters (appointment_id, patient_id, doctor_id, chief_complaint, status)
       SELECT id, patient_id, doctor_id, reason, 'open'
       FROM appointments
       WHERE patient_id = $1 AND status = 'checked_in'`,
      [hana],
    );

    await logActivity(client, {
      actorId: users['admin@harborlight.clinic'],
      action: 'seed',
      entity: 'clinic',
      detail: 'Opened the day with a paid visit, a prescription waiting at the pharmacy, and patients in the queue',
    });
  });

  return true;
}
