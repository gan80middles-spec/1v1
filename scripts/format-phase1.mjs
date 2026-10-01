import {readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';
const files=['src/contracts/fighter.ts','src/contracts/fighter-schema.ts','src/content/fighter.ts','src/math/geometry.ts','src/math/fighter-phase.ts','src/sim/fighter-state.ts','src/sim/fighter.ts','src/sim/abilities/effective.ts','src/sim/physics/motion.ts','src/runner/fighter.ts','src/runner/observation.ts','src/runner/input-replay.ts','src/ai/scripted.ts','src/replay/frame.ts','src/render/canvas.ts','src/web/main.ts','tests/fighter.test.ts','tests/runner-fighter.test.ts'];
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
for(const file of files){const text=await readFile(file,'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);if(source.parseDiagnostics.length)throw new Error(`Cannot format invalid source: ${file}`);await writeFile(file,printer.printFile(source));}
console.log(`Formatted ${files.length} Phase 1 TypeScript files.`);
