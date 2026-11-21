import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildDossier } from '../vendor/makefun-board.ts';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '../output');
mkdirSync(output, { recursive: true });
const run = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(output, 'consistency-verified-'));
if (process.argv[2]) for (const label of ['build-a', 'build-b']) mkdirSync(join(run, label));
const a = join(run, 'build-a'), b = join(run, 'build-b');
const build = dir => {
  const result = spawnSync(process.execPath, [join(root,'main.ts'), '--input', resolve(root,'../kit/token-radar-01-kit/input/snapshot.json'), '--output',dir], { encoding:'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const stdout = build(a);
assert.equal(build(b), stdout);
function files(dir, prefix='') {
  return readdirSync(join(dir,prefix),{withFileTypes:true}).flatMap(e => e.isDirectory() ? files(dir,join(prefix,e.name)) : [join(prefix,e.name)]).sort();
}
const paths = files(a);
assert.deepEqual(paths, files(b));
const hashes = {};
for (const path of paths) {
  const bytes = readFileSync(join(a,path));
  assert.deepEqual(bytes, readFileSync(join(b,path)), path);
  hashes[path] = createHash('sha256').update(bytes).digest('hex');
}
const dossierBytes = readFileSync(join(a,'dossier.json'));
assert.deepEqual(dossierBytes, Buffer.from(buildDossier(a,{text_max_bytes:65536})));
const dossier = JSON.parse(dossierBytes);
const textBytes = Buffer.byteLength(dossier.text);
assert.ok(65536 - textBytes >= 1024, `Only ${65536-textBytes} bytes headroom`);
assert.ok(!/^## Cut/m.test(dossier.text));
for (const path of files(join(root,'dashboard'))) {
  assert.ok(dossier.text.includes(readFileSync(join(root,'dashboard',path),'utf8').trimEnd()), `Incomplete source ${path}`);
}
assert.ok(dossier.text.trimEnd().endsWith('```'));
assert.ok(dossier.text.includes('else globalThis.FarmScenario = api;'));
assert.ok(dossierBytes.length <= 1.5*1024*1024);
const board = JSON.parse(readFileSync(join(a,'board.json'),'utf8'));
assert.equal(board.rows.length,203);
assert.equal(board.counts.covered,40);
const fingerprint = createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
const report = { root:run, preview:join(a,'dashboard/index.html'), stdout, identical_files:paths.length,
  source_text_bytes:textBytes, source_headroom:65536-textBytes, dossier_bytes:dossierBytes.length,
  complete_source:true, dossier_reproduced:true, fingerprint, hashes };
writeFileSync(join(run,'verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
