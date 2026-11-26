'use client';
// ProspectOS installable (PWA, migration 057, docs/PWA.md) — mounted in the signed-in application only (never on a
// public page): the install invitation, the one-time notification offer at the first launch of the installed app, and the
// notification settings (opened from the account menu). The account's settings and its refusal come from the server.
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '../primitives.tsx';
import {Sheet} from '../panels.tsx';
import {INSTALL_COPY,PUSH_COPY} from '../../../pwa/copy.ts';
import {mayInvite,afterShown,type Moment} from '../../../pwa/rules.ts';
import {loadState,saveState,devicePlatform,iosSafari,isStandalone,androidPrompt,promptAndroidInstall,pushSupported,currentSubscription,subscribePush,unsubscribePush,nowMs} from '../../../pwa/client.ts';
import type {Locale} from '../../../i18n/locale.ts';
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
type Settings={install_prompt_refused:boolean;push:{delivery:boolean;signals:boolean;trial:boolean};devices:number;vapid_public_key:string|null};
// Scoped to .pos-ui, tokens only. Rendered with the components (React hoists it once), so it is there wherever they are.
// The invitation is a bottom banner that never blocks the page (no overlay: the page stays usable), above the bottom
// navigation and the iPhone home indicator.
export const PWA_CSS=`.pos-ui .pos-pwa-banner{position:fixed;left:var(--pos-space-3);right:var(--pos-space-3);bottom:calc(var(--pos-bottomnav-h,64px) + var(--pos-space-2) + env(safe-area-inset-bottom,0px));z-index:calc(var(--pos-z-shell,50) + 1);
 display:grid;gap:var(--pos-space-2);max-width:520px;margin:0 auto;padding:var(--pos-space-4);background:var(--pos-surface-card);border:1px solid var(--pos-border);
 border-radius:var(--pos-radius-lg);box-shadow:var(--pos-shadow-card);color:var(--pos-text-1)}
.pos-ui .pos-pwa-banner h2{margin:0;font-size:var(--pos-text-md);font-weight:var(--pos-weight-bold);letter-spacing:-.01em}
.pos-ui .pos-pwa-banner p{margin:0;font-size:var(--pos-text-sm);color:var(--pos-text-2)}
.pos-ui .pos-pwa-steps{margin:0;padding-left:20px;display:grid;gap:4px;font-size:var(--pos-text-sm);color:var(--pos-text-1)}
.pos-ui .pos-pwa-steps svg{vertical-align:-4px;margin-left:4px;color:var(--pos-signal)}
.pos-ui .pos-pwa-actions{display:flex;flex-wrap:wrap;gap:var(--pos-space-2);align-items:center}
.pos-ui .pos-pwa-link{background:none;border:0;padding:0 var(--pos-space-2);min-height:var(--pos-size-target);font:inherit;font-size:var(--pos-text-sm);
 color:var(--pos-text-2);text-decoration:underline;cursor:pointer}
.pos-ui .pos-pwa-close{position:absolute;top:6px;right:6px;width:var(--pos-size-target);height:var(--pos-size-target);background:none;border:0;color:var(--pos-text-2);
 font-size:22px;cursor:pointer}
.pos-ui .pos-pwa-settings{display:grid;gap:var(--pos-space-3)}
.pos-ui .pos-pwa-settings label{margin:0;padding:0;line-height:1.3;display:flex;gap:var(--pos-space-2);align-items:center;min-height:var(--pos-size-target);font-size:var(--pos-text-sm);color:var(--pos-text-1)}
.pos-ui .pos-pwa-settings input[type=checkbox]{width:20px;min-width:20px;max-width:20px;height:20px;min-height:0;margin:0;padding:0;flex:none;accent-color:var(--pos-accent)}
.pos-ui .pos-pwa-note{font-size:var(--pos-text-sm);color:var(--pos-text-2);margin:0}
.pos-ui .pos-pwa-note--error{color:var(--pos-status-excluded-fg)}
@media (min-width:1024px){.pos-ui .pos-pwa-banner{bottom:var(--pos-space-4)}}
.pos-ui .pos-pwa-banner--static{position:relative;left:auto;right:auto;bottom:auto;margin:0}`;
const Style=()=><style href="pos-pwa" precedence="default">{PWA_CSS}</style>;
export const OPEN_NOTIFICATION_SETTINGS='prospectos:open-notification-settings';

// The Share icon of Safari, drawn (a square with an arrow up), so the person recognises the button to tap.
export function ShareIcon({label}:{label:string}){
 return <svg role="img" aria-label={label} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>
 </svg>;
}

// The invitation itself (also shown, with fixed props, on the help page /installer-application).
export function InstallBanner({kind,locale,onInstall,onLater,onNever,static:still}:{kind:'ios'|'android';locale:Locale;onInstall?:()=>void;onLater?:()=>void;onNever?:()=>void;static?:boolean}){
 const t=INSTALL_COPY[locale];
 return <aside className={`pos-pwa-banner${still?' pos-pwa-banner--static':''}`} role="region" aria-label={t.title}><Style/>
  <button type="button" className="pos-pwa-close" aria-label={t.close} onClick={onLater}>×</button>
  <h2>{t.title}</h2><p>{t.body}</p>
  {kind==='ios'&&<ol className="pos-pwa-steps"><li>{t.iosSteps[0]}<ShareIcon label={t.iosShareLabel}/></li><li>{t.iosSteps[1]}</li><li>{t.iosSteps[2]}</li></ol>}
  <div className="pos-pwa-actions">
   {kind==='android'&&<Button variant="primary" onClick={onInstall}>{t.install}</Button>}
   <Button variant="secondary" onClick={onLater}>{t.later}</Button>
   <button type="button" className="pos-pwa-link" onClick={onNever}>{t.never}</button>
  </div>
 </aside>;
}

export function PwaLayer({api,locale}:{api:Api;locale:Locale}){
 const p=PUSH_COPY[locale];
 const [settings,setSettings]=useState<Settings|null>(null);
 const [invite,setInvite]=useState<null|'ios'|'android'>(null);
 const [offer,setOffer]=useState(false);
 const [open,setOpen]=useState(false);
 const [subscribed,setSubscribed]=useState<boolean|null>(null);
 const [note,setNote]=useState<{text:string;error?:boolean}|null>(null);
 const [busy,setBusy]=useState(false);
 const platform=useRef(devicePlatform());
 const event=useCallback((kind:string)=>{const s=loadState();api('app/events','POST',{kind,device:s.device,platform:platform.current}).catch(()=>{})},[api]);

 useEffect(()=>{api('app/settings').then(setSettings).catch(()=>{})},[api]);
 useEffect(()=>{currentSubscription().then(s=>setSubscribed(!!s)).catch(()=>setSubscribed(false))},[]);
 // First launch of the installed app: measured once, and one offer to turn notifications on.
 useEffect(()=>{
  if(!settings||!isStandalone())return;
  const s=loadState();if(s.pushOffered)return;
  saveState({...s,installed:true,pushOffered:true});event('app_installee');
  if(pushSupported()&&settings.vapid_public_key&&Notification.permission==='default')setOffer(true);
 },[settings,event]);
 useEffect(()=>{const h=()=>event('app_installee');window.addEventListener('prospectos:installed',h);return ()=>window.removeEventListener('prospectos:installed',h)},[event]);
 // A moment (first search with results, a prospect monitored, a delivery opened) may show the invitation.
 useEffect(()=>{
  const h=(e:Event)=>{
   const m=(e as CustomEvent<Moment>).detail;if(!m||!settings||invite)return;
   const state=loadState(),now=nowMs();
   if(!mayInvite({state,now,platform:platform.current,standalone:isStandalone(),refused:settings.install_prompt_refused,iosSafari:iosSafari(),androidPrompt:androidPrompt()}))return;
   saveState(afterShown(state,now));setInvite(platform.current==='ios'?'ios':'android');event('invitation_affichee');
  };
  window.addEventListener('prospectos:install-moment',h);return ()=>window.removeEventListener('prospectos:install-moment',h);
 },[settings,invite,event]);
 useEffect(()=>{const h=()=>{setNote(null);setOpen(true)};window.addEventListener(OPEN_NOTIFICATION_SETTINGS,h);return ()=>window.removeEventListener(OPEN_NOTIFICATION_SETTINGS,h)},[]);

 const never=async()=>{setInvite(null);event('invitation_refusee');try{setSettings(await api('app/install/refuse','POST',{}))}catch{}};
 const install=async()=>{setInvite(null);await promptAndroidInstall().catch(()=>false)};
 const enable=async()=>{
  if(!settings?.vapid_public_key){setNote({text:p.error,error:true});return}
  setBusy(true);setNote(null);
  try{
   const sub=await subscribePush(settings.vapid_public_key);
   if(sub==='denied'){setNote({text:p.denied,error:true});return}
   if(!sub){setNote({text:p.unsupported,error:true});return}
   setSettings(await api('app/push/subscribe','POST',{...sub,platform:platform.current}));setSubscribed(true);setOffer(false);event('notifications_activees');setNote({text:p.saved});
  }catch{setNote({text:p.error,error:true})}finally{setBusy(false)}
 };
 const disable=async()=>{setBusy(true);setNote(null);try{const endpoint=await unsubscribePush();if(endpoint)setSettings(await api('app/push/unsubscribe','POST',{endpoint}));setSubscribed(false);setNote({text:p.saved})}catch{setNote({text:p.error,error:true})}finally{setBusy(false)}};
 const setKind=async(k:'delivery'|'signals'|'trial',v:boolean)=>{if(!settings)return;setBusy(true);
  try{setSettings(await api('app/push/preferences','POST',{...settings.push,[k]:v}));setNote({text:p.saved})}catch{setNote({text:p.error,error:true})}finally{setBusy(false)}};

 const needsHomeScreen=platform.current==='ios'&&!isStandalone();
 return <><Style/>
  {invite&&<InstallBanner kind={invite} locale={locale} onInstall={install} onLater={()=>setInvite(null)} onNever={never}/>}
  {offer&&!invite&&<aside className="pos-pwa-banner" role="region" aria-label={p.offerTitle}>
   <h2>{p.offerTitle}</h2><p>{p.offerBody}</p>
   {note&&<p className={`pos-pwa-note${note.error?' pos-pwa-note--error':''}`} role="status">{note.text}</p>}
   <div className="pos-pwa-actions"><Button variant="primary" loading={busy} onClick={enable}>{p.enable}</Button><Button variant="secondary" onClick={()=>setOffer(false)}>{p.notNow}</Button></div>
  </aside>}
  <Sheet open={open} onClose={()=>setOpen(false)} title={p.settingsTitle} description={p.settingsIntro} locale={locale}>
   <div className="pos-pwa-settings">
    {!pushSupported()?<p className="pos-pwa-note">{needsHomeScreen?p.iosHint:p.unsupported}</p>:<>
     <p className="pos-pwa-note"><b>{p.thisDevice}</b> : {subscribed?p.on:p.off}</p>
     <div className="pos-pwa-actions">{subscribed
      ?<Button variant="secondary" loading={busy} onClick={disable}>{p.turnOff}</Button>
      :<Button variant="primary" loading={busy} onClick={enable}>{p.turnOn}</Button>}</div>
     {settings&&(['delivery','signals','trial'] as const).map(k=><label key={k}><input type="checkbox" checked={settings.push[k]} disabled={busy} onChange={e=>setKind(k,e.target.checked)}/>{p.kinds[k]}</label>)}
    </>}
    {note&&<p className={`pos-pwa-note${note.error?' pos-pwa-note--error':''}`} role="status">{note.text}</p>}
   </div>
  </Sheet>
 </>;
}
