async function nextInvoiceNumber(client) {
  const { rows } = await client.query(`SELECT 'INV-' || nextval('invoice_seq') AS invoice_number`);
  return rows[0].invoice_number;
}

export async function ensureVisitInvoice(client, encounterId, userId) {
  const existing = await client.query(
    `SELECT id FROM invoices WHERE encounter_id = $1 AND status <> 'void'`,
    [encounterId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const encounter = await client.query('SELECT patient_id FROM encounters WHERE id = $1', [encounterId]);
  const created = await client.query(
    `INSERT INTO invoices (invoice_number, patient_id, encounter_id, status, subtotal, total, issued_by)
     VALUES ($1, $2, $3, 'issued', 0, 0, $4)
     RETURNING id`,
    [await nextInvoiceNumber(client), encounter.rows[0].patient_id, encounterId, userId],
  );
  return created.rows[0].id;
}

export async function writeServiceLines(client, encounterId, userId) {
  const services = await client.query(
    `SELECT s.name, es.quantity, es.unit_price
     FROM encounter_services es
     JOIN services s ON s.id = es.service_id
     WHERE es.encounter_id = $1`,
    [encounterId],
  );
  if (services.rows.length === 0) return null;
  const invoiceId = await ensureVisitInvoice(client, encounterId, userId);
  await client.query(`DELETE FROM invoice_lines WHERE invoice_id = $1 AND kind = 'service'`, [invoiceId]);
  for (const line of services.rows) {
    await client.query(
      `INSERT INTO invoice_lines (invoice_id, kind, description, quantity, unit_price, line_total)
       SELECT $1::int, 'service', $2, qty, price, round(qty * price, 2)
       FROM (SELECT $3::int AS qty, $4::numeric AS price) AS line`,
      [invoiceId, line.name, line.quantity, line.unit_price],
    );
  }
  await client.query('SELECT recompute_invoice($1)', [invoiceId]);
  return invoiceId;
}

export async function syncMedicationCharges(client, encounterId, userId) {
  const items = await client.query(
    `SELECT pi.quantity, pi.medication_name, m.unit_price
     FROM prescriptions p
     JOIN prescription_items pi ON pi.prescription_id = p.id
     JOIN medications m ON m.id = pi.medication_id
     WHERE p.encounter_id = $1 AND p.status = 'dispensed'`,
    [encounterId],
  );
  if (items.rows.length === 0) return null;
  const invoiceId = await ensureVisitInvoice(client, encounterId, userId);
  await client.query(`DELETE FROM invoice_lines WHERE invoice_id = $1 AND kind = 'medication'`, [invoiceId]);
  for (const line of items.rows) {
    await client.query(
      `INSERT INTO invoice_lines (invoice_id, kind, description, quantity, unit_price, line_total)
       SELECT $1::int, 'medication', $2, qty, price, round(qty * price, 2)
       FROM (SELECT $3::int AS qty, $4::numeric AS price) AS line`,
      [invoiceId, line.medication_name, line.quantity, line.unit_price],
    );
  }
  await client.query('SELECT recompute_invoice($1)', [invoiceId]);
  return invoiceId;
}
