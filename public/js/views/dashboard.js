import { api } from '../api.js';
import { clock, esc, fullName, money, pill, when } from '../ui.js';

const FOCUS = {
  admin: 'You can open every desk, from the book to the stock room.',
  receptionist: 'Register the patient, book the doctor, check them in, and take payment when the visit is closed.',
  nurse: 'After check-in, the patient is yours. Record vitals and the doctor will see them in the same chart.',
  doctor: 'Write the diagnosis, choose the services, and prescribe. Closing the visit opens the invoice.',
  pharmacist: 'Dispense what the doctor issued. The stock count and the medicine charge move together.',
  accountant: 'A closed visit becomes an invoice. Record what was paid, or void a bill that has no payment yet.',
};

const PIPELINE = [
  ['Register', 'receptionist'],
  ['Book', 'receptionist'],
  ['Check in', 'receptionist'],
  ['Vitals', 'nurse'],
  ['Consult', 'doctor'],
  ['Dispense', 'pharmacist'],
  ['Pay', 'accountant'],
];

function scheduleCard(schedule) {
  if (!schedule) return '';
  const rows = schedule.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Time</th><th>Patient</th><th>Doctor</th><th>Status</th></tr></thead>
        <tbody>
          ${schedule.map((row) => `<tr>
            <td>${esc(clock(row.scheduledAt))}</td>
            <td><div class="person">${esc(fullName(row))}</div><div class="muted">${esc(row.reason)}</div></td>
            <td>${esc(row.doctorName)}</td>
            <td>${pill(row.status)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`
    : '<p class="empty">Nothing is booked today.</p>';
  return `<article class="card"><h2>Today</h2>${rows}</article>`;
}

export async function renderDashboard(root, ctx) {
  const data = await api('/api/dashboard');
  if (!ctx.alive()) return;
  const cards = [
    ['On today\'s book', data.counts.today],
    ['Still in clinic', data.counts.waiting],
  ];
  if (data.counts.toDispense != null) cards.push(['To dispense', data.counts.toDispense]);
  if (data.counts.openInvoices != null) cards.push(['Open invoices', data.counts.openInvoices]);
  if (data.revenueToday != null) cards.push(['Collected today', money(data.revenueToday)]);
  if (data.counts.lowStock != null) cards.push(['Low stock lines', data.counts.lowStock]);

  root.innerHTML = `
    <p class="muted" style="margin-bottom:14px">${esc(FOCUS[ctx.user.role])}</p>
    <div class="pipeline">
      ${PIPELINE.map(([label, role]) => `<span data-on="${ctx.user.role === role || ctx.user.role === 'admin'}">${esc(label)}</span>`).join('')}
    </div>
    <section class="stats">
      ${cards.map(([label, value]) => `<article class="stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join('')}
    </section>
    <section class="split">
      ${scheduleCard(data.schedule)}
      <div class="stack-cards">
        ${data.queue.length ? `<article class="card"><h2>Waiting now</h2>
          ${data.queue.map((row) => `<p style="margin-bottom:10px"><strong>${esc(fullName(row))}</strong> ${pill(row.status)}<br><span class="muted">${esc(row.reason)}</span></p>`).join('')}
        </article>` : ''}
        ${data.lowStock.length ? `<article class="card"><h2>Reorder</h2>
          ${data.lowStock.map((row) => `<p style="margin-bottom:8px"><strong>${esc(row.name)}</strong><br><span class="muted">${esc(row.quantityOnHand)} on hand, reorder at ${esc(row.reorderLevel)}</span></p>`).join('')}
        </article>` : ''}
        ${data.activity.length ? `<article class="card"><h2>Latest activity</h2>
          ${data.activity.map((row) => `<p style="margin-bottom:8px"><strong>${esc(row.actorName || 'System')}</strong> ${esc(row.action.replaceAll('_', ' '))}<br><span class="muted">${esc(row.detail || '')} · ${esc(when(row.createdAt))}</span></p>`).join('')}
        </article>` : ''}
      </div>
    </section>`;
}
