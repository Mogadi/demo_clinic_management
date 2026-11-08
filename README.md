# Ines Clinic

A small clinic ERP for teaching. One visit moves through six roles, and PostgreSQL keeps the stock, the diary, and the money consistent.

This is a demo. Do not store real patient records in it.

## Roles

| Role | What they own |
| --- | --- |
| Admin | Staff accounts and every desk |
| Receptionist | Registration, booking, check-in, payment |
| Nurse | Vitals after check-in |
| Doctor | Diagnosis, services, prescription, closing the visit |
| Pharmacist | Dispensing and stock |
| Accountant | Invoices, payments, and the service catalog |

A doctor cannot be booked twice for the same slot. A dispensed line cannot drive stock below zero. A payment cannot exceed what is still due. Those rules live in the database, not only in the screen.

## How a visit moves

1. Reception registers the patient and books a doctor.
2. On arrival, reception checks the patient in. That opens the clinical chart.
3. Nursing records vitals. The appointment moves to "with nurse".
4. The doctor writes a diagnosis, chooses services, and prescribes. Closing the visit creates the invoice for those services.
5. Pharmacy dispenses the prescription. Stock falls in the same transaction, and the medicine is added to the invoice.
6. Reception or accounts records payment. The invoice becomes part-paid or paid from the sum of payments.

Prices are copied onto the visit when it is saved. Changing the catalog later does not rewrite old bills.

## Run it

PostgreSQL 16 is provided with Docker. It is published on port 5433 so it does not collide with a Postgres already running on 5432.

```bash
docker compose up -d
npm install
npm start
```

If `docker compose` is not installed, this starts the same database:

```bash
docker run -d --name harborlight-db \
  -e POSTGRES_USER=clinic -e POSTGRES_PASSWORD=clinic -e POSTGRES_DB=clinic \
  -e TZ=Africa/Kigali -p 5433:5432 postgres:16
```

Open http://localhost:3000.

Every demo account uses the password `Clinic123!`.

| Person | Email |
| --- | --- |
| Aline Uwase, admin | admin@harborlight.clinic |
| Eric Habimana, reception | desk@harborlight.clinic |
| Diane Mukamana, nurse | nurse@harborlight.clinic |
| Dr. Amira Hassan, general practice | amira@harborlight.clinic |
| Dr. Omar Khalid, pediatrics | omar@harborlight.clinic |
| Patrick Ndayisaba, pharmacy | pharmacy@harborlight.clinic |
| Grace Ingabire, accounts | accounts@harborlight.clinic |

The database starts empty apart from the staff logins. Patients, the service catalog, medicines, appointments, and bills are blank fields for the class to fill. Currency is Rwandan francs and the clinic clock is `Africa/Kigali`. Both can be changed in `.env` (see `.env.example`).

`npm run smoke` walks one synthetic visit through every role against a running server.

## Data model

The spine is `appointments` → `encounters` → `vitals` / `encounter_services` / `prescriptions` → `invoices` → `payments`.

Stock changes are stored in `stock_movements`. `visit_board`, `invoice_balances`, and `low_stock` are views the API reads. Triggers refuse a negative balance, a payment on a void invoice, and a visit whose patient or doctor does not match the appointment. An exclusion constraint (`btree_gist`) stops overlapping appointments for the same doctor.
