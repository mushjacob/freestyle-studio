/** Lossless source-sample edits run in Freestyle; this module never renders audio. */
import {normalizeClipWaveform} from './clip-waveform.js';
const clone=value=>structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const integer=value=>Number.isSafeInteger(value)&&value>=0,pcm=value=>typeof value==='number'&&Number.isFinite(value)&&value>=-1&&value<=1;
const revision=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value);
function result(raw){
 let data=raw?.structuredContent;
 if(data===undefined&&Array.isArray(raw?.content))try{data=JSON.parse(raw.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{throw new Error('Freestyle returned an unreadable sample edit result.');}
 data=data??raw;const layers=[raw,data,data?.response];
 for(const layer of layers)if(layer?.isError||layer?.ok===false||layer?.error){const code=layer.code??data?.code??layer.error?.code,stage=layer.stage??data?.stage,engineStatus=layer.engineStatus??data?.engineStatus,uncertain=stage==='engine_dispatch'||code==='engine_timeout'||Number(engineStatus)>=500;throw Object.assign(new Error(typeof layer.error==='string'?layer.error:layer.message||layer.error?.message||'Freestyle rejected the sample edit.'),{code,status:layer.status,stage,engineStatus,explicitRejection:!uncertain});}
 return data?.response??data;
}
/** Flatten a drag into sorted, disjoint ranges. Later points win on revisits. */
export function sampleEditRanges(points,{sampleRate,channelCount,frameCount}={}){
 if(!integer(sampleRate)||sampleRate<1||!integer(channelCount)||channelCount<1||!integer(frameCount))throw new Error('Read the source sample framing before drawing.');
 const channels=new Map();
 for(const point of points){if(!integer(point.channel)||point.channel>=channelCount||!integer(point.frame)||point.frame>=frameCount||!pcm(point.value))throw new Error('A drawn sample is outside the source channel, frame or PCM range.');let values=channels.get(point.channel);if(!values)channels.set(point.channel,values=new Map());values.set(point.frame,point.value);}
 const edits=[];let count=0;
 for(const [channel,values]of [...channels].sort((a,b)=>a[0]-b[0]))for(const [frame,value]of [...values].sort((a,b)=>a[0]-b[0])){let last=edits.at(-1);if(!last||last.channel!==channel||last.start_frame+last.values.length!==frame)edits.push(last={channel,start_frame:frame,values:[]});last.values.push(value);count++;}
 if(edits.length>64||count>Math.min(sampleRate,192000))throw new Error('Draw at most 64 sample ranges and one second of samples before applying.');
 return edits;
}
export class CloudSampleEditor{
 constructor({call,getContext,guard=()=>{},onChange=()=>{},onCommitted=async()=>{},createKey=()=>globalThis.crypto.randomUUID()}={}){
  if(typeof call!=='function'||typeof getContext!=='function')throw new TypeError('Sample editing needs a cloud call and context.');Object.assign(this,{call,getContext,guard,onChange,onCommitted,createKey});this.generation=0;this.state={status:'idle',waveform:null,draft:[],receipt:null,error:null,uncertain:false};this.busy=false;this.destroyed=false;
 }
 snapshot(){return clone({...this.state,busy:this.busy});}
 notify(){this.onChange(this.snapshot());}
 capture(){const context=clone(this.getContext());if(!context?.projectId||!context?.trackId)throw new Error('Open a Freestyle audio project before editing samples.');return context;}
 check(context,generation){if(this.destroyed||generation!==this.generation||!same(context,this.getContext()))throw Object.assign(new Error('The cloud project changed. Reopen the sample editor.'),{name:'AbortError',code:'sample_editor_scope_changed'});}
 available(){this.guard();if(this.busy)throw new Error('Wait for the current sample operation.');}
 async load(clip,{startFrame,discard=false}={}){
  this.available();if(this.state.draft.length&&!discard)throw new Error('Apply or discard the drawn samples before changing the view.');const clipId=clip?.cloudId;if(typeof clipId!=='string'||!clipId||clip.cloudRaw?.id&&clip.cloudRaw.id!==clipId)throw new Error('Choose a saved audio clip before editing samples.');
  if(startFrame!==undefined&&!integer(startFrame))throw new Error('Choose a nonnegative source frame.');const context=this.capture(),generation=this.generation;
  this.busy=true;this.state={...this.state,status:'loading',error:null};this.notify();
  try{
   const read=async start=>{const request={project_id:context.projectId,track_id:context.trackId,clip_id:clipId,start_frame:start,end_frame:start+64,buckets:64};const raw=await this.call('get_clip_waveform',request);this.check(context,generation);const waveform=normalizeClipWaveform(raw,request);if(!revision(waveform.revision)||waveform.endFrame-waveform.startFrame!==waveform.bucketCount||!waveform.bucketCount||waveform.channels.some(c=>c.min.some((v,i)=>v!==c.max[i])))throw new Error('Freestyle did not return individual source samples.');return waveform;};
   let waveform=await read(startFrame??0);if(startFrame===undefined&&waveform.placement.audioOffsetFrames>0)waveform=await read(waveform.placement.audioOffsetFrames);
   this.clip=clone(clip);this.context=context;this.state={...this.state,status:'ready',waveform,draft:[],error:null,uncertain:false,requiresReload:false};return this.snapshot();
  }catch(error){this.state={...this.state,status:'error',error:error.message};throw error;}finally{this.busy=false;this.notify();}
 }
 draw(channel,from,to=from){
  this.available();this.check(this.context,this.generation);if(!this.state.waveform||this.state.uncertain||this.state.requiresReload)throw new Error('Reload the current source samples before drawing.');
  const w=this.state.waveform;for(const point of [from,to])if(!integer(point.frame)||point.frame<w.startFrame||point.frame>=w.endFrame||!pcm(point.value))throw new Error('Draw inside the visible source-sample window.');
  const points=[...this.state.draft],lo=Math.min(from.frame,to.frame),hi=Math.max(from.frame,to.frame);
  for(let frame=lo;frame<=hi;frame++){const t=from.frame===to.frame?1:(frame-from.frame)/(to.frame-from.frame);points.push({channel,frame,value:from.value+(to.value-from.value)*t});}
  const edits=sampleEditRanges(points,w);this.state.draft=edits.flatMap(edit=>edit.values.map((value,index)=>({channel:edit.channel,frame:edit.start_frame+index,value})));this.state.status='drawing';this.notify();return this.snapshot();
 }
 restoreDraft(points=[]){this.available();sampleEditRanges(points,this.state.waveform);this.state.draft=clone(points);this.state.status=points.length?'drawing':'ready';this.notify();}
 discard(){this.restoreDraft([]);}
 async mutate(undo=false){
  this.available();this.check(this.context,this.generation);if(this.state.uncertain||this.state.requiresReload)throw new Error('Reload the source after the previous result. The edit will not be repeated.');if(!this.state.waveform||!revision(this.state.waveform.revision))throw new Error('Read the current source revision before editing.');if(undo&&this.state.draft.length)throw new Error('Apply or discard the drawing before undoing a saved edit.');
  const edits=undo?null:sampleEditRanges(this.state.draft,this.state.waveform);if(!undo&&!edits.length)return this.snapshot();
  const context=clone(this.context),generation=this.generation,key=this.createKey();if(typeof key!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(key))throw new Error('The sample edit needs a unique operation key.');
  const args={project_id:context.projectId,track_id:context.trackId,clip_id:this.clip.cloudId,expected_revision:this.state.waveform.revision,idempotency_key:key,...undo?{}:{edits}};let sent=false,acknowledged=false;
  this.busy=true;this.state={...this.state,status:undo?'undoing':'saving',error:null};this.notify();
  try{
   sent=true;const raw=await this.call(undo?'undo_clip_sample_edit':'edit_clip_samples',args),receipt=result(raw);acknowledged=true;
   if(!revision(receipt?.revision)||receipt.previous_revision!==undefined&&receipt.previous_revision!==args.expected_revision||receipt.clip_id!==undefined&&receipt.clip_id!==args.clip_id||receipt.undo?.clip_id!==undefined&&receipt.undo.clip_id!==args.clip_id)throw new Error('Freestyle returned no complete sample source revision. Reload before drawing again.');
   this.state.receipt=clone(receipt);this.check(context,generation);
   if(undo)this.state.waveform=null;
   else{const waveform=clone(this.state.waveform);waveform.revision=receipt.revision;for(const edit of edits)for(let index=0;index<edit.values.length;index++){const at=edit.start_frame+index-waveform.startFrame,value=Math.fround(edit.values[index]);waveform.channels[edit.channel].min[at]=waveform.channels[edit.channel].max[at]=value;waveform.channels[edit.channel].rms[at]=Math.abs(value);}this.state.waveform=waveform;}
   this.state.draft=[];this.state.status='saved';await this.onCommitted(clone(receipt),{undo,clipId:this.clip.cloudId});this.check(context,generation);return this.snapshot();
  }catch(error){this.state={...this.state,status:'error',error:error.message,requiresReload:true,uncertain:sent&&!error.explicitRejection};if(acknowledged)this.state.uncertain=true;throw error;}finally{this.busy=false;this.notify();}
 }
 save(){return this.mutate(false);}
 undo(){return this.mutate(true);}
 destroy(){this.destroyed=true;this.generation++;}
}
