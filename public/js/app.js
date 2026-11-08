import { api, clearSession, clinicInfo, currentUser, saveSession } from './api.js';
import { esc, toast } from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderPatients } from './views/patients.js';
import { renderSchedule } from './views/schedule.js';
import { renderCare } from './views/care.js';
import { renderPharmacy } from './views/pharmacy.js';
import { renderBilling } from './views/billing.js';
import { renderServices, renderStaff } from './views/catalog.js';

const ALL = ['admin', 'receptionist', 'nurse', 'doctor', 'pharmacist', 'accountant'];
const NAV = [
  { hash: '/dashboard', label: 'Today', roles: ALL, render: renderDashboard, eyebrow: 'Board', title: 'Today' },
  { hash: '/patients', label: 'Patients', roles: ALL, render: renderPatients, eyebrow: 'Records', title: 'Patients' },
  { hash: '/schedule', label: 'Schedule', roles: ['admin', 'receptionist', 'nurse', 'doctor', 'accountant'], render: renderSchedule, eyebrow: 'Front desk', title: 'Schedule' },
  { hash: '/care', label: 'Care', roles: ['admin', 'nurse', 'doctor'], render: renderCare, eyebrow: 'Clinical', title: 'Care queue' },
  { hash: '/pharmacy', label: 'Pharmacy', roles: ['admin', 'pharmacist', 'doctor'], render: renderPharmacy, eyebrow: 'Dispensary', title: 'Pharmacy' },
  { hash: '/billing', label: 'Billing', roles: ['admin', 'receptionist', 'accountant'], render: renderBilling, eyebrow: 'Accounts', title: 'Billing' },
  { hash: '/services', label: 'Services', roles: ['admin', 'accountant'], render: renderServices, eyebrow: 'Catalog', title: 'Services' },
  { hash: '/staff', label: 'Staff', roles: ['admin'], render: renderStaff, eyebrow: 'Access', title: 'Staff' },
];

const DEMOS = [
  ['Admin', 'admin@harborlight.clinic'],
  ['Reception', 'desk@harborlight.clinic'],
  ['Nurse', 'nurse@harborlight.clinic'],
  ['Dr. Amira', 'amira@harborlight.clinic'],
  ['Dr. Omar', 'omar@harborlight.clinic'],
  ['Pharmacy', 'pharmacy@harborlight.clinic'],
  ['Accounts', 'accounts@harborlight.clinic'],
];

let generation = 0;

window.addEventListener('hashchange', () => render());
window.addEventListener('auth:lost', () => {
  if (!location.hash.startsWith('#/login')) location.hash = '#/login';
  else render();
});

boot();

async function boot() {
  if (!location.hash) location.hash = '#/dashboard';
  if (currentUser()) {
    try {
      const data = await api('/api/auth/me');
      localStorage.setItem('harborlight.user', JSON.stringify(data.user));
      localStorage.setItem('harborlight.clinic', JSON.stringify(data.clinic));
    } catch {
      clearSession();
    }
  }
  render();
}

function render() {
  const ticket = ++generation;
  const user = currentUser();
  const route = parseHash();
  document.title = clinicInfo().name || 'Ines Clinic';
  if (!user) {
    drawLogin();
    return;
  }
  if (route.key === 'login') {
    location.hash = '#/dashboard';
    return;
  }
  const page = NAV.find((item) => item.hash === `/${route.key}`) || NAV[0];
  const app = document.getElementById('app');
  app.innerHTML = shell(user, page);
  const root = document.getElementById('view');
  const allowed = page.roles.includes(user.role);
  if (!allowed) {
    root.innerHTML = '<article class="card"><p class="empty">Your role does not open this desk.</p></article>';
    return;
  }
  const ctx = {
    user,
    id: route.id,
    alive: () => ticket === generation,
  };
  page.render(root, ctx).catch((error) => {
    if (!ctx.alive()) return;
    root.innerHTML = `<article class="card"><p class="empty">${esc(error.message)}</p></article>`;
  });
  document.getElementById('logout').onclick = () => {
    clearSession();
    location.hash = '#/login';
    render();
  };
}

function shell(user, page) {
  const links = NAV.filter((item) => item.roles.includes(user.role)).map((item) => (
    `<a href="#${item.hash}" ${item.hash === page.hash ? 'aria-current="page"' : ''}>${item.label}</a>`
  )).join('');
  return `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="mark"><span></span></div><div><strong>${esc(clinicInfo().name)}</strong><span>${esc(user.role)}</span></div></div>
        <nav class="nav">${links}</nav>
        <footer><button class="btn tiny" id="logout" type="button">Sign out</button></footer>
      </aside>
      <main class="main">
        <header class="topbar">
          <div><p class="eyebrow">${esc(page.eyebrow)}</p><h1>${esc(page.title)}</h1></div>
          <div class="who"><strong>${esc(user.fullName)}</strong><span class="muted">${esc(user.specialty || user.email)}</span></div>
        </header>
        <div id="view"><p class="muted">Loading…</p></div>
      </main>
    </div>`;
}

function parseHash() {
  const parts = (location.hash || '#/dashboard').replace(/^#\//, '').split('/').filter(Boolean);
  return { key: parts[0] || 'dashboard', id: parts[1] || null };
}

async function drawLogin() {
  let clinic = clinicInfo();
  try {
    clinic = await api('/api/auth/meta', { allow401: true });
    localStorage.setItem('harborlight.clinic', JSON.stringify(clinic));
    document.title = clinic.name || 'Ines Clinic';
  } catch {
    /* the form still works with the default name */
  }
  document.getElementById('app').innerHTML = `
    <div class="login-wrap">
      <section class="login-story">
        <div class="mark"><span></span></div>
        <div>
          <h1 class="wordmark">${esc(clinic.name || 'Ines Clinic')}</h1>
          <div class="story-steps">
            <div><strong>01</strong> Reception registers and checks the patient in</div>
            <div><strong>02</strong> Nursing records vitals</div>
            <div><strong>03</strong> The doctor closes the visit</div>
            <div><strong>04</strong> Pharmacy dispenses and stock falls</div>
            <div><strong>05</strong> Accounts collects what is due</div>
          </div>
        </div>
        <p>A teaching clinic. Do not enter real patient records.</p>
      </section>
      <section class="login-panel">
        <form class="login-card" id="login">
          <h1>Sign in</h1>
          <p class="fine">Every demo account uses the password Clinic123!</p>
          <div class="demo-grid">
            ${DEMOS.map(([label, email]) => `<button class="chip" type="button" data-email="${email}">${label}</button>`).join('')}
          </div>
          <div class="stack">
            <label>Email<input name="email" type="email" required value="desk@harborlight.clinic"></label>
            <label>Password<input name="password" type="password" required value="Clinic123!"></label>
            <button class="btn primary" type="submit">Enter the clinic</button>
          </div>
        </form>
      </section>
    </div>`;
  const form = document.getElementById('login');
  form.querySelectorAll('[data-email]').forEach((button) => {
    button.onclick = () => {
      form.email.value = button.dataset.email;
      form.querySelectorAll('[data-email]').forEach((chip) => chip.setAttribute('aria-pressed', String(chip === button)));
    };
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        allow401: true,
        body: { email: form.email.value, password: form.password.value },
      });
      saveSession(data);
      location.hash = '#/dashboard';
      render();
    } catch (error) {
      toast(error.message, 'bad');
      button.disabled = false;
    }
  };
}
