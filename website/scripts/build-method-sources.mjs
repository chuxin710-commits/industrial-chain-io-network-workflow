import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const paths = [
  'research/DATA_CONTRACT.md',
  'research/critical_sectors/METHODS.md',
  'research/critical_sectors/model.py',
  'research/critical_sectors/legacy_sir.py',
  'research/critical_sectors/published/config.json',
  'research/structure_resilience/METHODS.md',
  'research/structure_resilience/model.py',
  'research/structure_resilience/run_experiments.py',
  'research/structure_resilience/published/config.json',
  'website/server/topology.py',
];
const files = [];
for (const path of paths) {
  const content = await readFile(resolve(root, path));
  files.push({ path, sha256: createHash('sha256').update(content).digest('hex') });
}
const manifest = {
  version: 'methods-handbook-v1',
  repositoryCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  files,
  critical: JSON.parse(
    await readFile(resolve(root, 'research/critical_sectors/published/config.json'), 'utf8'),
  ),
  structure: JSON.parse(
    await readFile(resolve(root, 'research/structure_resilience/published/config.json'), 'utf8'),
  ),
};
await writeFile(
  resolve(root, 'website/src/method-sources.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(`Method sources: ${files.length} files hashed`);
// The tutor and handbook share one definition, never client-supplied formulas.
const { methods } = await import('../src/method-catalog.js');
const context = { methods, sources: manifest };
await writeFile(resolve(root, 'website/server/method_catalog.json'), JSON.stringify({
  version: createHash('sha256').update(JSON.stringify(context)).digest('hex'), ...context,
}, null, 2) + '\n');
