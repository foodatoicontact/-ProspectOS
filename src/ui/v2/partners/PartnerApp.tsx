'use client';
// Programme partenaires (052) — /partenaires/espace and /partenaires/admin: the signed-in session of ProspectOS (the same
// Supabase session as the application, read from this browser) calls /api/v1/partners/…; the database decides what each one
// may see. Not signed in → a link to sign in. Every refusal shown is the server's sentence.
import {useCallback,useEffect,useState} from 'react';
import {createClient} from '@supabase/supabase-js';
import {PartnerSpaceView} from './PartnerViews.tsx';
import {PartnerAdminView} from './PartnerAdminView.tsx';
import type {AdminData,SpaceData} from './model.ts';
const sbUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,sbKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const auth=sbUrl&&sbKey?createClient(sbUrl,sbKey):null;
const message=(e:unknown)=>e instanceof Error&&e.message?e.message:'Action impossible pour le moment.';
export function PartnerApp({mode}:{mode:'space'|'admin'}){
 const [token,setToken]=useState<string|null|undefined>(undefined);
 const [space,setSpace]=useState<SpaceData|null>(null);const [admin,setAdmin]=useState<AdminData|null>(null);
 const [error,setError]=useState('');const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);
 useEffect(()=>{if(!auth){setToken(null);return}auth.auth.getSession().then(({data})=>setToken(data.session?.access_token??null)).catch(()=>setToken(null))},[]);
 const api=useCallback(async(path:string,method='GET',body?:unknown)=>{
  const res=await fetch(`/api/v1/${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(typeof data?.error==='string'?data.error:'Action impossible pour le moment.');return data;
 },[token]);
 const load=useCallback(async()=>{
  try{if(mode==='space')setSpace(await api('partners/me'));else setAdmin(await api('partners/admin'));setError('')}catch(e){setError(message(e))}
 },[api,mode]);
 useEffect(()=>{if(token)load()},[token,load]);
 const run=(fn:()=>Promise<unknown>,done:string)=>async()=>{setBusy(true);setError('');setNotice('');try{await fn();setNotice(done);await load()}catch(e){setError(message(e))}finally{setBusy(false)}};
 if(token===undefined)return <div className="pos-ded"><p className="pos-ded__muted">Chargement…</p></div>;
 if(token===null)return <div className="pos-ded"><h2>{mode==='space'?'Espace partenaire':'Partenaires'}</h2>
  <p className="pos-ded__muted">Connectez-vous à ProspectOS avec l’adresse e-mail {mode==='space'?'donnée lors de votre inscription au programme':'administrateur'} pour ouvrir cet espace.</p>
  <div className="pos-ded__actions"><a className="pos-ded__btn pos-ded__btn--primary" href="/#inscription">Se connecter</a></div>
  <p className="pos-ded__muted">Une fois connecté, revenez sur cette page.</p></div>;
 return <>
  {(error||notice)&&<div className="pos-ded" style={{paddingBottom:0}}>{error&&<p className="pos-ded__note pos-ded__note--error" role="alert">{error}</p>}{notice&&<p className="pos-ded__note" role="status">{notice}</p>}</div>}
  {mode==='space'&&space&&<PartnerSpaceView data={space} onCopy={t=>navigator.clipboard.writeText(t)}/>}
  {mode==='admin'&&admin&&<PartnerAdminView data={admin} busy={busy} actions={{
   markPaid:(id,paidOn,reference)=>run(()=>api(`partners/admin/statements/${id}/paid`,'POST',{paid_on:paidOn,reference}),'Relevé marqué payé.')(),
   setStatus:(id,status)=>run(()=>api(`partners/admin/partners/${id}/status`,'POST',{status}),status==='ACTIVE'?'Partenaire réactivé.':'Partenaire suspendu.')(),
   create:p=>run(()=>api('partners/admin/partners','POST',p),`Partenaire ${p.code} créé. Envoyez-lui son lien : /?ref=${p.code}.`)(),
  }}/>}
  {!error&&((mode==='space'&&!space)||(mode==='admin'&&!admin))&&<div className="pos-ded"><p className="pos-ded__muted">Chargement…</p></div>}
 </>;
}
