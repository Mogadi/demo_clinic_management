import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function applySchema() {
  const file = path.join(root, 'db', 'schema.sql');
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [config.databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', file], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `psql exited with ${code}`));
    });
  });
}
