import {LEGACY_AUTOMATION_CONTRACT,LIVE_AUTOMATION_CONTRACT,assertAutomationWritePreservesData,automationReadbackDifferences,assertAutomationJsonValue} from './audacity-automation-contract.js';
import {hasCanonicalTruncation} from './cloud-session.js';
import {captureWriteRequest} from './cloud-errors.js';
import {bridgeFetch} from './freestyle-host-transport.js';
/** Edit Freestyle's persisted automation envelopes; playback remains on its cloud engine. */
const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>structuredClone(value);
const curves=new Set(['linear','hold','bezier']);
export function normalizeAutomationPoints(points,durationSec) {
  const duration=Number(durationSec);if(!Number.isFinite(duration)||duration<0)throw new Error('Automation duration must be finite and non-negative.');
  const unique=new Map();
  for(const point of points||[]) {
    if(!Number.isFinite(Number(point.timeSec))||!Number.isFinite(Number(point.value)))continue;
    const timeSec=Math.round(clamp(point.timeSec,0,duration)*1e6)/1e6,curve=curves.has(point.curve)?point.curve:'linear';
    unique.set(timeSec,{timeSec,value:clamp(point.value,0,1),curve,tension:curve==='bezier'?clamp(point.tension||0,-1,1):0});
  }
  return [...unique.values()].sort((a,b)=>a.timeSec-b.timeSec);
}
export function automationValue(points,timeSec) {
  if(!points?.length)return 0;
  if(timeSec<points[0].timeSec)return points[0].value;
  if(timeSec>=points.at(-1).timeSec)return points.at(-1).value;
  for(let i=1;i<points.length;i++) {
    const start=points[i-1],end=points[i];if(timeSec>=end.timeSec)continue;
    if(start.curve==='hold'||end.timeSec<=start.timeSec)return start.value;
    let position=clamp((timeSec-start.timeSec)/(end.timeSec-start.timeSec),0,1);
    if(start.curve==='bezier'){const exponent=1+Math.abs(start.tension||0)*9;position=start.tension>=0?Math.pow(position,exponent):1-Math.pow(1-position,exponent);}
    // Geometric interpolation is linear in dB. Exact knots are resolved above;
    // a zero endpoint uses the nonnegative geometric limit, not an invented
    // epsilon. Native edited gains themselves stay above their1e-7 floor.
    if(start.curve==='db')return position===0?start.value:position===1?end.value:Math.exp(Math.log(start.value)*(1-position)+Math.log(end.value)*position);
    return start.value+(end.value-start.value)*position;
  }
  return points.at(-1).value;
}
export function automationWrite(envelope,points,projectId) {
  if(hasCanonicalTruncation(envelope)||envelope.complete===false)throw new Error('Freestyle returned a partial envelope. Reload all points before editing it.');
  assertAutomationJsonValue(points);
  const args={project_id:projectId,points:copy(points),idempotency_key:crypto.randomUUID()};
  if(envelope.defaultValue!==undefined){if(typeof envelope.defaultValue!=='number'||!Number.isFinite(envelope.defaultValue))throw new Error('Reload the envelope’s known default value.');args.default_value=envelope.defaultValue;}
  if(envelope.valueType!==undefined)args.value_type=envelope.valueType;
  if(envelope.persisted&&envelope.id) {
    if(!Number.isSafeInteger(envelope.revision)||envelope.revision<0)throw new Error('Reload the envelope to obtain its current revision.');
    return{name:'update_automation',arguments:{...args,envelope_id:envelope.id,expected_revision:Number(envelope.revision)}};
  }
  if(!envelope.clipId||!envelope.target?.kind)throw new Error('Select a canonical cloud clip and target first.');
  return{name:'create_automation',arguments:{...args,clip_id:envelope.clipId,target:copy(envelope.target)}};
}
function unwrap(result) {
  assertAutomationJsonValue(result);
  let data=result?.structuredContent;if(!data&&Array.isArray(result?.content)){try{data=JSON.parse(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));}catch{}}
  data=data??result;const response=data?.response??data;
  if(result?.isError||data?.error||data?.ok===false||response?.error||response?.ok===false){const error=new Error(response?.message||response?.error?.message||response?.error||data?.message||'Freestyle could not save automation.');error.code=response?.code||data?.code;error.result=data;throw error;}
  return response;
}
async function defaultCall(name,args) {
  const response=await bridgeFetch('modesty-bridge:/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})});
  const data=await response.json();if(!response.ok)throw new Error(data.detail||data.error||`Cloud automation request failed (${response.status}).`);return unwrap(data);
}
function stylesheet(){if(document.querySelector('link[data-vegetable-automation]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./automation-ui.css',import.meta.url);link.dataset.vegetableAutomation='true';document.head.append(link);}

/** cloudCall(name, arguments) may return a raw MCP result or already-unwrapped JSON. */
export async function openAutomationEditor({project,getProject=()=>project,getContext=()=>null,getAutomationContract=()=>LEGACY_AUTOMATION_CONTRACT,prepareWrite=async()=>{},cloudCall=defaultCall,onChanged=()=>{},clipId}={}) {
  const projectId=project?.cloud?.projectId||project?.id,context=getContext();if(!projectId)throw new Error('Open a Freestyle cloud project before editing automation.');
  const {clipEnvelopeWindow,canonicalEnvelopeClipId}=await import('./audacity-envelope.js');
  stylesheet();
  const dialog=document.createElement('dialog');dialog.className='vegetable-automation';
  dialog.innerHTML=`<header><span class="automation-icon">⌁</span><strong>Automation editor</strong><span class="automation-cloud">FREESTYLE ENGINE</span><button class="automation-close" aria-label="Close automation editor">×</button></header><div class="automation-body"><div class="automation-top"><label>Clip / parameter<select class="automation-select" aria-label="Automation clip and parameter"></select></label><label>Snap<select class="automation-snap"><option value=".25">¼ beat</option><option value="1">1 beat</option><option value="0">Off</option></select></label><button class="automation-reload" title="Read the current cloud revision">↻ Reload</button></div><div class="automation-detail"></div><div class="automation-graph-wrap"><svg class="automation-graph" viewBox="0 0 800 270" role="img" aria-label="Editable automation envelope. Click to add points, drag to move, right-click to remove."></svg></div><div class="automation-point"><label>Time <input class="automation-time" type="number" min="0" step="0.001"> s</label><label>Value <input class="automation-value" type="number" min="0" max="1" step="0.001"></label><label>Curve <select class="automation-curve"><option>linear</option><option>hold</option><option>bezier</option></select></label><label>Tension <input class="automation-tension" type="range" min="-1" max="1" step="0.01"></label><button class="automation-remove">Remove point</button></div><div class="automation-presets"><span>PRESETS</span><button data-preset="unity">Unity</button><button data-preset="fade-in">Fade in</button><button data-preset="fade-out">Fade out</button><button data-preset="duck">Duck</button></div><p class="automation-status" role="status">Reading cloud automation…</p><footer><span>Point times are relative to this clip. Save sends the envelope to Freestyle.</span><button class="automation-save primary">Save envelope</button></footer></div>`;
  document.body.append(dialog);dialog.showModal();
  const $=selector=>dialog.querySelector(selector),graph=$('.automation-graph'),select=$('.automation-select'),status=$('.automation-status');
  let envelopes=[],current=null,points=[],selected=0,duration=0,dirty=false,busy=false,closed=false,loadGeneration=0,readError='',writeLocked=false,receipt=null,windowBinding=null;
  Object.defineProperty(dialog,'automationState',{get:()=>copy({current,points,duration,dirty,busy,readError,writeLocked,receipt})});
  const currentProject=()=>{const live=getProject();return live?.cloud?.projectId||live?.id;};
  const assertScope=()=>{if(closed||getContext()!==context||currentProject()!==projectId)throw new Error('The automation editor’s project changed. Reopen it before editing.');};
  const complete=data=>{if(!data||typeof data!=='object'||hasCanonicalTruncation(data)||data.complete===false||data.has_more===true||data.hasMore===true||data.nextCursor||data.next_cursor)throw new Error('Freestyle returned incomplete automation. Reload all canonical data before editing.');if((data.projectId??data.project_id)!==undefined&&(data.projectId??data.project_id)!==projectId)throw new Error('Freestyle returned automation from a different project.');};
  const completeList=data=>{if(!data||typeof data!=='object')throw new Error('Freestyle returned no automation list.');const {envelopes,automation,...metadata}=data;complete(metadata);const rows=envelopes??automation;if(!Array.isArray(rows))throw new Error('Freestyle returned no canonical automation list.');return rows;};
  const placementBinding=envelope=>{
    const live=getProject(),clips=[...(live?.clips||[]),...(live?.audioClips||[])],matches=clips.filter(clip=>{try{return canonicalEnvelopeClipId(clip)===envelope.clipId;}catch{return false;}});
    if(matches.length!==1)throw new Error('The canonical clip placement duration is unavailable. Reload the project before editing automation.');
    const window=clipEnvelopeWindow(matches[0],live.bpm);if(!window.offsetKnown||!(window.durationSec>0))throw new Error(window.reason||'The canonical source window is unavailable.');
    const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
    return {window,fingerprint:JSON.stringify(stable({clip:matches[0],window}))};
  };
  const placementWindow=envelope=>placementBinding(envelope).window;
  const assertBinding=()=>{assertScope();if(windowBinding!==placementBinding(current).fingerprint)throw new Error('The clip placement or source window changed. Reload before editing automation.');};
  const validateCanonical=envelope=>{assertAutomationJsonValue(envelope);complete(envelope);if(typeof envelope.clipId!=='string'||!envelope.clipId||!envelope.target?.kind||!Array.isArray(envelope.points))throw new Error('Freestyle returned an unknown canonical automation target or point array.');if(!Number.isSafeInteger(envelope.revision)||envelope.revision<0||typeof envelope.persisted!=='boolean'||envelope.persisted&&!envelope.id)throw new Error('Reload automation to obtain its canonical identity and revision.');return envelope;};
  const preflight=()=>{assertBinding();if(readError)throw new Error(readError);if(writeLocked)throw new Error('The last automation write needs reconciliation. Reload before saving again.');return assertAutomationWritePreservesData({points,envelope:current,window:placementWindow(current),contract:getAutomationContract()});};
  const gain=()=>current?.target?.kind==='clip_gain';
  const formatValue=value=>gain()?value<=0?'−∞ dB':`${(20*Math.log10(value*4)).toFixed(1)} dB`:`${(value*100).toFixed(1)}%`;
  const clipName=value=>{const id=String(value??'unknown');
    if(id.startsWith('pattern:')){const raw=id.slice(8),clip=project.clips?.find(clip=>String(clip.cloudId||clip.id)===raw),pattern=project.patterns?.find(pattern=>pattern.id===clip?.patternId);return pattern?.name||clip?.name||`Pattern placement ${raw.slice(0,8)}`;}
    const clip=project.audioClips?.find(clip=>String(clip.cloudId||clip.id)===id)||project.cloud?.rawProject?.clips?.find(clip=>String(clip.id)===id);
    return clip?.name||clip?.title||(id.startsWith('backing:')?'Backing track':`Audio clip ${id.slice(0,8)}`);
  };
  const key=envelope=>`${envelope.clipId}:${envelope.targetKey||envelope.target?.kind||''}`;
  const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
  const markDirty=()=>{dirty=true;message('Unsaved envelope changes');render();};
  function choose(envelope){
    current=null;points=[];selected=0;dirty=false;readError='';writeLocked=false;duration=0;windowBinding=null;
    try{assertAutomationJsonValue(envelope);current=copy(envelope);points=copy(envelope.points??[]);validateCanonical(current);const binding=placementBinding(current),window=binding.window;duration=window.durationSec;windowBinding=binding.fingerprint;assertAutomationWritePreservesData({points,envelope:current,window,contract:getAutomationContract()});}catch(error){readError=error.message;}
    render();message(readError|| (current.persisted?`Cloud envelope · revision ${current.revision}`:'Default curve · Save creates a cloud envelope'),!!readError);
  }
  function render(){
    const disabled=busy||!current||!!readError||writeLocked,curveSelect=$('.automation-curve'),allowDb=gain()&&getAutomationContract()===LIVE_AUTOMATION_CONTRACT;let dbOption=curveSelect.querySelector('[value="db"]');if(allowDb&&!dbOption){dbOption=document.createElement('option');dbOption.value='db';dbOption.textContent='db';curveSelect.append(dbOption);}else if(!allowDb)dbOption?.remove();
    select.disabled=busy;$('.automation-reload').disabled=busy;
    for(const input of dialog.querySelectorAll('.automation-point input,.automation-point select,.automation-presets button,.automation-save,.automation-remove'))input.disabled=disabled;
    $('.automation-save').textContent=busy?'Saving…':'Save envelope';graph.classList.toggle('disabled',!!disabled);
    if(!current||readError){graph.innerHTML='';$('.automation-detail').textContent=readError||'';return;}
    $('.automation-detail').textContent=`${current.target?.name||'Volume'} · ${duration.toFixed(3)} s · ${points.length} points · ${current.persisted?'Saved envelope':'Default curve'}`;
    const x=time=>50+time/duration*730,y=value=>20+(1-value)*220;
    let content='';
    for(let step=0;step<=8;step++){const time=duration*step/8;content+=`<line x1="${x(time)}" y1="20" x2="${x(time)}" y2="240" class="automation-grid"/><text x="${x(time)}" y="258" text-anchor="middle">${time.toFixed(time<10?2:1)}s</text>`;}
    for(const value of [0,.25,.5,.75,1])content+=`<line x1="50" y1="${y(value)}" x2="780" y2="${y(value)}" class="${gain()&&value===.25?'automation-unity':'automation-grid'}"/><text x="43" y="${y(value)+4}" text-anchor="end">${gain()?value===0?'−∞':`${Math.round(20*Math.log10(value*4))}dB`:`${Math.round(value*100)}%`}</text>`;
    const path=Array.from({length:257},(_,i)=>{const time=i/256*duration,value=points.length?automationValue(points,time):current.defaultValue;return `${i?'L':'M'}${x(time).toFixed(2)},${y(value).toFixed(2)}`;}).join(' ');
    content+=`<path class="automation-fill" d="${path} L780,240 L50,240 Z"/><path class="automation-line" d="${path}"/>`;
    points.forEach((point,index)=>content+=`<circle data-point="${index}" class="automation-node ${index===selected?'selected':''}" cx="${x(point.timeSec)}" cy="${y(point.value)}" r="${index===selected?5.5:4.5}"><title>${point.timeSec.toFixed(3)}s · ${esc(formatValue(point.value))}</title></circle>`);
    graph.innerHTML=content;
    const point=points[selected];if(point){$('.automation-time').value=String(point.timeSec);$('.automation-time').max=duration;$('.automation-value').value=String(point.value);$('.automation-curve').value=point.curve;$('.automation-tension').value=point.tension||0;$('.automation-tension').disabled=disabled||point.curve!=='bezier';}
  }
  async function reload(preferred){
    const generation=++loadGeneration;busy=true;render();message('Reading cloud automation…');
    try{const data=unwrap(await cloudCall('list_automation',{project_id:projectId,...(clipId?{clip_ids:[String(clipId)]}:{})}));if(closed||generation!==loadGeneration)return;assertScope();
      envelopes=completeList(data);
      if(data.truncated)message('Freestyle returned a limited set of envelopes. Select a listed clip to edit it.');
      select.innerHTML=envelopes.map((envelope,index)=>`<option value="${index}">${esc(clipName(envelope.clipId))} — ${esc(envelope.target?.name||envelope.targetKey||'Volume')}</option>`).join('');
      const preferredKey=preferred|| (current&&key(current)),requested=clipId?String(clipId):'';
      let index=envelopes.findIndex(envelope=>key(envelope)===preferredKey);if(index<0&&requested)index=envelopes.findIndex(envelope=>envelope.clipId===requested||envelope.clipId===`pattern:${requested}`);if(index<0)index=0;
      busy=false;
      if(envelopes.length){select.value=String(index);choose(envelopes[index]);}else{current=null;render();message('This cloud project has no audio clips or pattern placements. Place a pattern or import audio first.');}
    }catch(error){busy=false;readError=error.message;render();message(error.message,true);}
  }
  select.onchange=()=>{if(busy)return;choose(envelopes[Number(select.value)]);};
  $('.automation-reload').onclick=()=>reload();
  const fromPointer=event=>{const rect=graph.getBoundingClientRect(),svgX=(event.clientX-rect.left)/rect.width*800,svgY=(event.clientY-rect.top)/rect.height*270;let time=clamp((svgX-50)/730,0,1)*duration;const snap=Number($('.automation-snap').value)*60/(Number(project.bpm)||120);if(snap>0)time=Math.round(time/snap)*snap;return{timeSec:clamp(time,0,duration),value:clamp(1-(svgY-20)/220,0,1)};};
  graph.onpointerdown=event=>{
    if(event.button!==0||busy||!current||readError||writeLocked)return;event.preventDefault();
    const node=event.target.closest('[data-point]');
    if(node)selected=Number(node.dataset.point);else{const position=fromPointer(event);let index=points.findIndex(point=>point.timeSec>position.timeSec);if(index<0)index=points.length;points.splice(index,0,{...position,curve:'linear',tension:0});selected=index;dirty=true;}
    graph.setPointerCapture(event.pointerId);render();
    graph.onpointermove=move=>{if(busy||readError||writeLocked)return;const position=fromPointer(move);points[selected]={...points[selected],...position};dirty=true;message(`${position.timeSec.toFixed(3)} s · ${formatValue(position.value)} · Unsaved`);render();};
    graph.onpointerup=graph.onpointercancel=()=>{graph.onpointermove=null;graph.onpointerup=null;if(dirty)markDirty();else render();};
  };
  const remove=()=>{if(busy||readError||writeLocked)return;if(points.length<=2){message('Keep at least two points in the envelope.');return;}points.splice(selected,1);selected=Math.min(selected,points.length-1);markDirty();};
  graph.oncontextmenu=event=>{event.preventDefault();const node=event.target.closest('[data-point]');if(node&&!busy&&!readError&&!writeLocked){selected=Number(node.dataset.point);remove();}};
  $('.automation-remove').onclick=remove;
  for(const [selector,field]of [['.automation-time','timeSec'],['.automation-value','value'],['.automation-curve','curve'],['.automation-tension','tension']])$(selector).onchange=event=>{if(!points[selected]||busy||readError||writeLocked)return;points[selected][field]=field==='curve'?event.target.value:Number(event.target.value);markDirty();};
  for(const button of dialog.querySelectorAll('[data-preset]'))button.onclick=()=>{
    if(busy||readError||writeLocked)return;if(!gain()&&typeof current.defaultValue!=='number'){message('Reload this target’s known default value before applying a preset.',true);return;}
    const base=gain() ? .25 : current.defaultValue,point=(timeSec,value)=>({timeSec,value,curve:'linear',tension:0});
    const fade=Math.min(duration/2,60/(project.bpm||120));
    points=button.dataset.preset==='fade-in'?[point(0,0),point(fade,base),point(duration,base)]:button.dataset.preset==='fade-out'?[point(0,base),point(duration-fade,base),point(duration,0)]:button.dataset.preset==='duck'?[point(0,base*.15),point(Math.min(duration,.25*60/(project.bpm||120)),base*.15),point(Math.min(duration,60/(project.bpm||120)),base),point(duration,base)]:[point(0,base),point(duration,base)];
    selected=0;markDirty();
  };
  $('.automation-save').onclick=async()=>{
    if(!current||busy)return;
    try{preflight();}catch(error){message(error.message,true);return;}
    busy=true;render();message('Saving envelope in Freestyle…');
    try{
      const captured=copy(current),draft=copy(points);await prepareWrite();assertBinding();preflight();
      if(automationReadbackDifferences({points:draft},{points}).length)throw new Error('The automation draft changed while pending edits were saved.');
      const generated=automationWrite(captured,draft,projectId),write=captureWriteRequest(generated.name,generated.arguments);
      writeLocked=true;receipt={write:copy(write),raw:null,result:null,readbackRaw:null,readback:null,status:'pending',verified:false};
      const raw=await cloudCall(write.name,write.arguments);assertAutomationJsonValue(raw);receipt.raw=copy(raw);const data=unwrap(raw);receipt.result=copy(data);receipt.status='acknowledged';assertBinding();
      const acknowledged=data.envelope||data;validateCanonical(acknowledged);
      if(acknowledged.persisted!==true||typeof acknowledged.id!=='string'||!acknowledged.id||acknowledged.clipId!==captured.clipId||automationReadbackDifferences({target:captured.target},acknowledged).length>0||acknowledged.revision<=captured.revision)throw new Error('Freestyle did not acknowledge the captured automation identity and a newer revision.');
      const readRaw=await cloudCall('list_automation',{project_id:projectId,clip_ids:[captured.clipId]});assertAutomationJsonValue(readRaw);receipt.readbackRaw=copy(readRaw);const read=unwrap(readRaw);assertBinding();
      const rows=completeList(read);
      const matches=rows.filter(row=>row.id===acknowledged.id&&row.clipId===captured.clipId);if(matches.length!==1)throw new Error('Freestyle did not return exactly one saved automation envelope.');
      const saved=validateCanonical(matches[0]);receipt.readback=copy(saved);
      const differences=automationReadbackDifferences({...write.arguments,target:captured.target,clip_id:captured.clipId},saved);
      if(saved.revision!==acknowledged.revision)differences.push('revision');
      if(saved.persisted!==true)differences.push('persisted');
      if(differences.length)throw new Error(`Automation readback differs from the captured write (${differences.join(', ')}). Reload to reconcile; the write will not be retried.`);
      receipt.verified=true;receipt.status='verified';current=copy(saved);points=copy(saved.points);dirty=false;writeLocked=false;busy=false;render();await onChanged(copy(saved));message('Envelope saved and verified in Freestyle.');
    }catch(error){if(receipt&&writeLocked){receipt.error={message:error.message,...(error.code?{code:error.code}:{})};receipt.status=receipt.status==='acknowledged'?'unverified':'uncertain';}busy=false;render();message(`${error.message}${writeLocked?' Reload the cloud envelope before saving again.':''}`,true);}
  };
  $('.automation-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{closed=true;loadGeneration++;dialog.remove();},{once:true});
  await reload();return dialog;
}
