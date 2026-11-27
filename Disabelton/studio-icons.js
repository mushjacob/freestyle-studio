/** Code-native workstation icons. No font glyphs, bitmap assets, or layout changes. */
const SVG_NS='http://www.w3.org/2000/svg';
const glyphs={
 play:'<path class="studio-icon-fill" d="M8 4.5 19 12 8 19.5Z"/>',
 pause:'<path class="studio-icon-fill" d="M7 5h4v14H7zm7 0h4v14h-4z"/>',
 stop:'<path class="studio-icon-fill" d="M6 6h12v12H6z"/>',
 record:'<circle class="studio-icon-fill" cx="12" cy="12" r="6.3"/>',
 playlist:'<path d="M3 4h18v16H3zM3 9h18M3 14h18M8 4v16"/><path class="studio-icon-fill" d="M10 6h8v1.5h-8zm3 5h6v1.5h-6zm-3 5h5v1.5h-5z"/>',
 rack:'<path d="M3 4h5v4H3zm0 6h5v4H3zm0 6h5v4H3zM11 4h10v4H11zm0 6h10v4H11zm0 6h10v4H11z"/>',
 piano:'<path class="studio-icon-fill" d="M3 3h8v3H3zm0 6h5v3H3zm0 6h3v3H3zm12-6h6v3h-6zm-5 6h7v3h-7zm-3 6h5v2H7z"/>',
 mixer:'<path d="M5 3v5m0 5v8m7-18v10m0 5v3m7-18v2m0 5v11M3 8h4v5H3zm7 5h4v5h-4zm7-8h4v5h-4z"/>',
 select:'<path d="M9 4H6a2 2 0 0 0-2 2v3m0 6v3a2 2 0 0 0 2 2h3m6 0h3a2 2 0 0 0 2-2v-3m0-6V6a2 2 0 0 0-2-2h-3M11.5 4h1M20 11.5v1M12.5 20h-1M4 12.5v-1"/>',
 draw:'<path d="m5 15 10-10 4 4L9 19l-5 1 1-5Zm8-8 4 4M5 15l4 4"/>',
 paint:'<path d="m12 12 6-9 3 3-8 8M8 13c-3 0-3 5-6 6 4 2 9 0 9-3 0-2-1-3-3-3Z"/>',
 erase:'<circle cx="12" cy="12" r="8.4"/><path d="m6 18 12-12"/>',
 slice:'<path d="m4 20 6-16 10 10-16 6Zm3-3 10-6"/><circle cx="11" cy="8" r="1"/>',
 scrub:'<path class="studio-icon-fill" d="M3 8h5l6-4v16l-6-4H3Z"/><path d="M18 6v12m4-12v12"/>',
 zoom:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
 slide:'<path d="M4 20h16V4L4 20Z"/><path d="m6 9 4-4M6 5h4v4"/>',
 wrench:'<path class="studio-icon-fill" d="m20 3-4 2-1 4 3 2 4-2a7 7 0 0 1-9 7L6 23a3 3 0 0 1-4-4l7-7A7 7 0 0 1 20 3Z"/>',
 magnet:'<path d="M5 10V8a7 7 0 0 1 14 0v2M5 10v10h5V10m4 0v10h5V10M5 15h5m4 0h5"/>',
 undo:'<path d="M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12"/>',
 redo:'<path d="m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12"/>',
 save:'<path d="M4 3h14l3 3v15H3V3h1Zm3 0v7h10V3M7 21v-8h10v8"/><path d="M14 5v3"/>',
 export:'<path d="M4 15v6h16v-6M12 3v13m-5-5 5 5 5-5"/>',
 metronome:'<path d="M3 20C4 13 7 8 12 8s8 5 9 12M8 7l4 11 4-11M12 2v8"/><path class="studio-icon-fill" d="m10 13 2 7 2-7Z"/>',
 keyboard:'<path d="M2 5h20v14H2zM6 5v14m4-14v14m4-14v14m4-14v14"/><path class="studio-icon-fill" d="M4.5 5h3v8h-3zm4 0h3v8h-3zm8 0h3v8h-3z"/>',
 previous:'<path class="studio-icon-fill" d="m16 5-10 7 10 7Z"/>',
 plus:'<path d="M12 4v16M4 12h16"/>',
 minus:'<path d="M4 12h16"/>',
 close:'<path d="m6 6 12 12M18 6 6 18"/>',
 expand:'<path d="M4 4h16v16H4z"/>',
 reset:'<path d="M6 7a8 8 0 1 1-1 9M6 3v5H1"/>',
 chevron:'<path d="m6 9 6 6 6-6"/>',
 menu:'<path class="studio-icon-fill" d="m9 5 7 7-7 7Z"/>',
 browser:'<path class="studio-icon-fill" d="m2 12 3-2 2-5 3 7-3 7-2-5zm8 0 3-2 2-7 3 9-3 9-2-7zm8 0 2-2 2 2-2 2Z"/>',
 speaker:'<path class="studio-icon-fill" d="M3 8h5l7-5v18l-7-5H3Z"/><path d="M18 7c3 3 3 7 0 10m1-14 1-1m-1 20 1 1"/>',
 document:'<path d="M5 3h10l5 5v13H5zM15 3v5h5M2 6v15"/><path d="M8 12h9m-9 4h7"/>',
 cloud:'<path class="studio-icon-fill" d="M6 19a4 4 0 0 1-1-8 6 6 0 0 1 11-4 4.5 4.5 0 0 1 3 12Z"/>',
 star:'<path class="studio-icon-fill" d="m12 2 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z"/>',
 help:'<path d="M8 8a4 4 0 1 1 6 3.5c-2 1-2 2-2 3.5"/><circle class="studio-icon-fill" cx="12" cy="19" r="1"/>',
};

/** Return trusted, self-contained SVG markup for a known workstation control. */
export function studioIcon(name){
 if(!Object.hasOwn(glyphs,name))throw new Error(`Unknown workstation icon: ${name}`);
 return `<svg xmlns="${SVG_NS}" class="studio-icon studio-icon--${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${glyphs[name]}</svg>`;
}

const controls=[
 /* Logic: Play stays a ▶ that lights green while playing (.playing), never a pause glyph; a pending start still offers Cancel */['#play',button=>button.classList.contains('starting')?'stop':'play','Play'],
 ['#stop','stop','Stop'],['#record','record','Record microphone'],
 ['.window-buttons [data-window="playlist"]','playlist','Playlist'],
 ['.window-buttons [data-window="rack"]','rack','Channel rack'],
 ['.window-buttons [data-window="piano"]','piano','Piano roll'],
 ['.window-buttons [data-window="mixer"]','mixer','Mixer'],
 ['button[data-tool="select"],#piano-select','select','Select / move'],
 ['button[data-tool="draw"],#piano-draw','draw','Draw'],
 ['button[data-tool="paint"],#piano-paint','paint','Paint'],
 ['button[data-tool="erase"],#piano-erase','erase','Delete'],
 ['button[data-tool="slice"],#piano-slice','slice','Slice'],
 ['#piano-playback','scrub','Play selected / scrub (Y)'],
 ['#piano-zoom','zoom','Zoom (Z)'],
 ['#piano-slide','slide','Slide notes unavailable'],
 ['#undo,#piano-undo','undo','Undo'],['#redo','redo','Redo'],['#save','save','Save project'],
 ['#export','export','Export WAV'],['#metronome','metronome','Metronome'],
 ['#typing-keyboard','keyboard','Typing keyboard to piano'],
 ['#previous-pattern','previous','Previous pattern'],
 ['#playlist-zoom-in,#add-pattern,#new-picker-pattern,#add-channel','plus','Add'],
 ['#playlist-zoom-out','minus','Zoom out'],
 ['.panel-actions [data-window="playlist"]','minus','Minimize playlist'],
 ['.panel-actions [data-window="rack"],.panel-actions [data-window="mixer"],.panel-actions [data-window="piano"]','close','Close window'],
 ['#piano-expand','expand','Expand piano roll'],
 ['#piano-clear,#reset-mixer','reset','Reset'],
 ['#playlist-fit','expand','Zoom to fit (click again for the previous view)'],
 ['#piano-more','menu','Piano roll options'],['#piano-tools','wrench','Piano roll tools'],['#piano-snap','magnet','Piano snap'],['#rack-fill','keyboard','Fill each 4 steps'],
 ['#rack-menu','menu','Channel Rack options'],
 // Loops | Files ([data-browser=favorites|all]) are Logic's text segments.
 ['.browser-tabs [data-browser="plugins"]','speaker','Cloud plugin presets'],
 ['.browser-tabs [data-browser="patterns"]','document','Patterns'],
 ['.browser-tabs [data-browser="cloud"]','cloud','Freestyle tools'],
 ['#help','help','Keyboard shortcuts'],
];
const mounts=new WeakMap();

/**
 * Mount once after app toolbar construction. Observes only these stable controls,
 * so transport text/class updates keep their SVG without scanning project redraws.
 * Calling again discovers any controls added since the first mount.
 */
export function mountStudioIcons(root=globalThis.document){
 if(!root?.querySelectorAll)throw new TypeError('A document or element is required.');
 if(mounts.has(root)){const mounted=mounts.get(root);mounted.refresh();return mounted;}
 const mountedButtons=new Map();
 const paint=button=>{
  const entry=mountedButtons.get(button);if(!entry)return;
  const name=typeof entry.icon==='function'?entry.icon(button):entry.icon;
  if(button.dataset.studioIcon===name&&button.children.length===1&&button.firstElementChild?.classList.contains('studio-icon')&&![...button.childNodes].some(node=>node.nodeType===3&&node.textContent.trim()))return;
  button.classList.add('studio-icon-button');button.dataset.studioIcon=name;
  if(!button.hasAttribute('aria-label'))button.setAttribute('aria-label',button.title||entry.label);
  button.innerHTML=studioIcon(name);
 };
 const MutationObserverClass=root.ownerDocument?.defaultView?.MutationObserver||root.defaultView?.MutationObserver||globalThis.MutationObserver;
 const observer=MutationObserverClass?new MutationObserverClass(records=>{
  const dirty=new Set();for(const record of records)if(mountedButtons.has(record.target))dirty.add(record.target);
  for(const button of dirty)paint(button);
 }):null;
 const refresh=()=>{
  for(const [selector,icon,label]of controls){
   const buttons=[...root.querySelectorAll(selector)];if(root.matches?.(selector))buttons.unshift(root);
   for(const button of buttons){if(!mountedButtons.has(button)){mountedButtons.set(button,{icon,label});observer?.observe(button,{childList:true,attributes:true,attributeFilter:['class']});}paint(button);}
  }
 };
 const result={refresh,destroy(){observer?.disconnect();mountedButtons.clear();mounts.delete(root);}};
 mounts.set(root,result);refresh();return result;
}
