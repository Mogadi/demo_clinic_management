import { api } from '../api.js';
import { clinicToday, clock, esc, formObject, fullName, openModal, pill, toast } from '../ui.js';

export async function renderSchedule(root, ctx) {
  const canBook = ['admin', 'receptionist'].includes(ctx.user.role);
  let date = clinicToday();
  await draw();

  async function draw() {
    const data = await api(`/api/appointments?date=${date}`);
    if (!ctx.alive()) return;
    root.innerHTML = `
      <div class="toolbar">
        <form id="day-form" class="inline"><input type="date" name="date" value="${esc(date)}"></form>
        ${canBook ? '<button class="btn primary" id="book" type="button">Book appointment</button>' : ''}
      </div>
      <article class="card">
        ${data.appointments.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Time</th><th>Patient</th><th>Doctor</th><th>Reason</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${data.appointments.map((row) => `<tr>
              <td>${esc(clock(row.scheduledAt))}</td>
              <td><button class="linkish" data-patient="${row.patientId}" type="button">${esc(fullName(row))}</button><div class="muted">${esc(row.mrn)}</div></td>
              <td>${esc(row.doctorName)}<div class="muted">${esc(row.doctorSpecialty || '')}</div></td>
              <td>${esc(row.reason)}${row.allergies ? `<div class="muted">Allergy: ${esc(row.allergies)}</div>` : ''}</td>
              <td>${pill(row.status)}</td>
              <td>${actions(row)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : '<p class="empty">No appointments on this day.</p>'}
      </article>`;

    root.querySelector('#day-form').onchange = (event) => {
      date = formObject(event.target).date || clinicToday();
      draw().catch((error) => toast(error.message, 'bad'));
    };
    root.querySelector('#book')?.addEventListener('click', () => openBooking(ctx, () => draw()));
    root.onclick = async (event) => {
      const patient = event.target.closest('[data-patient]');
      const action = event.target.closest('[data-status]');
      if (patient) location.hash = `#/patients/${patient.dataset.patient}`;
      if (!action) return;
      action.disabled = true;
      try {
        await api(`/api/appointments/${action.dataset.id}`, {
          method: 'PATCH',
          body: { status: action.dataset.status },
        });
        toast(action.dataset.status === 'checked_in' ? 'Checked in. Nursing can take vitals.' : 'Appointment updated');
        await draw();
      } catch (error) {
        toast(error.message, 'bad');
        action.disabled = false;
      }
    };
  }

  function actions(row) {
    if (!canBook) return row.encounterId && ['checked_in', 'with_nurse', 'with_doctor'].includes(row.status)
      ? `<button class="btn tiny" type="button" onclick="location.hash='#/care/${row.encounterId}'">Open chart</button>`
      : '';
    if (row.status === 'scheduled') {
      return `<button class="btn tiny primary" data-id="${row.appointmentId}" data-status="checked_in" type="button">Check in</button>
        <button class="btn tiny" data-id="${row.appointmentId}" data-status="no_show" type="button">No show</button>`;
    }
    if (row.status === 'checked_in') {
      return `<button class="btn tiny" data-id="${row.appointmentId}" data-status="cancelled" type="button">Cancel</button>`;
    }
    return '';
  }
}

async function openBooking(ctx, refresh) {
  const [patients, doctors] = await Promise.all([
    api('/api/patients'),
    api('/api/catalog/doctors'),
  ]);
  openModal({
    title: 'Book appointment',
    submitLabel: 'Book',
    body: `
      <label>Patient
        <select name="patientId" required>
          <option value="">Choose</option>
          ${patients.patients.map((patient) => `<option value="${patient.id}">${esc(fullName(patient))} · ${esc(patient.mrn)}</option>`).join('')}
        </select>
      </label>
      <div class="grid-2">
        <label>Doctor
          <select name="doctorId" required>
            <option value="">Choose</option>
            ${doctors.doctors.map((doctor) => `<option value="${doctor.id}">${esc(doctor.fullName)}${doctor.specialty ? ` · ${esc(doctor.specialty)}` : ''}</option>`).join('')}
          </select>
        </label>
        <label>When<input type="datetime-local" name="scheduledAt" required></label>
      </div>
      <label>Length
        <select name="durationMin">
          <option value="20">20 minutes</option>
          <option value="30" selected>30 minutes</option>
          <option value="45">45 minutes</option>
          <option value="60">60 minutes</option>
        </select>
      </label>
      <label>Reason<input name="reason" required maxlength="240" placeholder="Why is the patient coming in?"></label>`,
    onSubmit: async (form) => {
      const body = formObject(form);
      body.patientId = Number(body.patientId);
      body.doctorId = Number(body.doctorId);
      body.durationMin = Number(body.durationMin);
      body.scheduledAt = new Date(body.scheduledAt).toISOString();
      await api('/api/appointments', { method: 'POST', body });
      toast('Appointment booked');
      await refresh();
    },
  });
}
