/**
 * Writes src/environments/environment.ts for a deployed build.
 *
 * The API address is not known when the code is written, so the host (Render) passes it in the API_URL
 * environment variable at build time:
 *
 *   API_URL=https://zingo-api.onrender.com/api node scripts/set-env.mjs && npm run build
 *
 * Without API_URL the file is left alone (local development keeps http://localhost:3020/api).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.env.API_URL?.trim().replace(/\/+$/, '');
if (!url) {
  console.log('API_URL is not set: environment.ts left as it is.');
  process.exit(0);
}
if (!/^https?:\/\//.test(url)) {
  console.error(`API_URL must start with http:// or https:// (got "${url}").`);
  process.exit(1);
}

const file = fileURLToPath(new URL('../src/environments/environment.ts', import.meta.url));
writeFileSync(file, `export const environment = {\n  apiUrl: '${url}',\n};\n`);
console.log(`environment.ts now points at ${url}`);
