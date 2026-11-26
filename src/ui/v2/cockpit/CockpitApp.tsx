'use client';
// Cockpit administrateur (/cockpit, migration 056) — the signed-in session of ProspectOS (the same Supabase session as the
// application, read from this browser) calls /api/v1/cockpit/…; the database checks the INTERNAL entitlement and RLS hides
// every row from anyone else. Not signed in → a link to sign in; not the administrator → the server's refusal, nothing else.
import {useCallback,useEffect,useRef,useState} from 'react';
import {createClient} from '@supabase/supabase-js';
import {CockpitFeed,type FeedFilters} from './CockpitFeed.tsx';
import {CockpitClients} from './CockpitClients.tsx';
import {Chip,ChipGroup} from '../primitives.tsx';
import {FEED_GROUPS,type Feed,type FeedEvent} from '../../../cockpit/model.ts';
const sbUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,sbKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const auth=sbUrl&&sbKey?createClient(sbUrl,sbKey):null;
const message=(e:unknown)=>e instanceof Error&&e.message?e.message:'Action impossible pour le moment.';
export function feedQuery(f:FeedFilters,before:number|null){
 const kinds=FEED_GROUPS.filter(g=>f.groups.includes(g.key)).flatMap(g=>g.kinds);
 const q=new URLSearchParams({limit:'50'});
 if(kinds.length)q.set('kinds',kinds.join(','));if(f.from)q.set('from',f.from);if(f.to)q.set('to',f.to);if(before)q.set('before',String(before));
 return `cockpit/feed?${q}`;
}
export function CockpitApp(){
 const [token,setToken]=useState<string|null|undefined>(undefined);
 const [filters,setFilters]=useState<FeedFilters>({groups:[],from:'',to:''});
 const [events,setEvents]=useState<FeedEvent[]>([]);const [hasMore,setHasMore]=useState(false);
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const seq=useRef(0);
 useEffect(()=>{if(!auth){setToken(null);return}auth.auth.getSession().then(({data})=>setToken(data.session?.access_token??null)).catch(()=>setToken(null))},[]);
 const [tab,setTab]=useState<'feed'|'clients'>(()=>typeof window!=='undefined'&&window.location.hash==='#clients'?'clients':'feed');
 const show=(t:'feed'|'clients')=>{setTab(t);try{history.replaceState(null,'',t==='clients'?'#clients':'#fil')}catch{}};
 const api=useCallback(async(path:string,method='GET',body?:unknown)=>{
  const res=await fetch(`/api/v1/${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(typeof data?.error==='string'?data.error:'Action impossible pour le moment.');return data;
 },[token]);
 // A newer filter wins: an older answer arriving late is dropped.
 const load=useCallback(async(f:FeedFilters,before:number|null)=>{
  const n=++seq.current;setBusy(true);
  try{const d=await api(feedQuery(f,before)) as Feed;if(n!==seq.current)return;
   setEvents(prev=>before?[...prev,...d.events]:d.events);setHasMore(d.has_more);setError('')}
  catch(e){if(n===seq.current)setError(message(e))}finally{if(n===seq.current)setBusy(false)}
 },[api]);
 useEffect(()=>{if(token&&tab==='feed')load(filters,null)},[token,filters,load,tab]);
 if(token===undefined)return <div className="pos-ded"><p className="pos-ded__muted">Chargement…</p></div>;
 if(token===null)return <div className="pos-ded"><h2>Cockpit</h2>
  <p className="pos-ded__muted">Connectez-vous à ProspectOS avec le compte administrateur pour ouvrir le cockpit.</p>
  <div className="pos-ded__actions"><a className="pos-ded__btn pos-ded__btn--primary" href="/#inscription">Se connecter</a></div>
  <p className="pos-ded__muted">Une fois connecté, revenez sur cette page.</p></div>;
 const tabs=<nav className="pos-cockpit__tabs" aria-label="Écrans du cockpit"><ChipGroup label="Écrans du cockpit" variant="segmented">
  <Chip pressed={tab==='feed'} onPressedChange={()=>show('feed')}>Fil</Chip><Chip pressed={tab==='clients'} onPressedChange={()=>show('clients')}>Clients</Chip></ChipGroup></nav>;
 if(tab==='clients')return <>{tabs}<CockpitClients api={api}/></>;
 if(error&&!events.length)return <>{tabs}<div className="pos-ded"><h2>Cockpit</h2><p className="pos-ded__note pos-ded__note--error" role="alert">{error}</p></div></>;
 return <>{tabs}
  {error&&<div className="pos-ded" style={{paddingBottom:0}}><p className="pos-ded__note pos-ded__note--error" role="alert">{error}</p></div>}
  <CockpitFeed events={events} hasMore={hasMore} filters={filters} busy={busy} onFilters={setFilters}
   onMore={()=>{const last=events[events.length-1];if(last)load(filters,last.id)}}/>
 </>;
}
