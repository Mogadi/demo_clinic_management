import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { waitForDatabase } from './db.js';
import { applySchema } from './schema.js';
import { seedIfEmpty } from './seed.js';
import { mapDbError } from './http.js';
import { requireAuth } from './auth.js';
import { authRouter } from './routes/auth.js';
import { patientRouter } from './routes/patients.js';
import { appointmentRouter } from './routes/appointments.js';
import { encounterRouter } from './routes/encounters.js';
import { pharmacyRouter } from './routes/pharmacy.js';
import { billingRouter } from './routes/billing.js';
import { catalogRouter, dashboardRouter } from './routes/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();

app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api', requireAuth);
app.use('/api/patients', patientRouter);
app.use('/api/appointments', appointmentRouter);
app.use('/api/encounters', encounterRouter);
app.use('/api/pharmacy', pharmacyRouter);
app.use('/api/billing', billingRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(express.static(path.join(root, 'public')));
app.use((error, _req, res, _next) => {
  const mapped = error.code ? mapDbError(error) : error;
  const status = mapped.status || 500;
  if (status >= 500) console.error(mapped);
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on the server' : mapped.message,
  });
});

async function start() {
  await waitForDatabase();
  await applySchema();
  const seeded = await seedIfEmpty();
  app.listen(config.port, () => {
    console.log(`${config.clinicName} is ready on http://localhost:${config.port}`);
    if (seeded) console.log('Demo staff password: Clinic123!');
  });
}

start().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
