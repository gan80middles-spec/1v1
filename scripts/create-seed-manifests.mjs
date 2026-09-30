import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve,dirname } from 'node:path';
import { createSeedManifests } from '../dist/node/runner/datasets.js';
import { canonicalSerialize } from '../dist/node/math/canonical.js';

const root = fileURLToPath(new URL('../',import.meta.url));
const check = process.argv.includes('--check');
for (const [name,manifest] of Object.entries(createSeedManifests())) {
  const path = resolve(root,'fixtures/seeds',`${name}.json`);
  const expected = `${canonicalSerialize(manifest)}\n`;
  if (check) {
    if (await readFile(path,'utf8') !== expected) throw new Error(`Frozen manifest drift: ${name}`);
  } else {
    // 既有清单只能显式 --replace 重建；失败 seed 不会被常规验证替换。
    await mkdir(dirname(path),{ recursive: true });
    await writeFile(path,expected,{ encoding: 'utf8',flag: process.argv.includes('--replace') ? 'w' : 'wx' });
  }
  console.log(`${check ? 'Verified' : 'Created'} ${name}: ${manifest.caseCount} cases, ${manifest.datasetHash}`);
}
