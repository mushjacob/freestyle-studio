/** Code-native workstation icons. No font glyphs, bitmap assets, or layout changes. */
const SVG_NS='http://www.w3.org/2000/svg';
const glyphs={
 play:'<path class="studio-icon-fill" d="M8 4.5 19 12 8 19.5Z"/>',
 pause:'<path class="studio-icon-fill" d="M7 5h4v14H7zm7 0h4v14h-4z"/>',
 stop:'<path class="studio-icon-fill" d="M6 6h12v12H6z"/>',
 record:'<circle class="studio-icon-fill" cx="12" cy="12" r="6.3"/>',
 playlist:'<path d="M3 4h18v16H3zM3 9h18M3 14h18M8 4v16"/><path class="studio-icon-fill" d="M10 6h8v1.5h-8zm3 5h6v1.5h-6zm-3 5h5v1.5h-5z"/>',
 rack:'<path d="M3 4h5v4H3zm0 6h5v4H3zm0 6h5v4H3zM11 4h10v4H11zm0 6h10v4H11zm0 6h10v4H11z"/>',
 piano:'<path d="M3 5h18v14H3zM7 12v7m5-7v7m5-7v7"/><path class="studio-icon-fill" d="M6 5h3v8H6zm5 0h3v8h-3zm5 0h3v8h-3z"/>',
 mixer:'<path d="M5 3v5m0 5v8m7-18v10m0 5v3m7-18v2m0 5v11M3 8h4v5H3zm7 5h4v5h-4zm7-8h4v5h-4z"/>',
 draw:'<path d="m5 15 10-10 4 4L9 19l-5 1 1-5Zm8-8 4 4M5 15l4 4"/>',
 paint:'<path d="m12 12 6-9 3 3-8 8M8 13c-3 0-3 5-6 6 4 2 9 0 9-3 0-2-1-3-3-3Z"/>',
 erase:'<circle cx="12" cy="12" r="8.4"/><path d="m6 18 12-12"/>',
 slice:'<path d="m5 3 13 13-4 4L3 9l2-6Zm4 4 10 10M3 21l5-5m8-8 5-5"/>',
 undo:'<path d="M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12"/>',
 redo:'<path d="m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12"/>',
 save:'<path d="M4 3h14l3 3v15H3V3h1Zm3 0v7h10V3M7 21v-8h10v8"/><path d="M14 5v3"/>',
 export:'<path d="M4 15v6h16v-6M12 3v13m-5-5 5 5 5-5"/>',
 metronome:'<path d="m8 3-4 17h16L16 3H8Zm4 13 6-10M8 17h8M10 7h4m-4 4h3"/>',
 keyboard:'<path d="M2 5h20v14H2zM6 5v14m4-14v14m4-14v14m4-14v14"/><path class="studio-icon-fill" d="M4.5 5h3v8h-3zm4 0h3v8h-3zm8 0h3v8h-3z"/>',
 previous:'<path class="studio-icon-fill" d="m16 5-10 7 10 7Z"/>',
 plus:'<path d="M12 4v16M4 12h16"/>',
 minus:'<path d="M4 12h16"/>',
 close:'<path d="m6 6 12 12M18 6 6 18"/>',
 expand:'<path d="M4 4h16v16H4z"/>',
 reset:'<path d="M6 7a8 8 0 1 1-1 9M6 3v5H1"/>',
 chevron:'<path d="m6 9 6 6 6-6"/>',
 help:'<path d="M8 8a4 4 0 1 1 6 3.5c-2 1-2 2-2 3.5"/><circle class="studio-icon-fill" cx="12" cy="19" r="1"/>',
};

/** Return trusted, self-contained SVG markup for a known workstation control. */
export function studioIcon(name){
 if(!Object.hasOwn(glyphs,name))throw new Error(`Unknown workstation icon: ${name}`);
 return `<svg xmlns="${SVG_NS}" class="studio-icon studio-icon--${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${glyphs[name]}</svg>`;
}

const controls=[
 ['#play',button=>button.classList.contains('playing')?'pause':'play','Play / pause'],
 ['#stop','stop','Stop'],['#record','record','Record microphone'],
 ['.window-buttons [data-window="playlist"]','playlist','Playlist'],
 ['.window-buttons [data-window="rack"]','rack','Channel rack'],
 ['.window-buttons [data-window="piano"]','piano','Piano roll'],
 ['.window-buttons [data-window="mixer"]','mixer','Mixer'],
 ['[data-tool="draw"],#piano-draw','draw','Draw'],
 ['[data-tool="paint"]','paint','Paint'],
 ['[data-tool="erase"],#piano-erase','erase','Delete'],
 ['[data-tool="slice"]','slice','Slice'],
 ['#undo','undo','Undo'],['#redo','redo','Redo'],['#save','save','Save project'],
 ['#export','export','Export WAV'],['#metronome','metronome','Metronome'],
 ['#typing-keyboard','keyboard','Typing keyboard to piano'],
 ['#previous-pattern','previous','Previous pattern'],
 ['#playlist-zoom-in,#add-pattern,#new-picker-pattern,#add-channel','plus','Add'],
 ['#playlist-zoom-out','minus','Zoom out'],
 ['.panel-actions [data-window="playlist"]','minus','Minimize playlist'],
 ['.panel-actions [data-window="rack"],.panel-actions [data-window="mixer"],.panel-actions [data-window="piano"]','close','Close window'],
 ['#piano-expand','expand','Expand piano roll'],
 ['#piano-clear,#clear-song,#reset-mixer','reset','Reset'],
 ['#piano-more','chevron','Piano roll tools'],['#rack-fill','piano','Fill each 4 steps'],
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
