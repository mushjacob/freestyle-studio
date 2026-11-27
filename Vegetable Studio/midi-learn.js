/** Link to controller (FL MIDI learn). Pure store plus a small controller: no DOM, no I/O except an injected storage.
 *  Bindings are kept per project in storage key `vegetable:midi-links:<projectId>` as {targetKey:{channel,cc}}. */
export const MIDI_LINKS_PREFIX='vegetable:midi-links:';
export const midiLinksKey=projectId=>MIDI_LINKS_PREFIX+String(projectId??'');
/** Controllers that keep their current handling in WebMidiInput. */
export const MIDI_LEARN_RESERVED_CC=Object.freeze([64,120,123]);
/** Map a 0-127 CC value onto [min,max]. Out-of-range input is clamped; a reversed range maps in reverse. */
export function mapCcToRange(value,min,max){const v=Math.min(127,Math.max(0,Number(value)||0)),lo=Number(min),hi=Number(max);if(!Number.isFinite(lo)||!Number.isFinite(hi))return NaN;return lo+(v/127)*(hi-lo);}
const validBinding=b=>b&&Number.isInteger(b.channel)&&b.channel>=0&&b.channel<=15&&Number.isInteger(b.cc)&&b.cc>=0&&b.cc<=127;
export class MidiLinkStore{
 constructor({storage=globalThis.localStorage,getProjectId=()=>null}={}){Object.assign(this,{storage,getProjectId});this.cache=new Map();}
 id(){const id=this.getProjectId();return id==null?'':String(id);}
 links(){const id=this.id();if(this.cache.has(id))return this.cache.get(id);let links={};try{const raw=JSON.parse(this.storage?.getItem(midiLinksKey(id))||'{}');if(raw&&typeof raw==='object'&&!Array.isArray(raw))for(const [key,binding]of Object.entries(raw))if(validBinding(binding))links[key]={channel:binding.channel,cc:binding.cc};}catch{links={};}this.cache.set(id,links);return links;}
 save(){try{this.storage?.setItem(midiLinksKey(this.id()),JSON.stringify(this.links()));}catch{}}
 /** One controller drives one target and one target has one controller: a new bind replaces both older links. */
 bind(targetKey,channel,cc){const key=String(targetKey);if(!validBinding({channel,cc}))return false;const links=this.links();for(const [other,binding]of Object.entries(links))if(other===key||binding.channel===channel&&binding.cc===cc)delete links[other];links[key]={channel,cc};this.save();return true;}
 resolve(channel,cc){for(const [key,binding]of Object.entries(this.links()))if(binding.channel===channel&&binding.cc===cc)return key;return null;}
 get(targetKey){const binding=this.links()[String(targetKey)];return binding?{...binding}:null;}
 isLinked(targetKey){return this.get(targetKey)!==null;}
 forget(targetKey){const links=this.links(),key=String(targetKey);if(!(key in links))return false;delete links[key];this.save();return true;}
}
/** target: {key,label,min,max,apply(value),live?(value)}. `live` runs at most once per frame while a controller moves;
 *  `apply` is the single committed edit, run once after `commitDelay` ms without messages for that target. */
export class MidiLearnController{
 constructor({store,schedule=cb=>globalThis.requestAnimationFrame?globalThis.requestAnimationFrame(cb):setTimeout(cb,16),cancelSchedule=h=>globalThis.cancelAnimationFrame?globalThis.cancelAnimationFrame(h):clearTimeout(h),setTimer=setTimeout,clearTimer=clearTimeout,commitDelay=500,onLearned=()=>{},onError=()=>{}}){
  Object.assign(this,{store,schedule,cancelSchedule,setTimer,clearTimer,commitDelay,onLearned,onError});this.learning=null;this.targets=new Map();this.factories=new Map();this.pending=new Map();
 }
 beginLearn(target){if(!target||typeof target.key!=='string'||!target.key||typeof target.apply!=='function')return false;this.learning=target;this.targets.set(target.key,target);return true;}
 cancelLearn(){this.learning=null;}
 /** Register a target factory when a control renders, so links saved in an earlier session work at once. `factory()` runs lazily on each message and returns a fresh target, or null when the control is gone. */
 register(key,factory){if(typeof key!=='string'||!key||typeof factory!=='function')return false;this.factories.set(key,factory);return true;}
 unregister(key){return this.factories.delete(key);}
 targetFor(key){const factory=this.factories.get(key);if(factory){try{const made=factory();if(made&&typeof made.apply==='function')return made.key===key?made:{...made,key};}catch(error){this.onError(error);}return null;}return this.targets.get(key)||null;}
 isLinked(key){return this.store.isLinked(key);}
 resolve(channel,cc){return this.store.resolve(channel,cc);}
 forget(key){const had=this.store.forget(key);const p=this.pending.get(key);if(p){this.cancelSchedule(p.frame);this.clearTimer(p.timer);this.pending.delete(key);}return had;}
 /** Wired to WebMidiInput's onControlChange. Returns true when the message was used. */
 onControlChange(channel,cc,value){
  if(MIDI_LEARN_RESERVED_CC.includes(cc))return false;
  if(this.learning){const target=this.learning;this.learning=null;if(!this.store.bind(target.key,channel,cc))return false;try{this.onLearned(target,{channel,cc});}catch(error){this.onError(error);}return true;}
  const key=this.store.resolve(channel,cc);if(!key)return false;const target=this.targetFor(key);if(!target)return false;
  const mapped=mapCcToRange(value,target.min,target.max);if(!Number.isFinite(mapped))return false;
  let p=this.pending.get(key);if(!p){p={value:mapped,target,frame:null,timer:null,dirty:false};this.pending.set(key,p);}
  p.value=mapped;p.target=target;p.dirty=true;
  if(p.frame===null)p.frame=this.schedule(()=>{p.frame=null;if(!p.dirty||typeof p.target.live!=='function'){p.dirty=false;return;}p.dirty=false;try{p.target.live(p.value);}catch(error){this.onError(error);}});
  this.clearTimer(p.timer);p.timer=this.setTimer(()=>{this.pending.delete(key);if(p.frame!==null)this.cancelSchedule(p.frame);try{const result=p.target.apply(p.value);if(result&&typeof result.catch==='function')result.catch(error=>this.onError(error));}catch(error){this.onError(error);}},this.commitDelay);
  return true;
 }
}
