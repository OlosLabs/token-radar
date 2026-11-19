import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildRadar, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const json = (value: unknown) => `${JSON.stringify(value)}\n`;

function copyFiles(from: string, to: string) {
  mkdirSync(to, { recursive: true });
  const entries = readdirSync(from, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.'));
  for (const entry of entries) {
    if (!entry.isFile() || !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(entry.name)) {
      throw new Error(`Expected a plain artifact with a gate-safe name: ${entry.name}`);
    }
    copyFileSync(join(from, entry.name), join(to, entry.name));
  }
  return entries.length;
}

function run() {
  const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' } } });
  const input = values.input ?? '/input/snapshot.json';
  const inputFile = input.endsWith('.json') ? input : join(input, 'snapshot.json');
  const out = resolve(values.output ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const bytes = readFileSync(inputFile);
  const snapshot_sha256 = createHash('sha256').update(bytes).digest('hex');
  const radar = { ...buildRadar(parseSnapshot(bytes.toString('utf8'))), snapshot_sha256 };
  const { rows, counts, as_of, source, fit, validation, exclusions, plan_audit } = radar;
  const board = json({ as_of, source, snapshot_sha256, counts, fit, validation, exclusions, plan_audit, rows });
  if (Buffer.byteLength(board) > 8 * 1024 * 1024) throw new Error('board.json exceeds the 8 MiB gate cap.');
  for (const { slug, farm_steps } of rows) {
    if (farm_steps.length < 3 || farm_steps.length > 12 || farm_steps.some(step => {
      const length = step.trim().length;
      return length < 20 || length > 600;
    })) throw new Error(`Farm plan is outside the gate bounds: ${slug}`);
  }
  if (counts.covered !== counts.watch) throw new Error('The board must cover the full sealed watchlist.');

  mkdirSync(out, { recursive: true });
  copyFiles(join(root, 'dashboard'), join(out, 'dashboard'));
  const imageCount = copyFiles(join(root, 'screenshots'), join(out, 'screenshots'));
  if (imageCount < 3 || imageCount > 4) throw new Error('Include three or four browser captures under screenshots/.');
  writeFileSync(join(out, 'board.json'), board);
  // Embed data in a local script, served beside dashboard/ so its dossier text stays readable.
  writeFileSync(join(out, 'data.js'), `window.FIELD = ${json(radar).trim().replace(/</g, '\\u003c')};\n`);
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65536 }));
  console.log(`fieldbook: ${as_of}; ${counts.ranked}/${counts.total} ranked; ${counts.covered}/${counts.watch} watchlist; ${radar.peers.length} traded observations; ${imageCount} captures`);
}

try {
  run();
} catch (error) {
  console.error(`fieldbook: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
