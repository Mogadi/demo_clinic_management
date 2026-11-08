import { clinicInfo } from './api.js';

const STATUS = {
  scheduled: 'Scheduled',
  checked_in: 'Checked in',
  with_nurse: 'With nurse',
  with_doctor: 'With doctor',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No show',
  issued: 'To dispense',
  dispensed: 'Dispensed',
  paid: 'Paid',
  partial: 'Part paid',
  void: 'Void',
  open: 'Open',
  closed: 'Closed',
};

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function pill(status) {
  return `<span class="pill" data-status="${esc(status)}">${esc(STATUS[status] || status || '')}</span>`;
}

export function money(value) {
  return new Intl.NumberFormat('en-RW', {
    style: 'currency',
    currency: clinicInfo().currency || 'RWF',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function clinicToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: clinicInfo().timezone || 'Africa/Kigali',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function clock(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: clinicInfo().timezone || 'Africa/Kigali',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function when(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: clinicInfo().timezone || 'Africa/Kigali',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function fullName(person) {
  return [person?.firstName, person?.lastName].filter(Boolean).join(' ');
}

export function toast(message, tone = 'ok') {
  const host = document.getElementById('toasts');
  const node = document.createElement('div');
  node.className = `toast ${tone === 'bad' ? 'bad' : ''}`;
  node.textContent = message;
  host.append(node);
  setTimeout(() => node.remove(), 4200);
}

export function openModal({ title, body, submitLabel = 'Save', onSubmit }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-back';
  wrap.innerHTML = `
    <form class="modal">
      <header><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-close>Close</button></header>
      <div class="modal-body">${body}</div>
      <footer>
        <button class="btn ghost" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${esc(submitLabel)}</button>
      </footer>
    </form>`;
  document.body.append(wrap);
  const close = () => wrap.remove();
  wrap.querySelectorAll('[data-close]').forEach((button) => {
    button.onclick = close;
  });
  wrap.addEventListener('click', (event) => {
    if (event.target === wrap) close();
  });
  const form = wrap.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      await onSubmit(form);
      close();
    } catch (error) {
      toast(error.message, 'bad');
      button.disabled = false;
    }
  });
  form.querySelector('input, select, textarea')?.focus();
}

export function patientFields(patient = {}) {
  const gender = patient.gender || '';
  const blood = patient.bloodType || '';
  const option = (value, label, current) => `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;
  return `
    <div class="grid-2">
      <label>First name<input name="firstName" required value="${esc(patient.firstName || '')}"></label>
      <label>Last name<input name="lastName" required value="${esc(patient.lastName || '')}"></label>
      <label>Date of birth<input type="date" name="dateOfBirth" value="${esc(patient.dateOfBirth || '')}"></label>
      <label>Gender
        <select name="gender">
          <option value="">Not recorded</option>
          ${option('female', 'Female', gender)}
          ${option('male', 'Male', gender)}
          ${option('other', 'Other', gender)}
          ${option('unknown', 'Unknown', gender)}
        </select>
      </label>
      <label>Phone<input name="phone" required value="${esc(patient.phone || '')}"></label>
      <label>Email<input name="email" type="email" value="${esc(patient.email || '')}"></label>
      <label>Blood type
        <select name="bloodType">
          <option value="">Unknown</option>
          ${['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((type) => option(type, type, blood)).join('')}
        </select>
      </label>
      <label>Allergies<input name="allergies" value="${esc(patient.allergies || '')}" placeholder="None known"></label>
    </div>
    <label>Address<input name="address" value="${esc(patient.address || '')}"></label>
    <div class="grid-2">
      <label>Emergency contact<input name="emergencyName" value="${esc(patient.emergencyName || '')}"></label>
      <label>Emergency phone<input name="emergencyPhone" value="${esc(patient.emergencyPhone || '')}"></label>
    </div>`;
}

export function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}
