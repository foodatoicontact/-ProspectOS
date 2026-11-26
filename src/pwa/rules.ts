// ProspectOS installable (PWA, docs/PWA.md) — the invitation rules, pure (tested in tests/pwa.test.ts). The browser state
// lives in localStorage under one key (per device, not a tracker: it only limits how often the invitation is shown).
export const MAX_SHOWS=3;
export const MIN_GAP_MS=7*24*3600*1000;
export const FIRST_SESSION_QUIET_MS=2*60*1000;
export type InstallState={device:string;firstSeenAt:number;shows:number;lastShownAt:number|null;installed:boolean;pushOffered:boolean};
export type Platform='ios'|'android'|'desktop'|'other';
export type Moment='search_results'|'monitoring'|'delivery_opened';

export function platformOf(ua:string,maxTouchPoints=0):Platform{
 if(/iPhone|iPod/.test(ua)||(/iPad|Macintosh/.test(ua)&&maxTouchPoints>1))return 'ios';
 if(/Android/i.test(ua))return 'android';
 if(/Windows|Macintosh|Linux|CrOS/.test(ua))return 'desktop';
 return 'other';
}
// The invitation may be shown now? Mobile only (iPhone, Android), never once installed, never after « Ne plus afficher »
// (the account), at most MAX_SHOWS times per device, MIN_GAP_MS between two, never in the first 2 minutes of the very first
// session, and on iPhone only in Safari (only Safari can add to the home screen there); on Android only when the browser
// offered its install prompt.
export function mayInvite(o:{state:InstallState;now:number;platform:Platform;standalone:boolean;refused:boolean;iosSafari:boolean;androidPrompt:boolean}):boolean{
 const s=o.state;
 if(o.standalone||s.installed||o.refused)return false;
 if(o.platform==='ios'){if(!o.iosSafari)return false}else if(o.platform==='android'){if(!o.androidPrompt)return false}else return false;
 if(o.now-s.firstSeenAt<FIRST_SESSION_QUIET_MS)return false;
 if(s.shows>=MAX_SHOWS)return false;
 if(s.lastShownAt!==null&&o.now-s.lastShownAt<MIN_GAP_MS)return false;
 return true;
}
export const afterShown=(s:InstallState,now:number):InstallState=>({...s,shows:s.shows+1,lastShownAt:now});
// Safari on iPhone: not Chrome (CriOS), Firefox (FxiOS), Edge (EdgiOS) nor an in-app browser.
export const isIosSafari=(ua:string)=>/Safari\//.test(ua)&&!/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Instagram|FBAN|FBAV|LinkedInApp/.test(ua);
export function readState(raw:string|null,now:number,newDevice:()=>string):InstallState{
 try{
  const v=JSON.parse(raw??'null');
  if(v&&typeof v.device==='string'&&/^[A-Za-z0-9-]{16,40}$/.test(v.device)&&typeof v.firstSeenAt==='number')
   return {device:v.device,firstSeenAt:v.firstSeenAt,shows:Number(v.shows)||0,lastShownAt:typeof v.lastShownAt==='number'?v.lastShownAt:null,installed:v.installed===true,pushOffered:v.pushOffered===true};
 }catch{}
 return {device:newDevice(),firstSeenAt:now,shows:0,lastShownAt:null,installed:false,pushOffered:false};
}
// Web push keys arrive base64url; the browser wants bytes.
export function urlBase64ToBytes(s:string):Uint8Array{
 const b=(s+'='.repeat((4-s.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/');
 const bin=atob(b);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;
}
