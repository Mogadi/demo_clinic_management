import { api } from '../api.js';
import { esc, formObject, fullName, money, openModal, patientFields, pill, toast, when } from '../ui.js';

const EDITORS = ['admin', 'receptionist', 'nurse', 'doctor'];

function field(label, value) {
  const shown = value ? esc(value) : '<span class="blank">Empty</span>';
  return `<div><span>${esc(label)}</span><strong>${shown}</strong></div>`;
}

export async function renderPatients(root, ctx) {
  if (ctx.id) return renderPatient(root, ctx);
  let query = '';
  await draw();

  async function draw() {
    const data = await api(`/api/patients${query ? `?q=${encodeURIComponent(query)}` : ''}`);
    if (!ctx.alive()) return;
    root.innerHTML = `
      <div class="toolbar">
        <form id="search"><input name="q" value="${esc(query)}" placeholder="Name, phone, or MRN"></form>
        ${EDITORS.includes(ctx.user.role) ? '<button class="btn primary" id="new-patient" type="button">Register patient</button>' : ''}
      </div>
      <article class="card">
        ${data.patients.length ? `<div class="table-wrap"><table>
          <thead><tr><th>MRN</th><th>Patient</th><th>Phone</th><th>Allergies</th></tr></thead>
          <tbody>
            ${data.patients.map((patient) => `<tr>
              <td>${esc(patient.mrn)}</td>
              <td><button class="linkish" data-open="${patient.id}" type="button">${esc(fullName(patient))}</button><div class="muted">${esc(patient.dateOfBirth || '')}</div></td>
              <td>${esc(patient.phone || '')}</td>
              <td>${esc(patient.allergies || 'None recorded')}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : '<p class="empty">No patients yet. Register one and fill in the empty fields.</p>'}
      </article>`;
    root.querySelector('#search').onsubmit = (event) => {
      event.preventDefault();
      query = formObject(event.target).q || '';
      draw().catch((error) => toast(error.message, 'bad'));
    };
    root.querySelector('#new-patient')?.addEventListener('click', () => {
      openModal({
        title: 'Register patient',
        submitLabel: 'Register',
        body: patientFields(),
        onSubmit: async (form) => {
          const result = await api('/api/patients', { method: 'POST', body: formObject(form) });
          toast(`${result.patient.firstName} is registered as ${result.patient.mrn}`);
          location.hash = `#/patients/${result.patient.id}`;
        },
      });
    });
    root.querySelector('tbody')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-open]');
      if (button) location.hash = `#/patients/${button.dataset.open}`;
    });
  }
}

async function renderPatient(root, ctx) {
  const data = await api(`/api/patients/${ctx.id}`);
  if (!ctx.alive()) return;
  const patient = data.patient;
  root.innerHTML = `
    <div class="toolbar">
      <button class="btn ghost" id="back" type="button">All patients</button>
      ${EDITORS.includes(ctx.user.role) ? '<button class="btn" id="edit" type="button">Edit record</button>' : ''}
    </div>
    <section class="grid-3">
      <article class="card">
        <p class="muted">${esc(patient.mrn)}</p>
        <h2>${esc(fullName(patient))}</h2>
        ${patient.allergies ? `<p class="alert">Allergies: ${esc(patient.allergies)}</p>` : ''}
        <div class="fields">
          ${field('Phone', patient.phone)}
          ${field('National ID', patient.nationalId)}
          ${field('Date of birth', patient.dateOfBirth)}
          ${field('Gender', patient.gender)}
          ${field('Marital status', patient.maritalStatus)}
          ${field('Email', patient.email)}
          ${field('Occupation', patient.occupation)}
          ${field('City', patient.city)}
          ${field('District', patient.district)}
          ${field('Address', patient.address)}
          ${field('Blood type', patient.bloodType)}
          ${field('Insurance', patient.insuranceProvider)}
          ${field('Policy number', patient.insuranceNumber)}
          ${field('Chronic conditions', patient.chronicConditions)}
          ${field('Current medications', patient.currentMedications)}
          ${field('Emergency contact', patient.emergencyName)}
          ${field('Emergency phone', patient.emergencyPhone)}
          ${field('Relationship', patient.kinRelationship)}
          ${field('Notes', patient.notes)}
        </div>
      </article>
      <article class="card">
        <h2>Visits</h2>
        ${data.visits.length ? data.visits.map((visit) => `<p style="margin-bottom:10px"><strong>${esc(when(visit.scheduledAt))}</strong> ${pill(visit.status)}<br>${esc(visit.reason)} · ${esc(visit.doctorName)}${visit.diagnosis ? `<br><span class="muted">${esc(visit.diagnosis)}</span>` : ''}</p>`).join('') : '<p class="empty">No visits yet.</p>'}
        ${data.invoices.length ? `<h2 style="margin-top:16px">Invoices</h2>${data.invoices.map((invoice) => `<p style="margin-bottom:8px"><button class="linkish" data-invoice="${invoice.id}" type="button">${esc(invoice.invoiceNumber)}</button> ${pill(invoice.status)} ${esc(money(invoice.balance))} due</p>`).join('')}` : ''}
      </article>
    </section>`;
  root.querySelector('#back').onclick = () => { location.hash = '#/patients'; };
  root.querySelector('#edit')?.addEventListener('click', () => {
    openModal({
      title: 'Edit patient',
      body: patientFields(patient),
      onSubmit: async (form) => {
        await api(`/api/patients/${patient.id}`, { method: 'PATCH', body: formObject(form) });
        toast('Patient record updated');
        renderPatient(root, ctx);
      },
    });
  });
  root.querySelectorAll('[data-invoice]').forEach((button) => {
    button.onclick = () => { location.hash = `#/billing/${button.dataset.invoice}`; };
  });
}
