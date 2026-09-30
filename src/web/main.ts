import fixture from '../../content/fixtures/phase0.json';
import { compileContent } from '../content/compile.js';
import { createNeutralConfig, runNeutralMatch } from '../runner/neutral.js';
import './style.css';

const content = compileContent(fixture);
const form = document.querySelector<HTMLFormElement>('#run-form')!;
const output = document.querySelector<HTMLElement>('#output')!;
const canvas = document.querySelector<HTMLCanvasElement>('#arena')!;
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas 2D is unavailable');

function run(seed: number): void {
  const report = runNeutralMatch(content,createNeutralConfig(content,seed,600));
  output.textContent = JSON.stringify({ seed,ticks: report.executedTicks,states: report.stateCount,finalWorldHash: report.finalWorldHash,stateSequenceHash: report.stateSequenceHash },null,2);
  output.dataset['finalHash'] = report.finalWorldHash;
  context!.fillStyle = '#0b1220';
  context!.fillRect(0,0,480,480);
  context!.strokeStyle = '#344764';
  context!.strokeRect(1,1,478,478);
  for (const entity of report.finalState.entities) {
    context!.beginPath();
    context!.arc(entity.body.position.x/2,480-entity.body.position.y/2,entity.body.radius/2,0,Math.PI*2);
    context!.fillStyle = entity.id === 1 ? '#4b91ed' : '#ffad57';
    context!.fill();
  }
  document.documentElement.dataset['ready'] = 'true';
}
form.addEventListener('submit',(event) => {
  event.preventDefault();
  const text = new FormData(form).get('seed');
  const seed = Number(text);
  if (typeof text !== 'string' || !/^\d+$/.test(text) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    output.textContent = 'Seed 必须是 0～4294967295 的整数。';
    return;
  }
  run(seed);
});
run(17);
