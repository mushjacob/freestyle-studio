/**
 * Cold-engine waveform recovery.
 *
 * After Freestyle unloads an idle project's engine session, the first
 * getClipWaveform reads can answer 409 `target_not_loaded` ("That track isn't
 * in the live session right now") for ~2 s while the session reloads. That is
 * "engine not ready yet", not a terminal failure: the clip keeps its neutral
 * loading state and only the clips that failed this way are re-read as soon as
 * an engine-load signal arrives — an acknowledged execute_pro_action, a
 * successful canonical/native refresh (session `state`), or the monitor
 * `connected` event (also after an auto-reconnect). A bounded backoff
 * (1, 2, 4, 8, 15 s ≈ 30 s) is the fallback; only then is the real error +
 * Retry shown. Everything is scoped to the waveform view's project scope, so a
 * project switch drops pending clips and timers. A warm engine never fails
 * this way, so it costs no extra calls.
 */
const NOT_LOADED=new Set(['target_not_loaded','native_state_unavailable','engine_not_ready','engine_not_loaded']);
export function engineNotLoaded(error){
  if(!error||error.name==='AbortError')return false;
  const codes=[error.code,error.details?.code,error.result?.code,error.result?.error?.code,error.cause?.code].filter(Boolean).map(String);
  return codes.some(code=>NOT_LOADED.has(code));
}

export class WaveformRecovery{
  constructor(workspace,{delays=[1000,2000,4000,8000,15000],timerFactory=(fn,ms)=>setTimeout(fn,ms),timerCancel=id=>clearTimeout(id)}={}){
    Object.assign(this,{w:workspace,delays,timerFactory,timerCancel});
    this.waiting=new Map();this.timer=null;this.step=0;this.scopeKey=null;this.listeners=[];this.retrying=null;
  }
  get view(){return this.w.waveformView;}
  scope(){try{return this.view?.scope?.()??null;}catch{return null;}}
  key(clip){return String(clip?.cloudId||clip?.id||'');}
  /** Called by the waveform view when a read answered "engine not loaded". */
  wait(clip){
    const key=this.key(clip),scope=this.scope();if(!key||scope==null)return;
    if(this.scopeKey!==scope)this.reset(scope);
    const entry=this.waiting.get(key);if(entry?.exhausted)return;
    this.waiting.set(key,{key,clipId:String(clip.id),exhausted:false});
    if(this.timer==null&&this.step<this.delays.length)this.schedule();
  }
  /** Neutral loading state while a not-loaded clip is still being recovered. */
  pending(clip,error){
    if(error&&!engineNotLoaded(error))return false;
    if(this.scopeKey!==this.scope())return false;
    const entry=this.waiting.get(this.key(clip));return !!entry&&!entry.exhausted;
  }
  reset(scope=this.scope()){if(this.timer!=null){this.timerCancel(this.timer);this.timer=null;}this.waiting.clear();this.step=0;this.scopeKey=scope;}
  schedule(){
    const delay=this.delays[this.step++];
    this.timer=this.timerFactory(()=>{this.timer=null;this.retryWaiting('backoff');},delay);
  }
  /** Engine-ready signal: retry the waiting clips right away. */
  signal(reason='engine-ready'){if(this.waiting.size)return this.retryWaiting(reason);return null;}
  async retryWaiting(reason){
    const scope=this.scope();if(scope==null||scope!==this.scopeKey){this.reset(scope);return [];}
    if(this.retrying)return this.retrying;
    const run=(async()=>{
      const project=this.w.getProject?.()||{},entries=[...this.waiting.values()].filter(entry=>!entry.exhausted),results=[];
      for(const entry of entries){
        const clip=(project.audioClips||[]).find(candidate=>this.key(candidate)===entry.key&&String(candidate.id)===entry.clipId);
        if(!clip){this.waiting.delete(entry.key);continue;}
        this.waiting.delete(entry.key); // a renewed not-loaded answer re-registers it via wait()
        try{await this.view.retry(clip);results.push([entry.key,'ok']);}
        catch(error){
          if(this.scope()!==scope)return results;
          if(engineNotLoaded(error)){if(!this.waiting.has(entry.key))this.waiting.set(entry.key,{key:entry.key,clipId:entry.clipId,exhausted:false});results.push([entry.key,'waiting']);}
          else results.push([entry.key,'error']);
        }
      }
      if(this.scope()!==scope)return results;
      const still=[...this.waiting.values()].filter(entry=>!entry.exhausted);
      if(still.length&&this.timer==null){
        if(this.step<this.delays.length)this.schedule();
        else if(reason==='backoff'){for(const entry of still)entry.exhausted=true;for(const clip of this.w.getProject?.()?.audioClips||[])if(this.waiting.get(this.key(clip))?.exhausted)this.view?.paint?.(clip);}
      }
      return results;
    })();
    this.retrying=run;try{return await run;}finally{this.retrying=null;}
  }
  attach({session=this.w.engine?.session,monitor=this.w.engine?.monitor}={}){
    const on=(target,type,fn)=>{if(!target?.addEventListener)return;target.addEventListener(type,fn);this.listeners.push(()=>target.removeEventListener(type,fn));};
    on(session,'state',()=>this.signal('native-state'));
    on(session,'action',()=>this.signal('engine-action'));
    on(monitor,'connected',()=>this.signal('monitor-connected'));
    return this;
  }
  destroy(){for(const off of this.listeners.splice(0))off();this.reset(null);}
}
