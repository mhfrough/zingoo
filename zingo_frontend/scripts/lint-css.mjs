/**
 * lint-css.mjs - style rules the house requires (run with `npm run lint:css`; exit code 1 on any finding).
 *   1. z-index only from the --z-* tokens: a raw number is allowed in src/styles/tokens.css and nowhere else.
 *   2. viewport units: dvh / dvw / svh / svw / lvh / lvw only; plain vh / vw are rejected.
 * Scans every .css, .html and .ts file under src/ (inline component styles and templates included).
 * Owned by the design-system session.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TOKENS = ['styles', 'tokens.css'].join(sep);
const EXTENSIONS = ['.css', '.html', '.ts'];

/** every file under `dir` with one of the scanned extensions */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTENSIONS.some((e) => name.endsWith(e))) yield full;
  }
}

const findings = [];
for (const file of walk(root)) {
  const rel = relative(root, file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, ''); // ignore comments
    if (rel !== TOKENS && /z-index\s*:\s*-?\d/.test(code)) {
      findings.push(`${rel}:${i + 1}  raw z-index number, use a --z-* token: ${line.trim()}`);
    }
    if (/\d(vh|vw)\b/.test(code)) {
      findings.push(`${rel}:${i + 1}  vh / vw unit, use dvh / dvw (or svh / svw): ${line.trim()}`);
    }
  });
}

if (findings.length) {
  console.error(findings.join('\n'));
  console.error(`\nlint:css found ${findings.length} problem(s).`);
  process.exit(1);
}
console.log('lint:css passed: no raw z-index numbers, no vh / vw units.');
