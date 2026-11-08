import { waitForDatabase } from './db.js';
import { applySchema } from './schema.js';
import { seedIfEmpty } from './seed.js';

waitForDatabase()
  .then(() => applySchema())
  .then(() => seedIfEmpty())
  .then((seeded) => {
    console.log(seeded ? 'Database ready and demo data loaded.' : 'Database ready.');
  })
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
