/** Read-only, context-bound paging of the canonical project sample pool.
 * list(params, {signal}) is a typed REST reader for listPatternSamples;
 * no MCP envelopes, registration, playback or project mutations are used.
 */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value),own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const text=value=>typeof value==='string'&&value.length>0&&value.trim()===value;
const fault=(message,code='project_samples_invalid_response')=>Object.assign(new Error(message),{code});
const stable=value=>Array.isArray(value)?value.map(stable):record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const identity=value=>JSON.stringify(stable(value));
const sourceIdentity=value=>text(value)&&value.length<=64&&!/[\u0000-\u001f\u007f]/.test(value);
function canonicalSampleJSON(value,path=new Set()){
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
 if(!value||typeof value!=='object'||path.has(value)||Object.getOwnPropertySymbols(value).length||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw fault('Read a complete canonical JSON sample before reusing it.','project_sample_reuse_unavailable');
 path.add(value);for(const [key,child]of Object.entries(value)){if((/^_+truncated/i.test(key)||key==='truncated')&&child)throw fault('Read the complete registered sample before reusing it.','project_sample_reuse_unavailable');canonicalSampleJSON(child,path);}path.delete(value);
}
function reusableSample(sample,projectId){
 const unavailable=message=>{throw fault(message,'project_sample_reuse_unavailable');};
 if(!text(projectId)||projectId.length>128||!record(sample)||sample.projectId!==projectId||own(sample,'project_id')&&sample.project_id!==projectId)unavailable('Read this registered sample in its matching project before adding it.');
 if(!text(sample.id)||!sourceIdentity(sample.audioFileId)||own(sample,'audio_file_id')&&sample.audio_file_id!==sample.audioFileId)unavailable('The registered sample needs its explicit canonical audioFileId.');
 if(typeof sample.name!=='string'||!sample.name.trim()||typeof sample.durationSec!=='number'||!Number.isFinite(sample.durationSec)||sample.durationSec<=0)unavailable('Read the registered sample’s confirmed name and positive duration before adding it.');
 if(['events','notes','steps','sources','pattern'].some(key=>own(sample,key)))unavailable('Choose a registered sample descriptor without an embedded score.');
 if(own(sample,'samplePlaybackMode')&&!text(sample.samplePlaybackMode)||own(sample,'busId')&&!text(sample.busId)||['muted','solo'].some(key=>own(sample,key)&&typeof sample[key]!=='boolean')||own(sample,'volume')&&(typeof sample.volume!=='number'||!Number.isFinite(sample.volume)||sample.volume<0))unavailable('Read the registered sample’s canonical playback and routing settings before adding it.');
 canonicalSampleJSON(sample);return sample;
}
/** Reuse an already registered sample without registration or notes. Both new
 * source/rack identities are caller-allocated, never copied from PatternSample.id.
 * Caller owns current-context checks, attachment, persistence and confirmation.
 */
export function registeredProjectSampleSource(sample,projectId,{createId=()=>globalThis.crypto.randomUUID()}={}){
 reusableSample(sample,projectId);if(typeof createId!=='function')throw new TypeError('Sample reuse needs a fresh source identity allocator.');
 const sourceId=createId(),rackId=createId(),reserved=new Set([sample.id,sample.audioFileId,sample.rackId,sample.sourceId].filter(value=>typeof value==='string'));
 if(!sourceIdentity(sourceId)||!sourceIdentity(rackId)||sourceId===rackId||reserved.has(sourceId)||reserved.has(rackId))throw fault('Allocate distinct fresh source and rack identities for this registered sample.','project_sample_reuse_identity_invalid');
 return{sample:clone(sample),source:{samplePlaybackMode:'one-shot',busId:'master',muted:false,solo:false,volume:1,...clone(sample),id:sourceId,rackId,kind:'sample',audioFileId:sample.audioFileId}};
}
function contextFrom(read){
 const value=read();if(!record(value)||!text(value.projectId)||value.projectId.length>128||typeof value.trackId!=='string'||value.trackId.length>64)throw fault('Select a current Freestyle project before reading its samples.','project_samples_context_required');
 const context={projectId:value.projectId,trackId:value.trackId};
 for(const field of ['loadVersion','contextVersion'])if(own(value,field)){if(!Number.isSafeInteger(value[field])||value[field]<0)throw fault('The project sample context is invalid.','project_samples_context_required');context[field]=value[field];}
 return context;
}
function sampleRow(sample,projectId){
 if(!record(sample)||!text(sample.id)||!text(sample.audioFileId)||sample.projectId!=null&&sample.projectId!==projectId)throw fault('Freestyle returned a sample without a matching canonical project and audio identity.');
 if(own(sample,'name')&&typeof sample.name!=='string'||own(sample,'audioUrl')&&typeof sample.audioUrl!=='string'||own(sample,'durationSec')&&(typeof sample.durationSec!=='number'||!Number.isFinite(sample.durationSec)||sample.durationSec<0))throw fault('Freestyle returned invalid canonical sample metadata.');
 const raw=clone(sample);
 let reuseReason=null;try{reusableSample(raw,projectId);}catch(error){reuseReason=error.message;}
 // Reuse has its own explicit source-construction path. Catalog Add must never
 // re-register this row; PatternSample.id does not become its source/rack ID.
 return{...clone(raw),raw,_libraryView:'project-samples',_rowKind:'sound',previewUrl:sample.audioUrl||null,registered:true,materializable:false,canAdd:false,canAddReason:reuseReason||'Already registered. Reuse this sample with fresh source and rack identities instead of registering it again.',canReuse:reuseReason===null,reuseReason};
}
function pageFrom(result,projectId){
 let body=result;
 if(record(result)&&own(result,'status')){if(result.status!==200)throw fault(`Freestyle returned HTTP ${result.status} while reading project samples.`,'project_samples_http_error');body=result.data;}
 const pagination=body?.pagination;
 if(!record(body)||!Array.isArray(body.data)||!record(pagination)||!Number.isInteger(pagination.limit)||pagination.limit<1||pagination.limit>200||body.data.length>pagination.limit||typeof pagination.hasMore!=='boolean'||!own(pagination,'nextCursor'))throw fault('Freestyle returned an invalid project sample page. Expected data and canonical pagination.');
 const cursor=pagination.nextCursor;
 if(pagination.hasMore?(typeof cursor!=='string'||!cursor.length||cursor.length>512):cursor!==null)throw fault('Freestyle returned inconsistent project sample pagination.');
 if(body.projectId!=null&&body.projectId!==projectId)throw fault('Freestyle returned a sample page for another project.');
 const totals=[body.total,pagination.total].filter(value=>value!==undefined&&value!==null);
 if(totals.some(value=>!Number.isSafeInteger(value)||value<0)||new Set(totals).size>1)throw fault('Freestyle returned inconsistent project sample totals.');
 if(body._truncated||body.truncated||body.data.some(sample=>sample?._truncatedItems||sample?._truncated))throw fault('Reload the complete project sample page before using its rows.');
 return{rows:body.data.map(sample=>sampleRow(sample,projectId)),nextCursor:cursor,hasMore:pagination.hasMore,total:totals[0]??null};
}
export class ProjectSampleLibrary{
 constructor({getContext,list,onChange=()=>{},pageSize=50,maxPages=100}={}){
  if(typeof getContext!=='function'||typeof list!=='function'||typeof onChange!=='function')throw new TypeError('Project sample library needs context and typed REST readers.');
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>200||!Number.isInteger(maxPages)||maxPages<1||maxPages>1000)throw new RangeError('Choose a page size1–200 and a finite page budget1–1000.');
  Object.assign(this,{getContext,list,onChange,pageSize,maxPages});this.rows=[];this.total=null;this.nextCursor=null;this.hasMore=false;this.busy=false;this.error=null;this.truncated=false;this.context=null;this.pagesRead=0;this.cursors=new Set();this.generation=0;this.pending=null;this.destroyed=false;
 }
 current(context=this.context,generation=this.generation){try{return!this.destroyed&&generation===this.generation&&!!context&&identity(context)===identity(contextFrom(this.getContext));}catch{return false;}}
 snapshot(){const valid=this.current();return{rows:valid?clone(this.rows):[],total:valid?this.total:null,nextCursor:valid?this.nextCursor:null,hasMore:valid&&this.hasMore,busy:valid&&this.busy,error:valid?this.error:null,truncated:valid&&this.truncated,context:valid?clone(this.context):null,pagesRead:valid?this.pagesRead:0};}
 notify(){try{this.onChange(this.snapshot());}catch{}}
 cancel(){this.generation++;this.pending?.controller.abort();this.pending=null;this.busy=false;this.notify();}
 destroy(){this.cancel();this.destroyed=true;this.rows=[];this.context=null;this.total=null;this.nextCursor=null;this.hasMore=false;this.notify();}
 loadMore(){return this.load({append:true});}
 load({append=false}={}){
  if(this.destroyed)return Promise.reject(fault('The project sample library was closed.','project_samples_closed'));
  let context;try{context=contextFrom(this.getContext);}catch(error){this.cancel();this.rows=[];this.context=null;return Promise.reject(error);}
  const sameScope=this.context&&identity(context)===identity(this.context),continuing=append&&sameScope;
  if(this.pending&&identity(this.pending.context)===identity(context)&&this.pending.append===continuing)return this.pending.promise;
  if(continuing&&!this.hasMore)return Promise.resolve(this.snapshot());
  this.cancel();this.context=clone(context);
  if(!continuing){this.rows=[];this.total=null;this.nextCursor=null;this.hasMore=false;this.truncated=false;this.pagesRead=0;this.cursors=new Set();}
  if(this.pagesRead>=this.maxPages){this.error=fault('The project sample page limit was reached. Refresh before reading more.','project_samples_page_limit');this.truncated=true;this.hasMore=false;this.nextCursor=null;this.notify();return Promise.reject(this.error);}
  const cursor=continuing?this.nextCursor:null,generation=this.generation,controller=new AbortController(),attempt={context,append:continuing,controller,promise:null};this.pending=attempt;this.busy=true;this.error=null;this.notify();
  attempt.promise=(async()=>{
   try{
    const result=await this.list({path:{project_id:context.projectId},query:{limit:this.pageSize,...cursor!==null?{cursor}:{}}},{signal:controller.signal});
    if(!this.current(context,generation))return this.snapshot();
    const page=pageFrom(result,context.projectId);
    if(page.nextCursor!==null&&(page.nextCursor===cursor||this.cursors.has(page.nextCursor)))throw fault('Freestyle repeated a project sample cursor. Refresh before continuing.','project_samples_cursor_repeated');
    const rows=continuing?clone(this.rows):[],seen=new Map(rows.map(row=>[row.id,row]));
    for(const row of page.rows){const previous=seen.get(row.id);if(previous){if(identity(previous.raw)!==identity(row.raw))throw fault('Freestyle returned conflicting copies of one registered sample. Refresh its canonical metadata.','project_samples_identity_conflict');continue;}seen.set(row.id,row);rows.push(row);}
    const total=page.total??this.total;if(total!==null&&total<rows.length)throw fault('Freestyle returned a sample total smaller than the loaded canonical rows.');
    this.rows=rows;this.total=total;this.nextCursor=page.nextCursor;this.hasMore=page.hasMore;this.pagesRead++;if(page.nextCursor!==null)this.cursors.add(page.nextCursor);this.busy=false;this.notify();return this.snapshot();
   }catch(error){
    if(!this.current(context,generation)||controller.signal.aborted)return this.snapshot();
    this.busy=false;this.error=error;this.truncated=continuing;this.hasMore=false;this.nextCursor=null;this.notify();throw error;
   }finally{if(this.pending===attempt)this.pending=null;}
  })();return attempt.promise;
 }
}
