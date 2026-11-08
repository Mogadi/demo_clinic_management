import { api } from '../api.js';
import { esc, formObject, money, openModal, pill, toast } from '../ui.js';

const ROLES = ['receptionist', 'nurse', 'doctor', 'pharmacist', 'accountant', 'admin'];

export async function renderServices(root, ctx) {
  const canEdit = ['admin', 'accountant'].includes(ctx.user.role);
  const data = await api('/api/catalog/services?all=1');
  if (!ctx.alive()) return;
  root.innerHTML = `
    <div class="toolbar">
      <p class="muted">Prices are copied onto a visit when it is closed.</p>
      ${canEdit ? '<button class="btn primary" id="add" type="button">Add service</button>' : ''}
    </div>
    <article class="card"><div class="table-wrap"><table>
      <thead><tr><th>Code</th><th>Service</th><th>Category</th><th>Price</th><th></th></tr></thead>
      <tbody>
        ${data.services.length ? data.services.map((service) => `<tr>
          <td>${esc(service.code)}</td>
          <td>${esc(service.name)}</td>
          <td>${esc(service.category)}</td>
          <td>${esc(money(service.price))}</td>
          <td>${canEdit ? `<button class="btn tiny" data-toggle="${service.id}" data-active="${service.isActive}" type="button">${service.isActive ? 'Retire' : 'Restore'}</button>` : pill(service.isActive ? 'open' : 'closed')}</td>
        </tr>`).join('') : '<tr><td colspan="5">No services yet. Add one and fill in the blank fields.</td></tr>'}
      </tbody>
    </table></div></article>`;
  root.querySelector('#add')?.addEventListener('click', () => {
    openModal({
      title: 'Add service',
      body: `<div class="grid-2">
        <label>Code<input name="code" required placeholder="LAB-MP"></label>
        <label>Name<input name="name" required></label>
        <label>Category<select name="category"><option value="consultation">Consultation</option><option value="procedure">Procedure</option><option value="lab">Lab</option></select></label>
        <label>Price<input name="price" type="number" min="0" required></label>
        <label>Department<input name="department"></label>
        <label>Description<input name="description"></label>
      </div>`,
      onSubmit: async (form) => {
        const body = formObject(form);
        body.price = Number(body.price);
        await api('/api/catalog/services', { method: 'POST', body });
        toast('Service added');
        renderServices(root, ctx);
      },
    });
  });
  root.querySelector('tbody')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-toggle]');
    if (!button) return;
    await api(`/api/catalog/services/${button.dataset.toggle}`, {
      method: 'PATCH',
      body: { isActive: button.dataset.active !== 'true' },
    });
    toast('Service updated');
    renderServices(root, ctx);
  });
}

export async function renderStaff(root, ctx) {
  const data = await api('/api/catalog/staff');
  if (!ctx.alive()) return;
  root.innerHTML = `
    <div class="toolbar">
      <p class="muted">Disabling an account signs that person out on the next request.</p>
      <button class="btn primary" id="add" type="button">Add staff</button>
    </div>
    <article class="card"><div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Role</th><th>Email</th><th></th></tr></thead>
      <tbody>
        ${data.staff.map((person) => `<tr>
          <td><div class="person">${esc(person.fullName)}</div><div class="muted">${esc(person.specialty || person.phone || '')}</div></td>
          <td>${esc(person.role)}</td>
          <td>${esc(person.email)}</td>
          <td>${person.id === ctx.user.id ? '' : `<button class="btn tiny" data-id="${person.id}" data-active="${person.isActive}" type="button">${person.isActive ? 'Disable' : 'Enable'}</button>`}</td>
        </tr>`).join('')}
      </tbody>
    </table></div></article>`;
  root.querySelector('#add').onclick = () => {
    openModal({
      title: 'Add staff',
      body: `<div class="grid-2">
        <label>Full name<input name="fullName" required></label>
        <label>Email<input name="email" type="email" required></label>
        <label>Role<select name="role">${ROLES.map((role) => `<option value="${role}">${role}</option>`).join('')}</select></label>
        <label>Phone<input name="phone"></label>
        <label>Specialty<input name="specialty" placeholder="For doctors"></label>
        <label>License number<input name="licenseNumber"></label>
        <label>Department<input name="department"></label>
        <label>Hire date<input name="hireDate" type="date"></label>
        <label>Temporary password<input name="password" type="text" required minlength="8"></label>
      </div>`,
      onSubmit: async (form) => {
        await api('/api/catalog/staff', { method: 'POST', body: formObject(form) });
        toast('Staff account created');
        renderStaff(root, ctx);
      },
    });
  };
  root.querySelector('tbody').onclick = async (event) => {
    const button = event.target.closest('[data-id]');
    if (!button) return;
    await api(`/api/catalog/staff/${button.dataset.id}`, {
      method: 'PATCH',
      body: { isActive: button.dataset.active !== 'true' },
    });
    toast('Access updated');
    renderStaff(root, ctx);
  };
}
