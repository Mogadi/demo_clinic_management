const base = process.env.BASE_URL || 'http://localhost:3000';

async function call(path, { method = 'GET', token, body, ok = true } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (ok && !response.ok) throw new Error(`${method} ${path} -> ${response.status} ${data.error || ''}`);
  return { status: response.status, data };
}

async function login(email) {
  const { data } = await call('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'Clinic123!' },
  });
  return data.token;
}

const failures = [];
function check(name, condition) {
  if (!condition) failures.push(name);
  else console.log(`ok  ${name}`);
}

const desk = await login('desk@harborlight.clinic');
const nurse = await login('nurse@harborlight.clinic');
const doctor = await login('amira@harborlight.clinic');
const pharmacy = await login('pharmacy@harborlight.clinic');
const accounts = await login('accounts@harborlight.clinic');

const bad = await call('/api/auth/login', {
  method: 'POST',
  ok: false,
  body: { email: 'desk@harborlight.clinic', password: 'wrong' },
});
check('bad password rejected', bad.status === 401);

const blocked = await call('/api/catalog/staff', { token: nurse, ok: false });
check('nurse cannot manage staff', blocked.status === 403);

const doctors = await call('/api/catalog/doctors', { token: desk });
const amira = doctors.data.doctors.find((person) => person.email === undefined && person.fullName.includes('Amira'));
check('doctor directory', Boolean(amira));

const patient = await call('/api/patients', {
  method: 'POST',
  token: desk,
  body: {
    firstName: 'Smoke',
    lastName: `Visitor${Date.now() % 100000}`,
    phone: `+25078${String(Date.now()).slice(-7)}`,
    gender: 'female',
    allergies: 'penicillin',
  },
});
check('patient registered', Boolean(patient.data.patient.mrn));

const daysAhead = 60 + (Date.now() % 300);
const when = new Date();
when.setDate(when.getDate() + daysAhead);
when.setHours(11, 0, 0, 0);

const booked = await call('/api/appointments', {
  method: 'POST',
  token: desk,
  body: {
    patientId: patient.data.patient.id,
    doctorId: amira.id,
    scheduledAt: when.toISOString(),
    durationMin: 30,
    reason: 'Smoke-test visit',
  },
});
check('appointment booked', booked.data.appointment.status === 'scheduled');

const overlap = await call('/api/appointments', {
  method: 'POST',
  token: desk,
  ok: false,
  body: {
    patientId: patient.data.patient.id,
    doctorId: amira.id,
    scheduledAt: when.toISOString(),
    durationMin: 30,
    reason: 'This should be refused',
  },
});
check('overlapping booking refused', overlap.status === 409);

const checked = await call(`/api/appointments/${booked.data.appointment.appointmentId}`, {
  method: 'PATCH',
  token: desk,
  body: { status: 'checked_in' },
});
check('checked in', checked.data.appointment.status === 'checked_in' && checked.data.appointment.encounterId);

const encounterId = checked.data.appointment.encounterId;
const vitals = await call(`/api/encounters/${encounterId}/vitals`, {
  method: 'POST',
  token: nurse,
  body: { temperature: 36.7, systolic: 118, diastolic: 76, pulse: 72, spo2: 99 },
});
check('vitals recorded', vitals.data.encounter.appointmentStatus === 'with_nurse');

const services = await call('/api/catalog/services', { token: doctor });
const consult = services.data.services.find((service) => service.code === 'CONS-GP');
const paracetamol = (await call('/api/pharmacy/medications', { token: doctor })).data.medications
  .find((item) => item.sku === 'PARA-500');
const before = paracetamol.quantityOnHand;

const closed = await call(`/api/encounters/${encounterId}`, {
  method: 'PUT',
  token: doctor,
  body: {
    chiefComplaint: 'Smoke-test visit',
    diagnosis: 'Healthy',
    clinicalNotes: 'Demo visit created by the smoke test.',
    complete: true,
    services: [{ serviceId: consult.id, quantity: 1 }],
    prescription: {
      items: [{
        medicationId: paracetamol.id,
        medicationName: 'Paracetamol 500 mg',
        dosage: '500 mg',
        frequency: 'Twice a day',
        duration: '2 days',
        quantity: 2,
      }],
    },
  },
});
check('visit closed', closed.data.encounter.status === 'closed' && closed.data.encounter.invoice);

const dispensed = await call(`/api/pharmacy/prescriptions/${closed.data.encounter.prescription.id}/dispense`, {
  method: 'POST',
  token: pharmacy,
  body: {},
});
check('dispensed', dispensed.data.prescription.status === 'dispensed');

const after = (await call('/api/pharmacy/medications', { token: pharmacy })).data.medications
  .find((item) => item.sku === 'PARA-500');
check('stock reduced by two', after.quantityOnHand === before - 2);

const invoiceId = closed.data.encounter.invoice.id;
const refreshed = await call(`/api/billing/invoices/${invoiceId}`, { token: accounts });
check('medicine added to invoice', refreshed.data.invoice.lines.some((line) => line.kind === 'medication'));
const paid = await call(`/api/billing/invoices/${invoiceId}/payments`, {
  method: 'POST',
  token: accounts,
  body: { amount: refreshed.data.invoice.balance, method: 'cash', reference: 'SMOKE' },
});
check('invoice paid', paid.data.invoice.status === 'paid' && paid.data.invoice.balance === 0);

const overpay = await call(`/api/billing/invoices/${invoiceId}/payments`, {
  method: 'POST',
  token: accounts,
  ok: false,
  body: { amount: 100, method: 'cash' },
});
check('overpayment refused', overpay.status === 409);

if (failures.length) {
  console.error(failures.map((name) => `FAIL ${name}`).join('\n'));
  process.exit(1);
}
console.log('Visit flow passed.');
