'use client';
// Notification centre of the v2 shell (migration 044, src/notifications): a bell with the number of unread notifications,
// in the top bar (phone, tablet) and in the side navigation (desktop). Opening it lists the last notifications and marks
// them read for this account (on every device); each one leads to its screen. One shared store: the two bells of the
// shell make one request, refreshed every 5 minutes and when the window comes back to the front.
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
export type BellItem={id:string;title:string;body:string;at:string;unread:boolean;pending:boolean;target:'dedicated'|'dedicated-admin'};
type State={items:BellItem[];unread:number;loaded:boolean};
let state:State={items:[],unread:0,loaded:false};let inflight:Promise<void>|null=null;let last=0;
const listeners=new Set<()=>void>();
const set=(s:State)=>{state=s;listeners.forEach(l=>l())};
function load(api:Api,force=false):Promise<void>{
 if(inflight)return inflight;
 if(!force&&state.loaded&&Date.now()-last<60_000)return Promise.resolve();
 inflight=api('notifications').then((r:{items?:BellItem[];unread?:number})=>{last=Date.now();set({items:r.items??[],unread:r.unread??0,loaded:true})})
  .catch(()=>{last=Date.now();set({...state,loaded:true})}).finally(()=>{inflight=null});
 return inflight;
}
const when=(iso:string)=>{const d=new Date(iso);const days=Math.floor((Date.now()-d.getTime())/86400000);
 return days<1?new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}).format(d):days<7?`il y a ${days} j`:new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',timeZone:'Europe/Paris'}).format(d)};
const BELL='M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0';

export function NotificationBell({api,onOpen,variant='top'}:{api:Api;onOpen:(target:'dedicated'|'dedicated-admin')=>void;variant?:'top'|'side'}){
 const s=useSyncExternalStore(l=>{listeners.add(l);return()=>{listeners.delete(l)}},()=>state,()=>state);
 const [open,setOpen]=useState(false);const btn=useRef<HTMLButtonElement>(null);const panel=useRef<HTMLDivElement>(null);
 useEffect(()=>{void load(api);const t=setInterval(()=>{void load(api,true)},300_000);const f=()=>{if(document.visibilityState==='visible')void load(api)};
  document.addEventListener('visibilitychange',f);return()=>{clearInterval(t);document.removeEventListener('visibilitychange',f)}},[api]);
 useEffect(()=>{if(!open)return;
  const out=(e:PointerEvent)=>{const t=e.target as Node;if(!panel.current?.contains(t)&&!btn.current?.contains(t))setOpen(false)};
  const esc=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);btn.current?.focus()}};
  document.addEventListener('pointerdown',out);document.addEventListener('keydown',esc);
  panel.current?.querySelector<HTMLElement>('button,a')?.focus({preventScroll:true});
  return()=>{document.removeEventListener('pointerdown',out);document.removeEventListener('keydown',esc)}},[open]);
 const toggle=()=>{const next=!open;setOpen(next);
  // Opening the centre reads it: the badge goes back to 0 here and on the account's other devices.
  if(next&&s.unread>0){void api('notifications/seen','POST',{}).catch(()=>{});set({...state,unread:0})}};
 const label=s.unread?`Notifications : ${s.unread} non lue${s.unread>1?'s':''}`:'Notifications';
 return <span style={{position:'relative',display:'inline-flex'}}>
  <button ref={btn} type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={label} onClick={toggle} className="pos-bell"
   style={{position:'relative',display:'inline-grid',placeItems:'center',width:44,height:44,borderRadius:999,border:'1px solid var(--pos-border)',background:'var(--pos-surface-card)',
    color:'var(--pos-text-1)',cursor:'pointer',flex:'none',marginLeft:variant==='top'?'auto':0}}>
   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={BELL}/></svg>
   {s.unread>0&&<span aria-hidden="true" style={{position:'absolute',top:-3,right:-3,minWidth:18,height:18,padding:'0 5px',borderRadius:999,background:'var(--pos-status-excluded-fg)',color:'var(--pos-on-accent)',
    fontSize:11,fontWeight:800,lineHeight:'18px',textAlign:'center',boxShadow:'0 0 0 2px var(--pos-bg)'}}>{s.unread>9?'9+':s.unread}</span>}
  </button>
  {open&&<div ref={panel} role="dialog" aria-modal="false" aria-label="Notifications"
   style={variant==='top'?{position:'fixed',top:68,right:12,left:12,marginLeft:'auto',maxWidth:400,zIndex:70}:{position:'absolute',top:0,left:'calc(100% + 10px)',width:380,zIndex:70}}>
   <div style={{background:'var(--pos-surface-card)',color:'var(--pos-text-1)',border:'1px solid var(--pos-border)',borderRadius:16,boxShadow:'var(--pos-shadow-sheet)',overflow:'hidden'}}>
    <p style={{margin:0,padding:'12px 16px',fontWeight:800,fontSize:16,borderBottom:'1px solid var(--pos-border)'}}>Notifications</p>
    {!s.loaded?<p style={{margin:0,padding:16,fontSize:14,color:'var(--pos-text-2)'}}>Chargement…</p>
     :s.items.length===0?<p style={{margin:0,padding:16,fontSize:14,color:'var(--pos-text-2)'}}>Aucune notification pour l’instant.</p>
     :<ul style={{listStyle:'none',margin:0,padding:0,maxHeight:'min(70vh,520px)',overflowY:'auto'}}>{s.items.map(i=><li key={i.id} style={{borderBottom:'1px solid var(--pos-border)'}}>
      <button type="button" onClick={()=>{setOpen(false);onOpen(i.target)}} style={{display:'grid',gap:3,width:'100%',textAlign:'left',padding:'12px 16px',border:0,
       background:i.unread?'var(--pos-accent-soft)':'transparent',color:'inherit',font:'inherit',cursor:'pointer'}}>
       <span style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'baseline'}}>
        <b style={{fontSize:14}}>{i.unread&&<span aria-label="non lue" style={{display:'inline-block',width:8,height:8,borderRadius:999,background:'var(--pos-accent)',marginRight:6}}/>}{i.title}</b>
        <span style={{fontSize:12,color:'var(--pos-text-3)',whiteSpace:'nowrap'}}>{when(i.at)}</span></span>
       <span style={{fontSize:13,color:'var(--pos-text-2)',lineHeight:1.4}}>{i.body}</span>
       {i.pending&&<span style={{justifySelf:'start',fontSize:11,fontWeight:800,color:'var(--pos-on-accent)',background:'var(--pos-accent)',borderRadius:999,padding:'2px 8px'}}>À faire</span>}
      </button></li>)}</ul>}
   </div>
  </div>}
 </span>;
}
