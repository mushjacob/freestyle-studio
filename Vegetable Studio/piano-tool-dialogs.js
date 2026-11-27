/** Pure form HTML and value parsing for the Piano roll Tools menu (no DOM, no I/O). Beats are quarter notes. */
import {SCALES,CHORD_TYPES,LFO_SHAPES} from './piano-note-tools.js';
export const PIANO_TOOLS=Object.freeze(['arpeggiate','strum','flam','articulate','limit','randomize','quantize','chop','legato','lfo','chord','progression']);
export const PIANO_TOOL_TITLES=Object.freeze({arpeggiate:'Arpeggiate',strum:'Strum',flam:'Flam',articulate:'Articulate',limit:'Limit',randomize:'Randomize',quantize:'Quantizer',chop:'Chop',legato:'Legato',lfo:'Velocity LFO',chord:'Chord',progression:'Chord progression'});
const finite=(value,fallback)=>{if(value===''||value==null)return fallback;const n=Number(value);return Number.isFinite(n)?n:fallback;};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const num=(values,key,fallback,min,max)=>clamp(finite(values?.[key],fallback),min,max);
const int=(values,key,fallback,min,max)=>Math.round(num(values,key,fallback,min,max));
const pick=(value,allowed,fallback)=>allowed.includes(String(value))?String(value):fallback;
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const NOTE_NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const STEPS=[['.0625','1/64 note'],['.125','1/32 note'],['.25','1/16 note'],['.5','1/8 note'],['1','1/4 note']];
/** FL grid list in beats (quarter notes), including triplet-style divisions. */
export const QUANTIZE_GRIDS=Object.freeze([['0.0416666667','1/6 step'],['0.0625','1/4 step'],['0.0833333333','1/3 step'],['0.125','1/2 step (1/32 note)'],['0.1666666667','1/6 beat'],['0.25','Step (1/16 note)'],['0.3333333333','1/3 beat'],['0.5','1/2 beat (1/8 note)'],['1','Beat (1/4 note)'],['4','Bar']]);
const CHORD_OPTIONS=()=>['major','minor','7','maj7','m7','sus2','sus4','dim','aug','add9'].map(id=>[id,CHORD_TYPES[id].label]);
const DIRECTIONS=['up','down'],ARP_PATTERNS=['up','down','updown','random'];
const field=(label,control)=>`<label>${esc(label)}</label>${control}`;
const select=(name,options,value)=>`<select name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}"${String(v)===String(value)?' selected':''}>${esc(l)}</option>`).join('')}</select>`;
const number=(name,value,min,max,step)=>`<input name="${name}" type="number" value="${value}" min="${min}" max="${max}" step="${step}">`;
const scaleOptions=()=>[['none','No scale (chromatic)'],...Object.entries(SCALES).map(([id,def])=>[id,def.label])];
const rootOptions=()=>NOTE_NAMES.map((name,index)=>[String(index),name]);
const scaleFields=()=>field('Scale',select('scale',scaleOptions(),'none'))+field('Root note',select('root',rootOptions(),'0'));
const parseScale=values=>{const id=String(values?.scale??'none');return id!=='none'&&SCALES[id]?{root:int(values,'root',0,0,11),scale:id}:null;};
const FORMS={
  arpeggiate:()=>field('Step',select('step',STEPS,'.25'))+field('Gate (0–200%)',number('gate',90,5,200,5))+field('Pattern',select('pattern',[['up','Up'],['down','Down'],['updown','Up and down'],['random','Random']],'up'))+field('Octaves (1–4)',number('octaves',1,1,4,1)),
  strum:()=>field('Time (beats)',select('time',[['.03125','1/128'],['.0625','1/64'],['.125','1/32'],['.25','1/16']],'.0625'))+field('Tension (−100 to 100)',number('tension',0,-100,100,5))+field('Direction',select('direction',[['up','Up (low to high)'],['down','Down (high to low)']],'up')),
  flam:()=>field('Time (beats)',select('time',[['.015625','1/256'],['.03125','1/128'],['.0625','1/64']],'.03125'))+field('Grace-note velocity (0–100%)',number('velocity',60,0,100,5))+field('Grace notes (1–4)',number('count',1,1,4,1)),
  articulate:()=>field('Length (0–400%)',number('length',100,0,400,5))+field('Velocity (0–400%)',number('velocity',100,0,400,5))+field('Length curve (−100 to 100)',number('lengthCurve',0,-100,100,5))+field('Velocity curve (−100 to 100)',number('velocityCurve',0,-100,100,5)),
  limit:()=>field('Lowest note (0–127)',number('low',36,0,127,1))+field('Highest note (0–127)',number('high',96,0,127,1))+scaleFields(),
  quantize:()=>field('Time (grid)',select('grid',QUANTIZE_GRIDS,'0.25'))+field('Start strength (0–100%)',number('startStrength',100,0,100,5))+field('End strength (0–100%)',number('endStrength',0,0,100,5))+field('Sensitivity (±% of grid, 100 = all notes)',number('sensitivity',100,0,100,5)),
  chop:()=>field('Time (grid)',select('step',QUANTIZE_GRIDS,'0.25'))+field('Rhythm (x = note, - = rest)',`<input name="pattern" type="text" value="x-x-xx--" maxlength="64" spellcheck="false">`),
  legato:()=>field('Gap (beats, 0–1)',number('gap',0,0,1,.0625))+`<label><input name="onlySelected" type="checkbox" checked> Only selected notes</label>`,
  lfo:()=>field('Shape',select('shape',LFO_SHAPES.map(id=>[id,id[0].toUpperCase()+id.slice(1)]),'sine'))+field('Cycles (0–64)',number('cycles',1,0,64,.5))+field('Amount (0–100%)',number('amount',50,0,100,5))+field('Center velocity (0–100%)',number('center',50,0,100,5)),
  chord:()=>field('Chord',select('type',CHORD_OPTIONS(),'major'))+field('Inversion (0–3)',number('inversion',0,0,3,1)),
  progression:()=>field('Key',select('root',rootOptions(),'0'))+field('Scale',select('scale',Object.entries(SCALES).filter(([id])=>id!=='chromatic').map(([id,def])=>[id,def.label]),'major'))+field('Degrees (e.g. 1-5-6-4)',`<input name="degrees" type="text" value="1-5-6-4" maxlength="64" spellcheck="false">`),
  randomize:()=>field('Step',select('step',STEPS,'.25'))+field('Density (0–100%)',number('density',50,0,100,5))+field('Lowest note (0–127)',number('low',48,0,127,1))+field('Highest note (0–127)',number('high',72,0,127,1))+scaleFields()+field('Velocity min (0–100%)',number('velocityMin',50,0,100,5))+field('Velocity max (0–100%)',number('velocityMax',100,0,100,5))+field('Longest note (steps, 1–8)',number('maxSteps',1,1,8,1))+field('Seed (0 = new random)',number('seed',0,0,2147483647,1))
};
/** Dialog body (form with an Apply button) for a tool. */
export function toolFormHtml(tool){
  const body=FORMS[tool];if(!body)throw new Error(`Unknown piano tool: ${tool}`);
  return`<form class="piano-tool-form" data-tool="${esc(tool)}">${body()}<button type="submit" class="primary">Apply</button><button type="button" class="cancel">Cancel</button></form>`;
}
/** Plain `{name: string|boolean}` form values to options for the matching function in piano-note-tools.js. Bad input falls back to defaults; ranges clamp. */
export function parseToolForm(tool,values={}){
  switch(tool){
    case'arpeggiate':return{step:num(values,'step',.25,.0625,1),gate:num(values,'gate',90,5,200)/100,pattern:pick(values?.pattern,ARP_PATTERNS,'up'),octaves:int(values,'octaves',1,1,4),seed:Math.floor(Math.random()*2147483646)+1};
    case'strum':return{time:num(values,'time',.0625,.03125,.25),tension:num(values,'tension',0,-100,100)/100,direction:pick(values?.direction,DIRECTIONS,'up')};
    case'flam':return{time:num(values,'time',.03125,.015625,.0625),velocity:num(values,'velocity',60,0,100)/100,count:int(values,'count',1,1,4)};
    case'articulate':return{length:num(values,'length',100,0,400)/100,velocity:num(values,'velocity',100,0,400)/100,lengthCurve:num(values,'lengthCurve',0,-100,100)/100,velocityCurve:num(values,'velocityCurve',0,-100,100)/100};
    case'limit':{let low=int(values,'low',36,0,127),high=int(values,'high',96,0,127);if(low>high)[low,high]=[high,low];return{low,high,scale:parseScale(values)};}
    case'randomize':{let low=int(values,'low',48,0,127),high=int(values,'high',72,0,127);if(low>high)[low,high]=[high,low];let velocityMin=num(values,'velocityMin',50,0,100)/100,velocityMax=num(values,'velocityMax',100,0,100)/100;if(velocityMin>velocityMax)[velocityMin,velocityMax]=[velocityMax,velocityMin];const maxSteps=int(values,'maxSteps',1,1,8),seed=int(values,'seed',0,0,2147483647);return{step:num(values,'step',.25,.0625,1),density:num(values,'density',50,0,100)/100,low,high,scale:parseScale(values),velocityMin,velocityMax,durationSteps:Array.from({length:maxSteps},(_,i)=>i+1),seed:seed||Math.floor(Math.random()*2147483646)+1};}
    case'quantize':{const endStrength=num(values,'endStrength',0,0,100)/100;return{grid:num(values,'grid',.25,.04,4),startStrength:num(values,'startStrength',100,0,100)/100,endStrength,sensitivity:num(values,'sensitivity',100,0,100)/100,quantizeEnds:endStrength>0};}
    case'chop':{const pattern=String(values?.pattern??'x-x-xx--').toLowerCase().replace(/[^x-]/g,'');return{step:num(values,'step',.25,.04,4),pattern:pattern.includes('x')?pattern:'x-x-xx--'};}
    case'legato':return{gap:num(values,'gap',0,0,1),onlySelected:values?.onlySelected===true||values?.onlySelected==='on'||values?.onlySelected==='true'||(values?.onlySelected==null&&Object.keys(values||{}).length===0)};
    case'lfo':return{shape:pick(values?.shape,LFO_SHAPES,'sine'),cycles:num(values,'cycles',1,0,64),amount:num(values,'amount',50,0,100)/100,center:num(values,'center',50,0,100)/100};
    case'chord':return{type:pick(values?.type,Object.keys(CHORD_TYPES),'major'),inversion:int(values,'inversion',0,0,3)};
    case'progression':{const degrees=String(values?.degrees??'1-5-6-4').replace(/[^0-9,\s-]/g,'').trim();return{root:int(values,'root',0,0,11),scale:pick(values?.scale,Object.keys(SCALES).filter(id=>id!=='chromatic'),'major'),degrees:/[1-9]/.test(degrees)?degrees:'1-5-6-4'};}
    default:throw new Error(`Unknown piano tool: ${tool}`);
  }
}
