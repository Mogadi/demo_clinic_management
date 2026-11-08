import { Router } from 'express';
import { camel, query, withTransaction } from '../db.js';
import { logActivity } from '../activity.js';
import { requireRoles } from '../auth.js';
import { asyncHandler, clean, httpError } from '../http.js';
import { config } from '../config.js';

export const appointmentRouter = Router();

const DURATIONS = [15, 20, 30, 45, 60];
const VISIT_TYPES = ['new', 'follow_up', 'walk_in'];
const PRIORITIES = ['routine', 'urgent', 'emergency'];

async function checkIn(client, appointment, actorId) {
  if (appointment.status !== 'scheduled') throw httpError(409, 'Only a scheduled visit can be checked in');
  await client.query(`UPDATE appointments SET status = 'checked_in' WHERE id = $1`, [appointment.id]);
  await client.query(
    `INSERT INTO encounters (appointment_id, patient_id, doctor_id, chief_complaint)
     VALUES ($1, $2, $3, $4)`,
    [appointment.id, appointment.patient_id, appointment.doctor_id, appointment.reason],
  );
  await logActivity(client, {
    actorId,
    action: 'check_in',
    entity: 'appointment',
    entityId: appointment.id,
    detail: appointment.reason,
  });
}

appointmentRouter.get('/', requireRoles('receptionist', 'nurse', 'doctor', 'accountant'), asyncHandler(async (req, res) => {
  const date = clean(req.query.date);
  const doctorId = clean(req.query.doctorId);
  const { rows } = await query(
    `SELECT * FROM visit_board
     WHERE (scheduled_at AT TIME ZONE $1)::date = COALESCE($2::date, (now() AT TIME ZONE $1)::date)
       AND ($3::int IS NULL OR doctor_id = $3)
     ORDER BY scheduled_at`,
    [config.clinicTz, date, doctorId],
  );
  const clinical = ['admin', 'doctor', 'nurse'].includes(req.user.role);
  const appointments = camel(rows).map((row) => (clinical ? row : { ...row, diagnosis: null }));
  res.json({ appointments });
}));

appointmentRouter.post('/', requireRoles('receptionist'), asyncHandler(async (req, res) => {
  const patientId = Number(req.body.patientId);
  const doctorId = Number(req.body.doctorId);
  const reason = clean(req.body.reason);
  const when = new Date(req.body.scheduledAt);
  const durationMin = DURATIONS.includes(Number(req.body.durationMin)) ? Number(req.body.durationMin) : 30;
  const visitType = clean(req.body.visitType);
  const priority = clean(req.body.priority);
  if (visitType && !VISIT_TYPES.includes(visitType)) throw httpError(400, 'Choose a visit type from the list');
  if (priority && !PRIORITIES.includes(priority)) throw httpError(400, 'Choose a priority from the list');
  if (!patientId || !doctorId || !reason) throw httpError(400, 'Patient, doctor, and reason are required');
  if (reason.length > 240) throw httpError(400, 'Keep the reason short');
  if (Number.isNaN(when.getTime())) throw httpError(400, 'Choose a valid date and time');

  const created = await withTransaction(async (client) => {
    const patient = await client.query('SELECT id FROM patients WHERE id = $1', [patientId]);
    if (!patient.rows[0]) throw httpError(400, 'Choose a patient who is already registered');
    const doctor = await client.query(
      `SELECT id, full_name FROM users WHERE id = $1 AND role = 'doctor' AND is_active`,
      [doctorId],
    );
    if (!doctor.rows[0]) throw httpError(400, 'Choose an active doctor');
    const { rows } = await client.query(
      `INSERT INTO appointments (
         patient_id, doctor_id, scheduled_at, duration_min, reason, created_by,
         visit_type, priority, room, referral_from, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        patientId, doctorId, when.toISOString(), durationMin, reason, req.user.id,
        visitType, priority, clean(req.body.room), clean(req.body.referralFrom), clean(req.body.notes),
      ],
    );
    await logActivity(client, {
      actorId: req.user.id,
      action: 'book',
      entity: 'appointment',
      entityId: rows[0].id,
      detail: `${reason} with ${doctor.rows[0].full_name}`,
    });
    return rows[0].id;
  });

  const { rows } = await query('SELECT * FROM visit_board WHERE appointment_id = $1', [created]);
  res.status(201).json({ appointment: camel(rows[0]) });
}));

appointmentRouter.patch('/:id', requireRoles('receptionist'), asyncHandler(async (req, res) => {
  const status = clean(req.body.status);
  const reason = clean(req.body.reason);
  const doctorId = req.body.doctorId ? Number(req.body.doctorId) : null;
  const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw httpError(400, 'Choose a valid date and time');

  await withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM appointments WHERE id = $1 FOR UPDATE', [req.params.id]);
    const appointment = current.rows[0];
    if (!appointment) throw httpError(404, 'Appointment not found');

    const moving = scheduledAt || doctorId || (reason && reason !== appointment.reason);
    if (moving) {
      if (appointment.status !== 'scheduled') throw httpError(409, 'Only a scheduled visit can be moved');
      if (doctorId) {
        const doctor = await client.query(
          `SELECT id FROM users WHERE id = $1 AND role = 'doctor' AND is_active`,
          [doctorId],
        );
        if (!doctor.rows[0]) throw httpError(400, 'Choose an active doctor');
      }
      await client.query(
        `UPDATE appointments
         SET scheduled_at = COALESCE($2, scheduled_at),
             doctor_id = COALESCE($3, doctor_id),
             reason = COALESCE($4, reason)
         WHERE id = $1`,
        [appointment.id, scheduledAt ? scheduledAt.toISOString() : null, doctorId, reason],
      );
    }

    if (status && status !== appointment.status) {
      const allowed = {
        scheduled: ['checked_in', 'cancelled', 'no_show'],
        checked_in: ['cancelled', 'no_show'],
      };
      if (!allowed[appointment.status]?.includes(status)) {
        throw httpError(409, 'That status change is not allowed from the front desk');
      }
      if (status === 'checked_in') {
        const fresh = moving
          ? (await client.query('SELECT * FROM appointments WHERE id = $1', [appointment.id])).rows[0]
          : appointment;
        await checkIn(client, fresh, req.user.id);
      } else {
        await client.query('UPDATE appointments SET status = $2 WHERE id = $1', [appointment.id, status]);
        await client.query(
          `UPDATE encounters SET status = 'closed', closed_at = now()
           WHERE appointment_id = $1 AND status = 'open'`,
          [appointment.id],
        );
        await logActivity(client, {
          actorId: req.user.id,
          action: status,
          entity: 'appointment',
          entityId: appointment.id,
        });
      }
    }
  });

  const { rows } = await query('SELECT * FROM visit_board WHERE appointment_id = $1', [req.params.id]);
  res.json({ appointment: camel(rows[0]) });
}));
