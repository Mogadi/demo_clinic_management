import { api } from '../api.js';
import { esc, formObject, fullName, money, pill, toast, when } from '../ui.js';

export async function renderBilling(root, ctx) {
  if (ctx.id) return renderInvoice(root, ctx);
  let status = 'open';
  await draw();

  async function draw() {
    const data = await api(`/api/billing/invoices${status ? `?status=${status}` : ''}`);
    if (!ctx.alive()) return;
    root.innerHTML = `
      <div class="toolbar">
        <form class="inline" id="filter">
          <select name="status">
            <option value="open" ${status === 'open' ? 'selected' : ''}>Open</option>
            <option value="paid" ${status === 'paid' ? 'selected' : ''}>Paid</option>
            <option value="" ${status === '' ? 'selected' : ''}>All</option>
          </select>
        </form>
      </div>
      <article class="card">
        ${data.invoices.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Invoice</th><th>Patient</th><th>Total</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            ${data.invoices.map((invoice) => `<tr>
              <td><button class="linkish" data-open="${invoice.id}" type="button">${esc(invoice.invoiceNumber)}</button><div class="muted">${esc(when(invoice.createdAt))}</div></td>
              <td>${esc(fullName(invoice))}<div class="muted">${esc(invoice.mrn)}</div></td>
              <td>${esc(money(invoice.total))}</td>
              <td>${esc(money(invoice.balance))}</td>
              <td>${pill(invoice.status)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : '<p class="empty">No invoices in this list.</p>'}
      </article>`;
    root.querySelector('#filter').onchange = (event) => {
      status = formObject(event.target).status;
      draw().catch((error) => toast(error.message, 'bad'));
    };
    root.querySelector('tbody')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-open]');
      if (button) location.hash = `#/billing/${button.dataset.open}`;
    });
  }
}

async function renderInvoice(root, ctx) {
  const data = await api(`/api/billing/invoices/${ctx.id}`);
  if (!ctx.alive()) return;
  const invoice = data.invoice;
  const canVoid = ['admin', 'accountant'].includes(ctx.user.role) && invoice.payments.length === 0 && invoice.status !== 'void';
  root.innerHTML = `
    <div class="toolbar">
      <button class="btn ghost" id="back" type="button">All invoices</button>
      ${canVoid ? '<button class="btn" id="void" type="button">Void invoice</button>' : ''}
    </div>
    <section class="grid-3">
      <article class="card">
        <p class="muted">${esc(invoice.invoiceNumber)} · ${esc(invoice.mrn)}</p>
        <h2>${esc(fullName(invoice))} ${pill(invoice.status)}</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead>
          <tbody>
            ${invoice.lines.map((line) => `<tr><td>${esc(line.description)}<div class="muted">${esc(line.kind)}</div></td><td>${esc(line.quantity)}</td><td>${esc(money(line.lineTotal))}</td></tr>`).join('')}
          </tbody>
        </table></div>
        <p style="margin-top:12px"><strong>Due ${esc(money(invoice.balance))}</strong> of ${esc(money(invoice.total))}</p>
        ${invoice.payments.map((payment) => `<p class="muted">${esc(when(payment.paidAt))} · ${esc(payment.method)} · ${esc(money(payment.amount))} · ${esc(payment.receivedByName || '')}</p>`).join('')}
      </article>
      ${invoice.balance > 0 ? `<article class="card"><h2>Take payment</h2>
        <form id="pay" class="stack">
          <label>Amount<input name="amount" type="number" min="1" max="${invoice.balance}" value="${invoice.balance}" required></label>
          <label>Method
            <select name="method">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="insurance">Insurance</option>
              <option value="transfer">Transfer</option>
            </select>
          </label>
          <label>Reference<input name="reference" placeholder="Receipt number"></label>
          <button class="btn primary" type="submit">Record payment</button>
        </form>
      </article>` : ''}
    </section>`;
  root.querySelector('#back').onclick = () => { location.hash = '#/billing'; };
  root.querySelector('#pay')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = formObject(event.target);
    try {
      await api(`/api/billing/invoices/${invoice.id}/payments`, {
        method: 'POST',
        body: { amount: Number(body.amount), method: body.method, reference: body.reference },
      });
      toast('Payment recorded');
      renderInvoice(root, ctx);
    } catch (error) {
      toast(error.message, 'bad');
    }
  });
  root.querySelector('#void')?.addEventListener('click', async () => {
    try {
      await api(`/api/billing/invoices/${invoice.id}/void`, { method: 'POST', body: {} });
      toast('Invoice voided');
      location.hash = '#/billing';
    } catch (error) {
      toast(error.message, 'bad');
    }
  });
}
