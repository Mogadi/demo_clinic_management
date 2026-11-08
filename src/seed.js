import bcrypt from 'bcryptjs';
import { query, withTransaction } from './db.js';

const DEMO_PASSWORD = 'Clinic123!';

export async function seedIfEmpty() {
  const existing = await query('SELECT COUNT(*)::int AS count FROM users');
  if (existing.rows[0].count > 0) return false;

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const staff = [
    ['Aline Uwase', 'admin@harborlight.clinic', 'admin', null, '+250788000001'],
    ['Eric Habimana', 'desk@harborlight.clinic', 'receptionist', null, '+250788000002'],
    ['Diane Mukamana', 'nurse@harborlight.clinic', 'nurse', null, '+250788000003'],
    ['Dr. Amira Hassan', 'amira@harborlight.clinic', 'doctor', 'General practice', '+250788000004'],
    ['Dr. Omar Khalid', 'omar@harborlight.clinic', 'doctor', 'Pediatrics', '+250788000005'],
    ['Patrick Ndayisaba', 'pharmacy@harborlight.clinic', 'pharmacist', null, '+250788000006'],
    ['Grace Ingabire', 'accounts@harborlight.clinic', 'accountant', null, '+250788000007'],
  ];

  await withTransaction(async (client) => {
    for (const [fullName, email, role, specialty, phone] of staff) {
      await client.query(
        `INSERT INTO users (full_name, email, password_hash, role, specialty, phone)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [fullName, email, passwordHash, role, specialty, phone],
      );
    }
  });

  return true;
}
