import { api } from '../api.js';
import { esc, formObject, fullName, money, openModal, pill, toast } from '../ui.js';

export async function renderPharmacy(root, ctx) {
  const canDispense = ['admin', 'pharmacist'].includes(ctx.user.role);
  const [queue, stock] = await Promise.all([
    api('/api/pharmacy/prescriptions?status=issued'),
    canDispense || ctx.user.role === 'doctor' ? api('/api/pharmacy/medications?all=1') : { medications: [] },
  ]);
  if (!ctx.alive()) return;
  root.innerHTML = `
    <section class="split">
      <article class="card">
        <h2>Waiting to dispense</h2>
        ${queue.prescriptions.length ? queue.prescriptions.map((rx) => `
          <article class="rx-card">
            <strong>${esc(fullName(rx))}</strong> <span class="muted">${esc(rx.mrn)} · ${esc(rx.doctorName)}</span>
            ${rx.allergies ? `<p class="alert">Allergies: ${esc(rx.allergies)}</p>` : '<p class="muted">No allergies recorded</p>'}
            <ul>${rx.items.map((item) => `<li>${esc(item.medicationName)} · ${esc(item.dosage || '')} · ${esc(item.frequency || '')} · qty ${esc(item.quantity)}${item.onHand != null ? ` · ${esc(item.onHand)} on hand` : ''}</li>`).join('')}</ul>
            ${canDispense ? `<button class="btn primary" data-dispense="${rx.id}" type="button">Dispense</button>` : pill(rx.status)}
          </article>`).join('') : '<p class="empty">No prescriptions are waiting.</p>'}
      </article>
      <article class="card">
        <div class="toolbar"><h2>Stock</h2>${canDispense ? '<button class="btn tiny" id="add-med" type="button">Add item</button>' : ''}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Item</th><th>On hand</th><th>Price</th><th></th></tr></thead>
          <tbody>
            ${stock.medications.map((item) => `<tr>
              <td><div class="person">${esc(item.name)}</div><div class="muted">${esc(item.sku)} · ${esc(item.strength || '')}</div></td>
              <td>${item.quantityOnHand <= item.reorderLevel ? '<span class="pill" data-status="partial">Low</span>' : ''} ${esc(item.quantityOnHand)}</td>
              <td>${esc(money(item.unitPrice))}</td>
              <td>${canDispense ? `<button class="btn tiny" data-receive="${item.id}" data-name="${esc(item.name)}" type="button">Receive</button>` : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </article>
    </section>`;

  root.querySelector('#add-med')?.addEventListener('click', () => {
    openModal({
      title: 'Add medication',
      body: `<div class="grid-2">
        <label>Name<input name="name" required></label>
        <label>SKU<input name="sku" required></label>
        <label>Form<input name="form" placeholder="tablet"></label>
        <label>Strength<input name="strength" placeholder="500 mg"></label>
        <label>Price<input name="unitPrice" type="number" min="0" required></label>
        <label>On hand<input name="quantityOnHand" type="number" min="0"></label>
        <label>Reorder at<input name="reorderLevel" type="number" min="0"></label>
        <label>Generic name<input name="genericName"></label>
        <label>Manufacturer<input name="manufacturer"></label>
        <label>Supplier<input name="supplier"></label>
        <label>Batch number<input name="batchNumber"></label>
        <label>Expiry date<input name="expiryDate" type="date"></label>
        <label>Storage location<input name="storageLocation" placeholder="Shelf A"></label>
      </div>`,
      onSubmit: async (form) => {
        const body = formObject(form);
        body.unitPrice = Number(body.unitPrice);
        body.quantityOnHand = Number(body.quantityOnHand);
        body.reorderLevel = Number(body.reorderLevel);
        await api('/api/pharmacy/medications', { method: 'POST', body });
        toast('Medication added');
        renderPharmacy(root, ctx);
      },
    });
  });

  root.onclick = async (event) => {
    const dispense = event.target.closest('[data-dispense]');
    const receive = event.target.closest('[data-receive]');
    if (dispense) {
      dispense.disabled = true;
      try {
        await api(`/api/pharmacy/prescriptions/${dispense.dataset.dispense}/dispense`, { method: 'POST', body: {} });
        toast('Dispensed. Stock and the invoice are updated.');
        renderPharmacy(root, ctx);
      } catch (error) {
        toast(error.message, 'bad');
        dispense.disabled = false;
      }
    }
    if (receive) {
      openModal({
        title: `Receive ${receive.dataset.name}`,
        submitLabel: 'Receive',
        body: `<label>Quantity received<input name="quantity" type="number" min="1" required></label>
          <label>Note<input name="note" placeholder="Delivery reference"></label>`,
        onSubmit: async (form) => {
          const body = formObject(form);
          await api(`/api/pharmacy/medications/${receive.dataset.receive}/receive`, {
            method: 'POST',
            body: { quantity: Number(body.quantity), note: body.note },
          });
          toast('Stock received');
          renderPharmacy(root, ctx);
        },
      });
    }
  };
}
