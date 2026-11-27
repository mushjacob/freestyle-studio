/** Options ▸ General settings…: small persisted UI preferences. Pure: storage is injected, no DOM. */
export const GENERAL_SETTINGS_KEY='vegetable:general';
export const GENERAL_DEFAULTS=Object.freeze({hintBar:true,theme:'default',uiScale:100});
export const THEMES=Object.freeze([['default','Default'],['darker','Darker'],['light','Light']]);
export const UI_SCALE_MIN=80,UI_SCALE_MAX=150;
export function normalizeTheme(value){return THEMES.some(([id])=>id===value)?value:'default';}
export function normalizeUiScale(value){const n=Number(value);return Number.isFinite(n)?Math.round(Math.min(UI_SCALE_MAX,Math.max(UI_SCALE_MIN,n))):100;}
export function readGeneralSettings(storage=globalThis.localStorage){try{const value=JSON.parse(storage?.getItem(GENERAL_SETTINGS_KEY)||'{}');return{...GENERAL_DEFAULTS,...(value&&typeof value==='object'&&!Array.isArray(value)?{hintBar:value.hintBar!==false,theme:normalizeTheme(value.theme),uiScale:normalizeUiScale(value.uiScale??100)}:{})};}catch{return{...GENERAL_DEFAULTS};}}
export function writeGeneralSettings(patch,storage=globalThis.localStorage){const next={...readGeneralSettings(storage),...patch};next.theme=normalizeTheme(next.theme);next.uiScale=normalizeUiScale(next.uiScale);try{storage?.setItem(GENERAL_SETTINGS_KEY,JSON.stringify(next));}catch{}return next;}
