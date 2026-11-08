import { api } from '../api.js';
import { clock, esc, formObject, fullName, pill, toast } from '../ui.js';

export async function renderCare(root, ctx) {
  const mineKey = 'harborlight.careMine';
  if (ctx.user.role === 'doctor' && sessionStorage.getItem(mineKey) == null) sessionStorage.setItem(mineKey, '1');
  const mine = ctx.user.role === 'doctor' && sessionStorage.getItem(mineKey) !== '0';
  const queue = await api(`/api/encounters/queue${mine ? '?mine=1' : ''}`);
  const encounter = ctx.id ? (await api(`/api/encounters/${ctx.id}`)).encounter : null;
  const catalog = ctx.user.role === 'nurse' ? { services: [], medications: [] } : await Promise.all([
    api('/api/catalog/services'),
    api('/api/pharmacy/medications'),
  ]).then(([services, medications]) => ({ services: services.services, medications: medications.medications }));
  if (!ctx.alive()) return;

  root.innerHTML = `
    <section class="care">
      <article class="card">
        <div class="toolbar">
          <h2>Queue</h2>
          ${ctx.user.role === 'doctor' ? `<button class="btn tiny" id="mine" type="button">${mine ? 'Mine' : 'All doctors'}</button>` : ''}
        </div>
        ${queue.queue.length ? queue.queue.map((row) => `
          <button class="queue-item" data-encounter="${row.encounterId}" type="button" ${Number(ctx.id) === row.encounterId ? 'aria-current="true"' : ''}>
            <strong>${esc(clock(row.scheduledAt))} ${esc(fullName(row))}</strong>
            <div>${pill(row.status)}</div>
            <div class="muted">${esc(row.reason)}</div>
          </button>`).join('') : '<p class="empty">Nobody is checked in. The queue starts at the front desk.</p>'}
      </article>
      <div id="chart">${encounter ? chartHtml(encounter, catalog, ctx) : '<article class="card"><p class="empty">Choose a patient from the queue.</p></article>'}</div>
    </section>`;

  root.querySelector('#mine')?.addEventListener('click', () => {
    sessionStorage.setItem(mineKey, mine ? '0' : '1');
    renderCare(root, ctx);
  });
  root.querySelectorAll('[data-encounter]').forEach((button) => {
    button.onclick = () => { location.hash = `#/care/${button.dataset.encounter}`; };
  });
  wireChart(root, ctx, encounter, catalog);
}

function chartHtml(encounter, catalog, ctx) {
  const canVitals = ['admin', 'nurse', 'doctor'].includes(ctx.user.role) && encounter.status === 'open';
  const canConsult = ['admin', 'doctor'].includes(ctx.user.role) && encounter.status === 'open';
  const latest = encounter.vitals.at(-1);
  const preferred = ctx.user.specialty?.toLowerCase().includes('pediatr') ? 'CONS-PD' : 'CONS-GP';
  const selected = new Set(encounter.services.map((service) => service.serviceId));
  return `
    <article class="card">
      <p class="muted">${esc(encounter.mrn)} · ${esc(encounter.doctorName)}</p>
      <h2>${esc(encounter.firstName)} ${esc(encounter.lastName)} ${pill(encounter.appointmentStatus)}</h2>
      <p>${esc(encounter.reason)}</p>
      ${encounter.allergies ? `<p class="alert">Allergies: ${esc(encounter.allergies)}</p>` : ''}
      ${latest ? `<div class="vitals">
        ${vital('Temp', latest.temperature, '°C')}
        ${vital('BP', latest.systolic && latest.diastolic ? `${latest.systolic}/${latest.diastolic}` : '', '')}
        ${vital('Pulse', latest.pulse, '')}
        ${vital('SpO2', latest.spo2, '%')}
        ${vital('Weight', latest.weightKg, 'kg')}
      </div>` : '<p class="muted">No vitals yet.</p>'}
      ${canVitals ? `<form id="vitals" class="grid-2">
        <label>Temperature<input name="temperature" type="number" step="0.1" placeholder="36.8"></label>
        <label>Systolic<input name="systolic" type="number"></label>
        <label>Diastolic<input name="diastolic" type="number"></label>
        <label>Pulse<input name="pulse" type="number"></label>
        <label>Respiratory rate<input name="respiratoryRate" type="number"></label>
        <label>SpO2<input name="spo2" type="number"></label>
        <label>Weight kg<input name="weightKg" type="number" step="0.1"></label>
        <label>Height cm<input name="heightCm" type="number" step="0.1"></label>
        <div class="actions"><button class="btn" type="submit">Save vitals</button></div>
      </form>` : ''}
    </article>
    <article class="card">
      <h2>Consultation</h2>
      ${canConsult ? `<form id="consult">
        <label>Chief complaint<input name="chiefComplaint" value="${esc(encounter.chiefComplaint || encounter.reason || '')}"></label>
        <label>Diagnosis<input name="diagnosis" value="${esc(encounter.diagnosis || '')}" placeholder="Required before closing"></label>
        <label>Notes<textarea name="clinicalNotes">${esc(encounter.clinicalNotes || '')}</textarea></label>
        <h3>Services</h3>
        ${catalog.services.map((service) => `<label class="inline"><input type="checkbox" name="service" value="${service.id}" ${(selected.size ? selected.has(service.id) : service.code === preferred) ? 'checked' : ''}> ${esc(service.name)}</label>`).join('')}
        <h3 style="margin-top:12px">Prescription</h3>
        ${encounter.prescription?.status === 'dispensed' ? '<p class="muted">Pharmacy has already dispensed this prescription.</p>' : `
          <div class="table-wrap"><table id="rx">
            <thead><tr><th>Stock item</th><th>Name</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Qty</th><th></th></tr></thead>
            <tbody>${(encounter.prescription?.items?.length ? encounter.prescription.items : [{}]).map((item) => rxRow(item, catalog.medications)).join('')}</tbody>
          </table></div>
          <button class="btn tiny" id="add-rx" type="button">Add medication</button>
          <label>Prescription note<input name="rxNotes" value="${esc(encounter.prescription?.notes || '')}"></label>`}
        <div class="actions">
          <button class="btn" name="mode" value="save" type="submit">Save draft</button>
          <button class="btn primary" name="mode" value="close" type="submit">Sign and close visit</button>
        </div>
      </form>` : `<p>${esc(encounter.diagnosis || 'No diagnosis recorded')}</p><p class="muted">${esc(encounter.clinicalNotes || '')}</p>
        ${encounter.invoice ? `<p style="margin-top:10px">Invoice ${esc(encounter.invoice.invoiceNumber)} ${pill(encounter.invoice.status)}</p>` : ''}`}
    </article>`;
}

function vital(label, value, unit) {
  if (value === null || value === undefined || value === '') return '';
  return `<span><strong>${esc(label)}</strong> ${esc(value)}${esc(unit)}</span>`;
}

function rxRow(item, medications) {
  return `<tr>
    <td><select name="medicationId"><option value="">Outside stock</option>${medications.map((med) => `<option value="${med.id}" ${Number(item.medicationId) === med.id ? 'selected' : ''}>${esc(med.name)} ${esc(med.strength || '')}</option>`).join('')}</select></td>
    <td><input name="medicationName" value="${esc(item.medicationName || '')}"></td>
    <td><input name="dosage" value="${esc(item.dosage || '')}"></td>
    <td><input name="frequency" value="${esc(item.frequency || '')}"></td>
    <td><input name="duration" value="${esc(item.duration || '')}"></td>
    <td><input name="quantity" type="number" min="1" value="${esc(item.quantity || 1)}"></td>
    <td><button class="btn tiny ghost" data-remove type="button">Remove</button></td>
  </tr>`;
}

function wireChart(root, ctx, encounter, catalog) {
  const vitals = root.querySelector('#vitals');
  vitals?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(`/api/encounters/${encounter.id}/vitals`, { method: 'POST', body: blankToNull(formObject(event.target)) });
      toast('Vitals saved');
      renderCare(root, ctx);
    } catch (error) {
      toast(error.message, 'bad');
    }
  });

  const consult = root.querySelector('#consult');
  root.querySelector('#add-rx')?.addEventListener('click', () => {
    root.querySelector('#rx tbody').insertAdjacentHTML('beforeend', rxRow({}, catalog.medications));
  });
  root.querySelector('#rx')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-remove]')) event.target.closest('tr').remove();
  });
  root.querySelector('#rx')?.addEventListener('change', (event) => {
    const select = event.target.closest('[name=medicationId]');
    if (!select) return;
    const medication = catalog.medications.find((item) => String(item.id) === select.value);
    if (!medication) return;
    const row = select.closest('tr');
    row.querySelector('[name=medicationName]').value = `${medication.name} ${medication.strength || ''}`.trim();
  });
  consult?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const body = formObject(event.target);
      const items = [...root.querySelectorAll('#rx tbody tr')].map((row) => ({
        medicationId: row.querySelector('[name=medicationId]').value || null,
        medicationName: row.querySelector('[name=medicationName]').value,
        dosage: row.querySelector('[name=dosage]').value,
        frequency: row.querySelector('[name=frequency]').value,
        duration: row.querySelector('[name=duration]').value,
        quantity: Number(row.querySelector('[name=quantity]').value || 1),
      })).filter((item) => item.medicationName || item.medicationId);
      await api(`/api/encounters/${encounter.id}`, {
        method: 'PUT',
        body: {
          chiefComplaint: body.chiefComplaint,
          diagnosis: body.diagnosis,
          clinicalNotes: body.clinicalNotes,
          complete: button.value === 'close',
          services: [...event.target.querySelectorAll('[name=service]:checked')].map((input) => ({
            serviceId: Number(input.value),
            quantity: 1,
          })),
          prescription: encounter.prescription?.status === 'dispensed' ? undefined : { notes: body.rxNotes, items },
        },
      });
      toast(button.value === 'close' ? 'Visit closed and invoice opened' : 'Draft saved');
      if (button.value === 'close') location.hash = '#/care';
      else renderCare(root, ctx);
    } catch (error) {
      toast(error.message, 'bad');
      button.disabled = false;
    }
  });
}

function blankToNull(body) {
  return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, value === '' ? null : Number(value)]));
}
