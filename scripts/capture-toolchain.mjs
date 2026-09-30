import { readFile,writeFile } from 'node:fs/promises';
import { cpus,totalmem,type,release,arch,availableParallelism } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../dist/node/math/hash.js';

const root = fileURLToPath(new URL('../',import.meta.url));
const names = ['typescript','vite','vitest','zod','playwright','@types/node'];
const packages = Object.fromEntries(await Promise.all(names.map(async (name) => [name,JSON.parse(await readFile(resolve(root,'node_modules',name,'package.json'),'utf8')).version])));
const npm = spawnSync(process.execPath,[resolve(root,'.tools/node-v24.21.0-win-x64/node_modules/npm/bin/npm-cli.js'),'--version'],{ encoding: 'utf8',windowsHide: true });
const playwrightBrowsers = JSON.parse(await readFile(resolve(root,'node_modules/playwright-core/browsers.json'),'utf8')).browsers;
const browser = JSON.parse(await readFile(resolve(root,'artifacts/phase-0/browser.json'),'utf8'));
const result = {
  schemaVersion: 1,id: 'phase0-win-x64-node24.21.0',verifiedDateLocal: '2026-10-01',timezone: 'Asia/Shanghai',
  node: { version: process.version,v8: process.versions.v8,platform: process.platform,arch: process.arch,npm: npm.stdout.trim(),distribution: 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip',distributionSha256: '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541',preexistingSystemNode: 'v22.16.0',preexistingSystemNpm: '10.9.2' },
  machine: { os: type(),release: release(),arch: arch(),cpu: cpus()[0]?.model,logicalCores: availableParallelism(),totalMemoryBytes: totalmem() },
  packages,packageLockSha256: sha256(await readFile(resolve(root,'package-lock.json'))),
  chromium: { ...playwrightBrowsers.find((item) => item.name === 'chromium'),actualVersion: browser.browserVersion,validatedCanvas: true,validatedLocalFont: true },
  fonts: { probe: 'IBM Plex Mono Regular',sha256: sha256(await readFile(resolve(root,'public/fonts/engine-probe.ttf'))),license: 'SIL OFL 1.1',chineseExportValidated: false },
  encoding: { ffmpegOnPath: false,ffprobeOnPath: false,libx264Validated: false,aacValidated: false,playwrightBundledFfmpegRevision: '1011',status: 'production encoder and ffprobe deferred to Phase 4; Playwright helper is not the validated export toolchain' },
  deterministicBoundary: 'same build, fixed Node/V8, same compiled content, seed and inputs',
};
await writeFile(resolve(root,'toolchain-lock.json'),`${JSON.stringify(result,null,2)}\n`);
console.log(`Captured ${result.id} with Chromium ${browser.browserVersion}.`);
