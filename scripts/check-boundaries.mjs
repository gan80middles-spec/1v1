import { readFile,readdir,mkdir,writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../',import.meta.url));
const src = resolve(root,'src');
const allowed = {
  contracts: new Set(['contracts']),
  math: new Set(['contracts','math']),
  content: new Set(['contracts','math','content']),
  sim: new Set(['contracts','math','sim']),
  ai: new Set(['contracts','math','ai']),
  director: new Set(['contracts','math','director']),
  replay: new Set(['contracts','math','replay']),
  render: new Set(['contracts','math','replay','render']),
  runner: new Set(['contracts','math','content','sim','ai','director','replay','runner']),
  analysis: new Set(['contracts','math','analysis']),
  web: new Set(['contracts','math','content','runner','sim','ai','director','replay','render','analysis','web']),
  cli: new Set(['contracts','math','content','runner','analysis','render','replay','jobs','cli']),
  jobs: new Set(['contracts','math','content','runner','analysis','render','replay','jobs']),
};
const pure = new Set(['contracts','math','content','sim','ai','director','replay','render','runner','analysis']);
const builtins = new Set(builtinModules.flatMap((name) => [name,`node:${name}`]));

function diagnose(text,path) {
  const layer = relative(src,path).replaceAll('\\','/').split('/')[0];
  const errors = [];
  const source = ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true);
  const report = (node,message) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
    errors.push(`${relative(root,path).replaceAll('\\','/')}:${line}: ${message}`);
  };
  const inspectImport = (specifier,node) => {
    if (specifier.startsWith('.')) {
      const targetPath = resolve(dirname(path),specifier);
      const target = relative(src,targetPath).replaceAll('\\','/');
      if (target.startsWith('../')) {
        if (layer !== 'web' || !(target.startsWith('../content/fixtures/')||target==='../content/fighter-phase1.json'||target==='../content/fighter-phase2.json'||target==='../content/fighter-phase3a.json')) report(node,`source import escapes src: ${specifier}`);
      } else if (!allowed[layer]?.has(target.split('/')[0])) report(node,`${layer} may not depend on ${target.split('/')[0]} (${specifier})`);
    } else if (pure.has(layer)) {
      if (builtins.has(specifier)) report(node,`Node dependency forbidden in ${layer}: ${specifier}`);
      else if (!(layer === 'contracts' && specifier === 'zod')) report(node,`external dependency forbidden in ${layer}: ${specifier}`);
    }
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) inspectImport(node.moduleSpecifier.text,node);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) inspectImport(node.argument.literal.text,node);
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument)) inspectImport(argument.text,node);
        else if (pure.has(layer)) report(node,'computed import forbidden in pure modules');
      }
      if (pure.has(layer) && ts.isPropertyAccessExpression(node.expression)) {
        const expression = node.expression.getText(source);
        if (expression === 'Math.random' || expression === 'Date.now' || expression === 'performance.now') report(node,`nondeterministic API forbidden: ${expression}`);
      }
      if (pure.has(layer) && ts.isIdentifier(node.expression) && ['setTimeout','setInterval','fetch','eval'].includes(node.expression.text)) report(node,`side-effect API forbidden: ${node.expression.text}`);
    }
    if (pure.has(layer) && ts.isIdentifier(node) && ['document','window','process'].includes(node.text)) report(node,`host global forbidden in ${layer}: ${node.text}`);
    ts.forEachChild(node,visit);
  };
  visit(source);
  return errors;
}
async function files(dir) {
  const entries = await readdir(dir,{ withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(resolve(dir,entry.name)) : entry.name.endsWith('.ts') ? [resolve(dir,entry.name)] : []))).flat();
}

// 验证检查器能够发现反向 type import、动态 Node I/O 和随机源。
const forbiddenExamples = [
  ['sim/test.ts',"import type { X } from '../ai/hidden.js';"],
  ['sim/test.ts',"const x = import('node:fs');"],
  ['math/test.ts','const x = Math.random();'],
  ['sim/test.ts','document.body;'],
  ['render/test.ts',"import '../sim/step.js';"],
];
for (const [path,code] of forbiddenExamples) if (!diagnose(code,resolve(src,path)).length) throw new Error(`Boundary self-test failed: ${path} ${code}`);
const paths = await files(src);
const errors = (await Promise.all(paths.map(async (path) => diagnose(await readFile(path,'utf8'),path)))).flat();
const reportPath = resolve(root,process.argv[2]??'artifacts/phase-0/boundaries.json');
await mkdir(dirname(reportPath),{ recursive: true });
await writeFile(reportPath,JSON.stringify({ checkedFiles: paths.length,selfTests: forbiddenExamples.length,passed: !errors.length,errors },null,2));
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Module boundaries passed: ${paths.length} source files, ${forbiddenExamples.length} negative self-tests.`);
