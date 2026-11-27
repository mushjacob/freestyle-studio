/** Disabelton layout (Ableton Live 12 style): Browser left, main view centre
 * (Arrangement or Session), Arrangement mixer section, Detail View at the
 * bottom (Clip View / Device View), status bar. Presentation only: no engine
 * or project I/O happens here.
 *
 * Container contract (stable IDs; see docs/DISABELTON_PLAN.md "Layout contract"):
 *  #abl-detail            Detail View (toggle ⌥⌘L), resizable through .abl-detail-splitter
 *  #abl-detail-clip       Clip View host (clip module)    — one of the two is visible
 *  #abl-detail-device     Device View host (devices module)
 *  #abl-arr-mixer         Arrangement mixer section (toggle ⌥⌘M; devices module)
 *  #abl-session-mixer     Session View mixer (devices module)
 *  #abl-session           Session View (Tab), #playlist = Arrangement View
 *
 * window.ablLayout = {showDetail(kind), currentView(), onChange(fn), …}. The API
 * resolves elements lazily, so modules may call it at import time.
 */
const VIEWS=['arrangement','session'],KINDS=['clip','device'];
// Live's Detail View is ~28-30% of a 1016 px window (≈290 px): the note editor shows two octaves.
const DETAIL_MIN=96,DETAIL_DEFAULT=290,ARR_MIXER_DEFAULT=210;
const store={
 get(key,fallback){try{const value=globalThis.localStorage?.getItem('disabelton:abl:'+key);return value===null||value===undefined?fallback:JSON.parse(value);}catch{return fallback;}},
 set(key,value){try{globalThis.localStorage?.setItem('disabelton:abl:'+key,JSON.stringify(value));}catch{}}
};
const clampNumber=(value,min,max,fallback)=>{const number=Number(value);return Number.isFinite(number)?Math.max(min,Math.min(max,number)):fallback;};

export function createAblLayout({document:doc=globalThis.document}={}){
 const listeners=new Set();
 const state={
  view:VIEWS.includes(store.get('view','arrangement'))?store.get('view','arrangement'):'arrangement',
  detailVisible:store.get('detailVisible',true)!==false,
  detailKind:KINDS.includes(store.get('detailKind','device'))?store.get('detailKind','device'):'device',
  detailHeight:clampNumber(store.get('detailHeight',DETAIL_DEFAULT),DETAIL_MIN,2000,DETAIL_DEFAULT),
  browserVisible:store.get('browserVisible',true)!==false,
  arrMixerVisible:store.get('arrMixerVisible',false)===true,
  arrMixerHeight:clampNumber(store.get('arrMixerHeight',ARR_MIXER_DEFAULT),80,800,ARR_MIXER_DEFAULT)
 };
 const $=selector=>doc?.querySelector?.(selector)||null;
 function maxDetailHeight(){const desktop=$('#desktop'),height=desktop?.getBoundingClientRect?.().height||0;return height>0?Math.max(DETAIL_MIN,Math.round(height*.72)):2000;}
 function snapshot(){return{view:state.view,detail:{visible:state.detailVisible,kind:state.detailKind,height:state.detailHeight},browser:state.browserVisible,arrMixer:state.arrMixerVisible};}
 function emit(reason){const value={...snapshot(),reason};for(const fn of [...listeners]){try{fn(value);}catch(error){globalThis.console?.error?.(error);}}}
 function paint(){
  const body=doc?.body,root=doc?.documentElement;if(!body)return;
  const arrangement=state.view==='arrangement';
  body.classList.toggle('abl-view-arrangement',arrangement);body.classList.toggle('abl-view-session',!arrangement);
  body.classList.toggle('abl-detail-open',state.detailVisible);body.classList.toggle('abl-detail-clip',state.detailKind==='clip');body.classList.toggle('abl-detail-device',state.detailKind==='device');
  body.classList.toggle('abl-browser-open',state.browserVisible);body.classList.toggle('abl-arr-mixer-open',state.arrMixerVisible&&arrangement);
  const detailHeight=state.detailVisible?Math.min(state.detailHeight,maxDetailHeight()):0;
  root?.style?.setProperty('--abl-detail-h',`${detailHeight}px`);
  root?.style?.setProperty('--abl-arr-mixer-h',`${state.arrMixerVisible&&arrangement?state.arrMixerHeight:0}px`);
  // Legacy Logic editor panes (#piano / #rack / #mixer) dock into the Detail View area until the
  // Clip / Device View owners replace them; they share its height.
  root?.style?.setProperty('--logic-editor-height',`${Math.max(DETAIL_MIN,detailHeight||state.detailHeight)}px`);
  const session=$('#abl-session');if(session)session.hidden=arrangement;
  const detail=$('#abl-detail');if(detail){detail.hidden=!state.detailVisible;detail.dataset.detail=state.detailKind;}
  const clip=$('#abl-detail-clip'),device=$('#abl-detail-device');if(clip)clip.hidden=state.detailKind!=='clip';if(device)device.hidden=state.detailKind!=='device';
  const mixer=$('#abl-arr-mixer');if(mixer)mixer.hidden=!(state.arrMixerVisible&&arrangement);
  const pressed=(selector,value)=>{const el=$(selector);if(el){el.setAttribute('aria-pressed',String(!!value));el.classList.toggle('lit',!!value);}};
  pressed('#abl-view-arrangement',arrangement);pressed('#abl-view-session',!arrangement);pressed('#abl-browser-toggle',state.browserVisible);
 }
 function update(patch,reason){
  let changed=false;for(const [key,value]of Object.entries(patch))if(state[key]!==value){state[key]=value;changed=true;store.set(key,value);}
  paint();if(changed)emit(reason);return changed;
 }
 const api={
  /** Show the Detail View with the Clip View or Device View in front. */
  showDetail(kind){if(!KINDS.includes(kind))throw new TypeError(`Detail kind must be 'clip' or 'device' (got ${kind}).`);update({detailVisible:true,detailKind:kind},'detail');return kind;},
  /** ⇧Tab: swap Clip View / Device View (opens the Detail View when hidden). */
  toggleDetailKind(){return api.showDetail(state.detailVisible&&state.detailKind==='clip'?'device':state.detailVisible&&state.detailKind==='device'?'clip':state.detailKind);},
  /** ⌥⌘L */
  toggleDetail(force){const next=typeof force==='boolean'?force:!state.detailVisible;update({detailVisible:next},'detail');return next;},
  detailKind:()=>state.detailKind,detailVisible:()=>state.detailVisible,
  setDetailHeight(px){const value=clampNumber(px,DETAIL_MIN,maxDetailHeight(),state.detailHeight);update({detailHeight:Math.round(value)},'detail-height');return state.detailHeight;},
  currentView:()=>state.view,
  setView(view){if(!VIEWS.includes(view))throw new TypeError(`View must be 'arrangement' or 'session' (got ${view}).`);update({view},'view');return view;},
  /** Tab */
  toggleView(){return api.setView(state.view==='arrangement'?'session':'arrangement');},
  /** ⌥⌘B */
  toggleBrowser(force){const next=typeof force==='boolean'?force:!state.browserVisible;update({browserVisible:next},'browser');return next;},
  browserVisible:()=>state.browserVisible,
  /** ⌥⌘M (Arrangement only, as in Live) */
  toggleArrangementMixer(force){const next=typeof force==='boolean'?force:!state.arrMixerVisible;update({arrMixerVisible:next},'arr-mixer');return next;},
  arrangementMixerVisible:()=>state.arrMixerVisible,
  /** fn({view, detail:{visible,kind,height}, browser, arrMixer, reason}); returns an unsubscribe function. */
  onChange(fn){if(typeof fn!=='function')throw new TypeError('onChange needs a function.');listeners.add(fn);return()=>listeners.delete(fn);},
  state:snapshot,paint
 };
 // Splitter: drag the top edge of the Detail View to resize it (pointer capture; Escape restores).
 function bindSplitter(){
  const splitter=$('#abl-detail .abl-detail-splitter');if(!splitter||splitter.dataset.ablBound)return;splitter.dataset.ablBound='1';
  splitter.addEventListener('pointerdown',event=>{
   if(event.button!==0)return;event.preventDefault();const startY=event.clientY,startHeight=state.detailHeight;splitter.setPointerCapture?.(event.pointerId);doc.body.classList.add('abl-resizing-detail');
   const move=next=>{const value=clampNumber(startHeight+(startY-next.clientY),DETAIL_MIN,maxDetailHeight(),startHeight);state.detailHeight=Math.round(value);paint();};
   const end=cancel=>{splitter.removeEventListener('pointermove',move);splitter.removeEventListener('pointerup',up);splitter.removeEventListener('pointercancel',abort);doc.removeEventListener('keydown',key,true);doc.body.classList.remove('abl-resizing-detail');if(cancel){state.detailHeight=startHeight;paint();return;}store.set('detailHeight',state.detailHeight);emit('detail-height');};
   const up=()=>end(false),abort=()=>end(true),key=next=>{if(next.key==='Escape'){next.preventDefault();next.stopPropagation();end(true);}};
   splitter.addEventListener('pointermove',move);splitter.addEventListener('pointerup',up);splitter.addEventListener('pointercancel',abort);doc.addEventListener('keydown',key,true);
  });
  splitter.addEventListener('dblclick',()=>api.toggleDetail(false));
 }
 api.mount=()=>{bindSplitter();paint();return api;};
 return api;
}

/** The page-wide instance (lazily bound to the document). */
export const ablLayout=createAblLayout();
if(globalThis.window&&!globalThis.window.ablLayout)globalThis.window.ablLayout=ablLayout;
if(globalThis.document?.readyState&&globalThis.document.querySelector?.('#abl-detail'))ablLayout.mount();
