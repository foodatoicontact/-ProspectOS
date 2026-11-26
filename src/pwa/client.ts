'use client';
// ProspectOS installable (PWA) — browser side: the service worker registration, the install prompt captured early, the
// device's invitation state, the « moments » that may show the invitation, and the push subscription of this device.
import {platformOf,readState,isIosSafari,urlBase64ToBytes,type InstallState,type Moment,type Platform} from './rules.ts';
const KEY='prospectos.pwa';
type BIP=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
declare global{interface Window{__posInstallPrompt?:BIP|null}}

const safe=<T,>(fn:()=>T,fallback:T):T=>{try{return fn()}catch{return fallback}};
export const nowMs=()=>Date.now();
export function loadState():InstallState{
 return readState(safe(()=>localStorage.getItem(KEY),null),nowMs(),()=>crypto.randomUUID());
}
export function saveState(s:InstallState){safe(()=>localStorage.setItem(KEY,JSON.stringify(s)),undefined)}
export function devicePlatform():Platform{return typeof navigator==='undefined'?'other':platformOf(navigator.userAgent,navigator.maxTouchPoints||0)}
export function iosSafari(){return typeof navigator!=='undefined'&&isIosSafari(navigator.userAgent)}
export function isStandalone(){
 if(typeof window==='undefined')return false;
 return safe(()=>window.matchMedia('(display-mode: standalone)').matches,false)||(navigator as Navigator&{standalone?:boolean}).standalone===true;
}
export const androidPrompt=()=>typeof window!=='undefined'&&!!window.__posInstallPrompt;

// Called once from the root layout: registers the service worker and keeps the browser's install prompt for later.
export function bootPwa(){
 if(typeof window==='undefined')return;
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();window.__posInstallPrompt=e as BIP;window.dispatchEvent(new Event('prospectos:installable'))});
 window.addEventListener('appinstalled',()=>{const s=loadState();saveState({...s,installed:true});window.__posInstallPrompt=null;window.dispatchEvent(new Event('prospectos:installed'))});
 if(isStandalone()){const s=loadState();if(!s.installed)saveState({...s,installed:true})}
 if('serviceWorker' in navigator&&(window.location.protocol==='https:'||window.location.hostname==='localhost'))
  navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});
}
export async function promptAndroidInstall():Promise<boolean>{
 const p=window.__posInstallPrompt;if(!p)return false;
 await p.prompt();const {outcome}=await p.userChoice;window.__posInstallPrompt=null;return outcome==='accepted';
}
// A moment that may show the invitation (first search with results, a prospect put under monitoring, a delivery opened).
export function installMoment(m:Moment){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('prospectos:install-moment',{detail:m}))}

export const pushSupported=()=>typeof window!=='undefined'&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
export async function currentSubscription():Promise<PushSubscription|null>{
 if(!pushSupported())return null;
 const reg=await navigator.serviceWorker.ready;return reg.pushManager.getSubscription();
}
// Asks the person (the browser's own dialog, after their tap), then gives the subscription to the server.
export async function subscribePush(vapidPublicKey:string):Promise<{endpoint:string;keys:{p256dh:string;auth:string}}|'denied'|null>{
 if(!pushSupported())return null;
 const permission=await Notification.requestPermission();
 if(permission!=='granted')return 'denied';
 const reg=await navigator.serviceWorker.ready;
 const sub=(await reg.pushManager.getSubscription())??await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToBytes(vapidPublicKey) as BufferSource});
 const j=sub.toJSON() as {endpoint:string;keys:{p256dh:string;auth:string}};
 return {endpoint:j.endpoint,keys:{p256dh:j.keys.p256dh,auth:j.keys.auth}};
}
export async function unsubscribePush():Promise<string|null>{
 const sub=await currentSubscription();if(!sub)return null;const endpoint=sub.endpoint;await sub.unsubscribe().catch(()=>false);return endpoint;
}
