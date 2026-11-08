-- Ines Clinic
-- One visit is the spine of the schema:
--   appointment -> encounter -> vitals / services / prescription -> invoice -> payment
-- Prices are copied onto visit lines so a later catalog change does not rewrite history.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SEQUENCE IF NOT EXISTS patient_mrn_seq START WITH 1001;
CREATE SEQUENCE IF NOT EXISTS invoice_seq START WITH 1001;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'receptionist', 'nurse', 'doctor', 'pharmacist', 'accountant')),
  phone TEXT,
  specialty TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patients (
  id SERIAL PRIMARY KEY,
  mrn TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  gender TEXT CHECK (gender IN ('female', 'male', 'other', 'unknown')),
  phone TEXT,
  email TEXT,
  address TEXT,
  blood_type TEXT CHECK (blood_type IS NULL OR blood_type IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  allergies TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('consultation', 'procedure', 'lab')),
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS medications (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  form TEXT,
  strength TEXT,
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  quantity_on_hand INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients (id),
  doctor_id INTEGER NOT NULL REFERENCES users (id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ,
  duration_min INTEGER NOT NULL DEFAULT 30 CHECK (duration_min IN (15, 20, 30, 45, 60)),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'checked_in', 'with_nurse', 'with_doctor', 'completed', 'cancelled', 'no_show'
  )),
  notes TEXT,
  created_by INTEGER REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- timestamptz + interval is not immutable, so the end is stored and the
-- overlap rule compares two plain timestamps.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION set_appointment_end() RETURNS trigger AS $$
BEGIN
  NEW.scheduled_end := NEW.scheduled_at + make_interval(mins => NEW.duration_min);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_set_end ON appointments;
CREATE TRIGGER appointments_set_end
  BEFORE INSERT OR UPDATE OF scheduled_at, duration_min ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_appointment_end();

UPDATE appointments
   SET scheduled_end = scheduled_at + make_interval(mins => duration_min)
 WHERE scheduled_end IS NULL;

ALTER TABLE appointments ALTER COLUMN scheduled_end SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doctor_no_overlap') THEN
    ALTER TABLE appointments
      ADD CONSTRAINT doctor_no_overlap
      EXCLUDE USING gist (
        doctor_id WITH =,
        tstzrange(scheduled_at, scheduled_end, '[)') WITH &&
      )
      WHERE (status NOT IN ('cancelled', 'no_show'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS encounters (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments (id),
  patient_id INTEGER NOT NULL REFERENCES patients (id),
  doctor_id INTEGER NOT NULL REFERENCES users (id),
  chief_complaint TEXT,
  diagnosis TEXT,
  clinical_notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS vitals (
  id SERIAL PRIMARY KEY,
  encounter_id INTEGER NOT NULL REFERENCES encounters (id),
  recorded_by INTEGER NOT NULL REFERENCES users (id),
  temperature NUMERIC(4, 1),
  systolic INTEGER,
  diastolic INTEGER,
  pulse INTEGER,
  respiratory_rate INTEGER,
  weight_kg NUMERIC(5, 1),
  height_cm NUMERIC(5, 1),
  spo2 INTEGER,
  notes TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS encounter_services (
  id SERIAL PRIMARY KEY,
  encounter_id INTEGER NOT NULL REFERENCES encounters (id),
  service_id INTEGER NOT NULL REFERENCES services (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  UNIQUE (encounter_id, service_id)
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id SERIAL PRIMARY KEY,
  encounter_id INTEGER NOT NULL UNIQUE REFERENCES encounters (id),
  patient_id INTEGER NOT NULL REFERENCES patients (id),
  doctor_id INTEGER NOT NULL REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'dispensed', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispensed_at TIMESTAMPTZ,
  dispensed_by INTEGER REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS prescription_items (
  id SERIAL PRIMARY KEY,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions (id) ON DELETE CASCADE,
  medication_id INTEGER REFERENCES medications (id) ON DELETE SET NULL,
  medication_name TEXT NOT NULL,
  dosage TEXT,
  frequency TEXT,
  duration TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  instructions TEXT
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  medication_id INTEGER NOT NULL REFERENCES medications (id),
  change_qty INTEGER NOT NULL CHECK (change_qty <> 0),
  reason TEXT NOT NULL CHECK (reason IN ('receive', 'dispense', 'adjust')),
  prescription_id INTEGER REFERENCES prescriptions (id),
  note TEXT,
  created_by INTEGER REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients (id),
  encounter_id INTEGER REFERENCES encounters (id),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'partial', 'paid', 'void')),
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  issued_by INTEGER REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_live_invoice_per_visit
  ON invoices (encounter_id)
  WHERE encounter_id IS NOT NULL AND status <> 'void';

CREATE TABLE IF NOT EXISTS invoice_lines (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices (id),
  kind TEXT NOT NULL CHECK (kind IN ('service', 'medication', 'other')),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices (id),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'insurance', 'transfer')),
  reference TEXT,
  received_by INTEGER REFERENCES users (id),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users (id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patients_name_idx ON patients (lower(last_name), lower(first_name));
CREATE INDEX IF NOT EXISTS appointments_when_idx ON appointments (scheduled_at);
CREATE INDEX IF NOT EXISTS appointments_doctor_idx ON appointments (doctor_id, scheduled_at);
CREATE INDEX IF NOT EXISTS appointments_patient_idx ON appointments (patient_id);
CREATE INDEX IF NOT EXISTS encounters_patient_idx ON encounters (patient_id);
CREATE INDEX IF NOT EXISTS vitals_encounter_idx ON vitals (encounter_id);
CREATE INDEX IF NOT EXISTS prescriptions_status_idx ON prescriptions (status, created_at);
CREATE INDEX IF NOT EXISTS invoices_patient_idx ON invoices (patient_id, status);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS stock_movements_med_idx ON stock_movements (medication_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_created_idx ON activity_log (created_at DESC);

CREATE OR REPLACE FUNCTION encounter_matches_appointment() RETURNS trigger AS $$
DECLARE
  appt appointments%ROWTYPE;
BEGIN
  SELECT * INTO appt FROM appointments WHERE id = NEW.appointment_id;
  IF appt.patient_id <> NEW.patient_id OR appt.doctor_id <> NEW.doctor_id THEN
    RAISE EXCEPTION 'Visit does not match the appointment patient and doctor';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS encounters_match_appointment ON encounters;
CREATE TRIGGER encounters_match_appointment
  BEFORE INSERT OR UPDATE ON encounters
  FOR EACH ROW EXECUTE FUNCTION encounter_matches_appointment();

CREATE OR REPLACE FUNCTION prevent_negative_stock() RETURNS trigger AS $$
BEGIN
  IF NEW.quantity_on_hand < 0 THEN
    RAISE EXCEPTION 'Not enough % on hand', NEW.name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS medications_no_negative ON medications;
CREATE TRIGGER medications_no_negative
  BEFORE INSERT OR UPDATE OF quantity_on_hand ON medications
  FOR EACH ROW EXECUTE FUNCTION prevent_negative_stock();

CREATE OR REPLACE FUNCTION recompute_invoice(inv_id INTEGER) RETURNS void AS $$
DECLARE
  new_total NUMERIC(12, 2);
  paid NUMERIC(12, 2);
  new_status TEXT;
BEGIN
  SELECT COALESCE(SUM(line_total), 0) INTO new_total FROM invoice_lines WHERE invoice_id = inv_id;
  SELECT COALESCE(SUM(amount), 0) INTO paid FROM payments WHERE invoice_id = inv_id;
  IF paid <= 0 THEN
    new_status := 'issued';
  ELSIF paid < new_total THEN
    new_status := 'partial';
  ELSE
    new_status := 'paid';
  END IF;
  UPDATE invoices
     SET subtotal = new_total,
         total = new_total,
         status = new_status
   WHERE id = inv_id
     AND status <> 'void';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_payment() RETURNS trigger AS $$
DECLARE
  inv invoices%ROWTYPE;
  already NUMERIC(12, 2);
BEGIN
  SELECT * INTO inv FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF inv.status = 'void' THEN
    RAISE EXCEPTION 'Cannot take payment on a void invoice';
  END IF;
  IF NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO already FROM payments WHERE invoice_id = NEW.invoice_id;
  IF already + NEW.amount > inv.total THEN
    RAISE EXCEPTION 'Payment is more than the amount still due';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_guard ON payments;
CREATE TRIGGER payments_guard
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION guard_payment();

CREATE OR REPLACE FUNCTION payments_refresh_status() RETURNS trigger AS $$
BEGIN
  PERFORM recompute_invoice(NEW.invoice_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_refresh ON payments;
CREATE TRIGGER payments_refresh
  AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_refresh_status();

CREATE OR REPLACE VIEW visit_board AS
SELECT a.id AS appointment_id,
       a.patient_id,
       a.doctor_id,
       a.scheduled_at,
       a.duration_min,
       a.reason,
       a.status,
       a.notes,
       p.mrn,
       p.first_name,
       p.last_name,
       p.phone,
       p.allergies,
       u.full_name AS doctor_name,
       u.specialty AS doctor_specialty,
       e.id AS encounter_id,
       e.status AS encounter_status,
       e.diagnosis
FROM appointments a
JOIN patients p ON p.id = a.patient_id
JOIN users u ON u.id = a.doctor_id
LEFT JOIN encounters e ON e.appointment_id = a.id;

CREATE OR REPLACE VIEW invoice_balances AS
SELECT i.id,
       i.invoice_number,
       i.patient_id,
       i.encounter_id,
       i.status,
       i.total,
       i.issued_by,
       i.created_at,
       COALESCE(SUM(p.amount), 0) AS amount_paid,
       i.total - COALESCE(SUM(p.amount), 0) AS balance
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.id
GROUP BY i.id;

CREATE OR REPLACE VIEW low_stock AS
SELECT id, sku, name, form, strength, quantity_on_hand, reorder_level, unit_price
FROM medications
WHERE is_active AND quantity_on_hand <= reorder_level;

-- Extra columns start empty. A class fills them from the forms.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS national_id TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS occupation TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_provider TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_number TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS kin_relationship TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS chronic_conditions TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS current_medications TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS visit_type TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS priority TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS room TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS referral_from TEXT;

ALTER TABLE encounters ADD COLUMN IF NOT EXISTS icd_code TEXT;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS treatment_plan TEXT;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS follow_up_on DATE;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS advice TEXT;

ALTER TABLE medications ADD COLUMN IF NOT EXISTS generic_name TEXT;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS manufacturer TEXT;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS supplier TEXT;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS batch_number TEXT;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS storage_location TEXT;

ALTER TABLE services ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS department TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS license_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hire_date DATE;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_on DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payer_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patients_marital_status_check') THEN
    ALTER TABLE patients ADD CONSTRAINT patients_marital_status_check
      CHECK (marital_status IS NULL OR marital_status IN ('single', 'married', 'divorced', 'widowed', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_visit_type_check') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_visit_type_check
      CHECK (visit_type IS NULL OR visit_type IN ('new', 'follow_up', 'walk_in'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_priority_check') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_priority_check
      CHECK (priority IS NULL OR priority IN ('routine', 'urgent', 'emergency'));
  END IF;
END $$;
