'use client';
// « Partager une démo » (migration 042, src/demo-share) — shown under the prospect list of a project, to its owner.
// Creates a read-only link to THIS project's companies; the link is displayed once (the server keeps only its hash),
// then the list shows each link's views, last opening and a « Désactiver » button. DemoClaim is the other half: after a
// visitor created an account from a demo page, it copies the shared project into that new account, once.
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Locale} from '../i18n/locale';
import {Button} from '../ui/v2/primitives';

type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
type Share={id:string;target:string|null;expires_at:string;revoked_at:string|null;view_count:number;last_viewed_at:string|null;created_at:string};
const TEXT={
 fr:{title:'Partager une démo',lead:'Un lien en lecture seule vers les entreprises de ce projet, sans compte à créer. Valable 14 jours. Aucune action n’est possible depuis la page.',
  target:'Cible affichée sur la page (facultatif)',targetPh:'ex. Garages repris en Île-de-France',create:'Créer un lien de démo',
  once:'Copiez ce lien maintenant : il ne sera plus affiché.',copy:'Copier le lien',copied:'Lien copié',links:'Liens actifs',none:'Aucun lien actif.',
  views:(n:number)=>n===0?'Jamais ouvert':n===1?'1 vue':`${n} vues`,last:'Dernière ouverture',expires:'Expire le',disable:'Désactiver',error:'Action impossible pour le moment.'},
 en:{title:'Share a demo',lead:'A read-only link to this project’s companies, no account needed. Valid for 14 days. Nothing can be changed from the page.',
  target:'Target shown on the page (optional)',targetPh:'e.g. Garages recently taken over near Paris',create:'Create a demo link',
  once:'Copy this link now: it will not be shown again.',copy:'Copy link',copied:'Link copied',links:'Active links',none:'No active link.',
  views:(n:number)=>n===0?'Never opened':n===1?'1 view':`${n} views`,last:'Last opened',expires:'Expires on',disable:'Disable',error:'This is not possible right now.'},
};
const CSS=`
.pos-ui .pos-demo{display:grid;gap:var(--pos-space-3);min-width:0;margin-top:var(--pos-space-5);padding:var(--pos-space-4);background:var(--pos-surface-card);border:1px solid var(--pos-border);border-radius:var(--pos-radius-xl);color:var(--pos-text-1)}
.pos-ui .pos-demo h2{margin:0;font-size:var(--pos-text-lg);font-weight:var(--pos-weight-heavy);color:var(--pos-text-1)}
.pos-ui .pos-demo p{margin:0;color:var(--pos-text-2);font-size:var(--pos-text-sm)}
.pos-ui .pos-demo__form{display:grid;gap:var(--pos-space-2);grid-template-columns:minmax(0,1fr) auto;align-items:end}
@media (max-width:640px){.pos-ui .pos-demo__form{grid-template-columns:1fr}}
.pos-ui .pos-demo label{display:grid;gap:4px;font-size:var(--pos-text-sm);color:var(--pos-text-2);min-width:0}
.pos-ui .pos-demo input{min-height:44px;min-width:0;padding:0 var(--pos-space-3);border:1px solid var(--pos-border);border-radius:var(--pos-radius-md);background:var(--pos-surface-inset);color:var(--pos-text-1);font:inherit}
.pos-ui .pos-demo__once{display:grid;gap:var(--pos-space-2);padding:var(--pos-space-3);border:1px solid var(--pos-accent);border-radius:var(--pos-radius-lg);background:var(--pos-accent-soft)}
.pos-ui .pos-demo__once code{font-size:var(--pos-text-sm);overflow-wrap:anywhere;color:var(--pos-text-1)}
.pos-ui .pos-demo__list{list-style:none;margin:0;padding:0;display:grid;gap:var(--pos-space-2)}
.pos-ui .pos-demo__item{display:flex;flex-wrap:wrap;gap:var(--pos-space-2) var(--pos-space-4);align-items:center;justify-content:space-between;padding:var(--pos-space-3);border:1px solid var(--pos-border);border-radius:var(--pos-radius-lg);background:var(--pos-surface-inset);font-size:var(--pos-text-sm)}
.pos-ui .pos-demo__item b{color:var(--pos-text-1)}
.pos-ui .pos-demo__meta{display:grid;gap:2px;min-width:0;color:var(--pos-text-2)}
.pos-ui .pos-demo__error{color:var(--pos-status-excluded-fg)}
`;
export function DemoSharePanel({projectId,api,locale}:{projectId:string;api:Api;locale:Locale}){
 const t=TEXT[locale==='en'?'en':'fr'];
 // null = not known yet or not the owner: the block is not shown at all.
 const [shares,setShares]=useState<Share[]|null>(null);
 const [target,setTarget]=useState('');const [link,setLink]=useState('');const [copied,setCopied]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const date=(v:string)=>new Date(v).toLocaleString(locale==='en'?'en-GB':'fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
 const load=useCallback(async()=>{try{const rows=await api(`demo-shares?project_id=${projectId}`);setShares(Array.isArray(rows)?rows:[])}catch{setShares(null)}},[api,projectId]);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{void load()},[projectId]);
 async function create(){setBusy(true);setError('');setCopied(false);try{const r=await api('demo-shares','POST',{project_id:projectId,...(target.trim()?{target:target.trim()}:{})});setLink(String(r.link??''));setTarget('');await load()}catch(e){setError(e instanceof Error&&e.message?e.message:t.error)}finally{setBusy(false)}}
 async function disable(id:string){setBusy(true);setError('');try{await api(`demo-shares/${id}/revoke`,'POST',{});await load()}catch(e){setError(e instanceof Error&&e.message?e.message:t.error)}finally{setBusy(false)}}
 async function copy(){try{await navigator.clipboard.writeText(link);setCopied(true)}catch{setCopied(false)}}
 if(shares===null)return null;
 const active=shares.filter(s=>!s.revoked_at&&new Date(s.expires_at).getTime()>Date.now());
 return <section className="pos-demo" aria-label={t.title}><style>{CSS}</style>
  <h2>{t.title}</h2><p>{t.lead}</p>
  <div className="pos-demo__form"><label>{t.target}<input value={target} maxLength={300} placeholder={t.targetPh} onChange={e=>setTarget(e.target.value)} disabled={busy}/></label>
   <Button variant="primary" onClick={create} loading={busy}>{t.create}</Button></div>
  {link&&<div className="pos-demo__once" role="status"><p>{t.once}</p><code>{link}</code><div><Button onClick={copy}>{copied?t.copied:t.copy}</Button></div></div>}
  {error&&<p className="pos-demo__error" role="alert">{error}</p>}
  <p><b>{t.links}</b></p>
  {active.length?<ul className="pos-demo__list">{active.map(s=><li key={s.id} className="pos-demo__item">
   <div className="pos-demo__meta"><b>{s.target||t.title}</b><span>{t.views(s.view_count)}{s.last_viewed_at?` · ${t.last} ${date(s.last_viewed_at)}`:''}</span><span>{t.expires} {date(s.expires_at)}</span></div>
   <Button onClick={()=>disable(s.id)} disabled={busy}>{t.disable}</Button></li>)}</ul>:<p>{t.none}</p>}
 </section>;
}

// The token a demo page left in this browser (app/d/[token], key below), for at most the link's own 14 days.
export const DEMO_CLAIM_KEY='prospectos-demo-claim-v1';
const CLAIM_TTL_MS=14*24*3600*1000;
export function readPendingDemo(storage:Pick<Storage,'getItem'|'removeItem'>|null,now=Date.now()):string|null{
 if(!storage)return null;
 try{
  const raw=storage.getItem(DEMO_CLAIM_KEY);if(raw===null)return null;
  let v:any=null;try{v=JSON.parse(raw)}catch{}
  const ok=v&&typeof v.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v.token)&&typeof v.savedAt==='number'&&now-v.savedAt<CLAIM_TTL_MS;
  if(!ok){storage.removeItem(DEMO_CLAIM_KEY);return null}
  return v.token;
 }catch{return null}
}
// Mounted once the person is signed in: copies the shared project into their account, once, then forgets the token
// whatever the answer (an expired link is not retried on every load). Renders nothing.
export function DemoClaim({api,onClaimed}:{api:Api;onClaimed:(projectId:string)=>void}){
 const done=useRef(false);
 useEffect(()=>{
  if(done.current)return;done.current=true;
  let storage:Storage|null=null;try{storage=window.localStorage}catch{storage=null}
  const token=readPendingDemo(storage);if(!token)return;
  void (async()=>{
   try{const r=await api('demo-shares/claim','POST',{token});try{storage?.removeItem(DEMO_CLAIM_KEY)}catch{}if(r&&typeof r.project_id==='string')onClaimed(r.project_id)}
   catch{try{storage?.removeItem(DEMO_CLAIM_KEY)}catch{}}
  })();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 return null;
}
