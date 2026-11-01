'use client';
// « Recevoir mon récap chaque matin » (migration 040, src/digest/api.ts) on the Today screen. Off by default; shown only when
// the server can actually send it (GET says available). The member's choice is stored by set_morning_digest, which records
// the consent; turning it off is always possible here and from every email.
import {useEffect,useId,useState} from 'react';
import type {Locale} from '../../../i18n/locale.ts';

type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
const TEXT:Record<Locale,{label:string;help:string;on:string;off:string;error:string}>={
 fr:{label:'Recevoir mon récap chaque matin par email',
  help:'Les nouveaux signaux trouvés sur vos prospects suivis, chacun avec sa source, à vérifier. Pas d’email les jours sans nouveauté. Désinscription en un clic dans chaque email.',
  on:'Récap du matin activé.',off:'Récap du matin désactivé.',error:'Préférence non enregistrée. Réessayez.'},
 en:{label:'Get my recap every morning by email',
  help:'New signals found on the prospects you follow, each with its source, to check. No email on days without news. One-click unsubscribe in every email.',
  on:'Morning recap enabled.',off:'Morning recap disabled.',error:'Preference not saved. Try again.'},
};
const CSS=`
.pos-digest{display:flex;gap:12px;align-items:flex-start;margin-top:var(--pos-space-5,20px);padding:var(--pos-space-4,16px);background:var(--pos-surface-card);border:1px solid var(--pos-border);border-radius:var(--pos-radius-lg,12px)}
.pos-digest input{width:22px;height:22px;margin:2px 0 0;flex-shrink:0;accent-color:var(--pos-accent,currentColor)}
.pos-digest label{display:grid;gap:4px;cursor:pointer;min-height:44px}
.pos-digest b{color:var(--pos-text-1)}
.pos-digest small{color:var(--pos-text-3);font-size:var(--pos-text-sm,14px)}
.pos-digest__status{margin:6px 0 0;font-size:var(--pos-text-sm,14px);color:var(--pos-text-2)}
`;

export function MorningDigestToggle({api,locale}:{api:Api;locale:Locale}){
 const t=TEXT[locale];const id=useId();
 const [state,setState]=useState<{available:boolean;enabled:boolean}|null>(null);
 const [busy,setBusy]=useState(false);const [note,setNote]=useState('');
 useEffect(()=>{let live=true;api('account/morning-digest').then(r=>{if(live)setState({available:!!r?.available,enabled:!!r?.enabled})}).catch(()=>{});return()=>{live=false}// Read once: the page's api wrapper is a new function at every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 // Not offered where it cannot be sent — unless the member had it on, so they can still turn it off.
 if(!state||(!state.available&&!state.enabled))return null;
 async function change(enabled:boolean){
  setBusy(true);setNote('');
  try{const r=await api('account/morning-digest','POST',{enabled});setState({available:!!r?.available,enabled:!!r?.enabled});setNote(r?.enabled?t.on:t.off)}
  catch{setNote(t.error)}
  finally{setBusy(false)}
 }
 return <div className="pos-digest" data-testid="today-morning-digest">
  <style href="pos-digest" precedence="default">{CSS}</style>
  <input id={id} type="checkbox" checked={state.enabled} disabled={busy} onChange={e=>void change(e.target.checked)} aria-describedby={`${id}-help`}/>
  <label htmlFor={id}><b>{t.label}</b><small id={`${id}-help`}>{t.help}</small>
   {note&&<span className="pos-digest__status" role="status">{note}</span>}</label>
 </div>;
}
