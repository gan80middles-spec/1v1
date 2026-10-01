import assert from 'node:assert/strict';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { resolve,extname,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { compileContent } from '../dist/node/content/compile.js';
import { createNeutralConfig,runNeutralMatch } from '../dist/node/runner/neutral.js';

const root = fileURLToPath(new URL('../',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(root,'.cache/ms-playwright');
const { chromium } = await import('playwright');
const webRoot = resolve(root,'dist/web');
const failures = [];
const server = createServer(async (request,response) => {
  try {
    const url = new URL(request.url ?? '/','http://127.0.0.1');
    const path = resolve(webRoot,`.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    const local = relative(webRoot,path);
    if (local.startsWith('..') || local.includes(':')) { response.writeHead(403).end(); return; }
    const bytes = await readFile(path);
    const type = { '.html': 'text/html; charset=utf-8','.js': 'text/javascript','.css': 'text/css','.ttf': 'font/ttf' }[extname(path)] ?? 'application/octet-stream';
    response.writeHead(200,{ 'Content-Type': type }); response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise((accept,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',accept); });
const address = server.address();
assert(address && typeof address !== 'string');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100,height: 1080 },deviceScaleFactor: 1 });
  page.on('pageerror',(error) => failures.push(error.message));
  page.on('requestfailed',(request) => failures.push(`request failed ${request.url()}`));
  await page.goto(`http://127.0.0.1:${address.port}/phase0.html`,{ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  const fontCount = await page.evaluate(async () => {
    await document.fonts.ready;
    const fonts = await document.fonts.load('16px EngineProbe','Local font loading probe');
    return fonts.length;
  });
  assert.equal(fontCount,1,'local font not loaded');
  const canvas = await page.evaluate(() => {
    const canvas = document.querySelector('#arena');
    const ctx = canvas.getContext('2d');
    return { width: canvas.width,height: canvas.height,pixel: [...ctx.getImageData(120,464,1,1).data] };
  });
  assert.equal(canvas.width,480); assert.equal(canvas.height,480);
  assert.deepEqual(canvas.pixel,[75,145,237,255]);
  const content = compileContent(JSON.parse(await readFile(resolve(root,'content/fixtures/phase0.json'),'utf8')));
  for (const seed of [17,18]) {
    if (seed !== 17) {
      await page.locator('#seed').fill(String(seed));
      await page.getByRole('button',{ name: '运行 600 tick' }).click();
    }
    const actual = await page.locator('#output').getAttribute('data-final-hash');
    const expected = runNeutralMatch(content,createNeutralConfig(content,seed,600)).finalWorldHash;
    assert.equal(actual,expected,`browser and Node mismatch for seed ${seed}`);
  }
  await page.locator('#seed').fill('17');
  await page.getByRole('button',{ name: '运行 600 tick' }).click();
  const output = resolve(root,'artifacts/phase-0');
  await mkdir(output,{ recursive: true });
  await page.screenshot({ path: resolve(output,'browser.png'),fullPage: true });
  assert.deepEqual(failures,[]);
  const result = { passed: true,browserVersion: browser.version(),playwrightVersion: JSON.parse(await readFile(resolve(root,'node_modules/playwright/package.json'),'utf8')).version,viewport: { width: 1100,height: 1080 },deviceScaleFactor: 1,canvas,fontFacesLoaded: fontCount,fontStatus: await page.evaluate(() => document.fonts.status),nodeBrowserMatchingSeeds: [17,18],pageErrors: failures,screenshot: 'artifacts/phase-0/browser.png' };
  await writeFile(resolve(output,'browser.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {
  await browser?.close();
  await new Promise((accept) => server.close(accept));
}
