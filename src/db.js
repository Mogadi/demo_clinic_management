import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));
pg.types.setTypeParser(1082, (value) => value);

function connectionString() {
  const url = new URL(config.databaseUrl);
  const options = url.searchParams.get('options') || '';
  if (!options.includes('TimeZone')) {
    url.searchParams.set('options', `${options} -c TimeZone=${config.clinicTz}`.trim());
  }
  return url.toString();
}

export const pool = new pg.Pool({ connectionString: connectionString() });

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already failed */
    }
    throw error;
  } finally {
    client.release();
  }
}

export function camel(input) {
  if (Array.isArray(input)) return input.map(camel);
  if (input instanceof Date) return input.toISOString();
  if (input && typeof input === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      const next = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      out[next] = camel(value);
    }
    return out;
  }
  return input;
}

export async function waitForDatabase() {
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError;
}
