/** FL's right-click menu for any knob or fader. Pure: builds menu item arrays, no DOM, no I/O.
 *  Order: Edit events, Init song with this position, Create automation clip, Link to controller…, Type in value…, Reset. */
export const KNOB_MENU_UNSUPPORTED=Object.freeze({
 editEvents:'Freestyle has no event editor for a control’s automation events; edit the automation clip instead.',
 midiLearn:'Linking a control to a MIDI controller (MIDI learn) is not available in Freestyle yet.',
 initSongNone:'Init song with this position needs an automation envelope on this control; create an automation clip first.',
 initSongUnavailable:'Freestyle has no saved edit for an envelope’s default value yet.',
 typeIn:'This control cannot be edited right now.',
 reset:'This control has no default to reset to.',
 automation:'Automation is unavailable for this control.'});
const reason=key=>KNOB_MENU_UNSUPPORTED[key]||String(key||'');
/** A disabled menu item, same pattern as the channel menu's `off`: the reason is the tooltip. */
export const knobOff=(label,key,shortcut='')=>[label,shortcut,()=>{},true,reason(key)];
/** items: tuple arrays `[label,shortcut,run,disabled,title]`. Extra clipboard items (Copy/Paste value) follow Reset after a separator. */
export function knobMenuItems({automation=null,envelope=null,typeIn=null,reset=null,clipboard=[],midiLearn=null}={}){
 const initItem=envelope?.exists===true&&typeof envelope.setDefault==='function'?['Init song with this position','',()=>envelope.setDefault(),false,'Set this envelope’s default value to the control’s current position']:knobOff('Init song with this position',envelope?.exists===true?'initSongUnavailable':'initSongNone');
 const typeItem=typeIn&&typeof typeIn.run==='function'?['Type in value…',typeIn.shortcut||'',typeIn.run,!!typeIn.disabled,typeIn.title||'']:knobOff('Type in value…','typeIn');
 const resetItem=reset&&typeof reset.run==='function'?['Reset',reset.shortcut??'Alt+click',reset.run,!!reset.disabled,reset.title||'']:knobOff('Reset','reset','Alt+click');
 const learn=midiLearn?.controller,target=midiLearn?.target,canLearn=learn&&typeof learn.beginLearn==='function'&&target&&typeof target.key==='string';
 const linkItems=canLearn?[['Link to controller…','',()=>{if(learn.beginLearn(target))midiLearn.toast?.('Move a control on your MIDI device…');},false,'Move a control on your MIDI device to link it to this knob']]:[knobOff('Link to controller…','midiLearn')];
 if(canLearn&&learn.isLinked?.(target.key))linkItems.push(['Remove link','',()=>learn.forget(target.key),false,'Unlink this knob from its MIDI controller']);
 const items=[knobOff('Edit events','editEvents'),initItem,Array.isArray(automation)?automation:knobOff('Create automation clip','automation'),...linkItems,typeItem,resetItem];
 if(Array.isArray(clipboard)&&clipboard.length)items.push(null,...clipboard);
 return items;
}
let lastTweaked=null;
/** Remembers the last control the user changed (Tools ▸ Last tweaked in wave 4). */
export function setLastTweaked(target){lastTweaked=target&&typeof target==='object'&&!Array.isArray(target)?{...target,at:target.at??Date.now()}:null;}
export function getLastTweaked(){return lastTweaked?{...lastTweaked}:null;}
