'use client';
import {useEffect,useState} from 'react';
import {translate,type Locale,type TKey} from '../i18n';
// Self-Outreach — the human review. One card = COMPANY, CONTACT, ROLE, SIGNAL (date, age), FIT / INTENT / TIMING /
// EVIDENCE QUALITY / OUTREACH with their explanation, EVIDENCE and SOURCE LINKS, EMAIL and its PROVENANCE, the
// generated message. Actions: APPROVE, EDIT, REJECT — and, after sending, the outcome a person reads in the reply.
// Nothing here sends: an approved message waits for the server's send job (behind SELF_OUTREACH_SEND_ENABLED).
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
type Msg={id:string;sequence:number;kind:string;subject:string;generated_content:string;human_edit:string|null;final_content:string|null;review_status:string;send_status:string;sent_at:string|null;approved_at:string|null};
type Item={id:string;status:string;reply_status:string;outcome:string|null;signal_id:string;signal_type:string;signal_date:string|null;evidence_ids:string[];
 fit_score:number|null;intent_score:number;timing_score:number;evidence_quality_score:number;outreach_score:number;score_threshold:number;
 explanation:{lines?:{component:string;value:number;weight:number;why:string}[];gates?:string[]};demo_at:string|null;paid_at:string|null;
 prospects:{name:string}|null;outreach_contacts:{contact_name:string;contact_role:string;email:string;email_source:string;email_source_url:string|null;email_verified_at:string|null;role_source_url:string}|null;
 outreach_messages:Msg[]};
type Sig={id:string;title:string;excerpt:string;source_url:string;source_domain:string|null;event_date:string|null;published_at:string|null};
type Ev={id:string;criterion:string;excerpt:string;source_url:string};
const href=(u:string|null|undefined)=>{if(!u)return null;try{const x=new URL(u);return x.protocol==='https:'||x.protocol==='http:'?x.href:null}catch{return null}};
const daysSince=(iso:string|null,now:string)=>iso?Math.max(0,Math.floor((Date.parse(now)-Date.parse(iso))/86400000)):null;

function Card({item,sig,evidence,now,locale,busy,act}:{item:Item;sig:Sig|undefined;evidence:Ev[];now:string;locale:Locale;busy:boolean;act:(path:string,body:Record<string,unknown>)=>void}){
 const tr=(k:TKey)=>translate(locale,k);
 const msg=[...item.outreach_messages].sort((a,b)=>b.sequence-a.sequence).find(m=>m.review_status==='PENDING'&&m.send_status==='DRAFT')??[...item.outreach_messages].sort((a,b)=>b.sequence-a.sequence)[0];
 const [text,setText]=useState(msg?.human_edit??msg?.generated_content??'');
 const c=item.outreach_contacts;const date=sig?.event_date??sig?.published_at??item.signal_date;const age=daysSince(date,now);
 const reviewable=msg&&msg.review_status==='PENDING'&&msg.send_status==='DRAFT';
 return <article className="nba-card so-card" data-testid="so-card">
  <header><h3>{item.prospects?.name??'—'}</h3><span className="pill">{item.status}</span>{item.reply_status!=='NONE'&&<span className="pill">{tr('so.reply')} {item.reply_status}</span>}</header>
  <p><b>{tr('so.contact')}</b> {c?.contact_name} — {c?.contact_role} {href(c?.role_source_url)&&<a href={href(c?.role_source_url)!} target="_blank" rel="noreferrer">{tr('nba.openSource')} ↗</a>}</p>
  <p><b>{tr('so.email')}</b> {c?.email} · {tr('so.provenance')} {c?.email_source} {href(c?.email_source_url)&&<a href={href(c?.email_source_url)!} target="_blank" rel="noreferrer">{tr('nba.openSource')} ↗</a>} · {c?.email_verified_at?tr('so.emailVerified'):tr('so.emailNotVerified')}</p>
  <p><b>{tr('so.signal')}</b> {item.signal_type} · {date?date.slice(0,10):'—'}{age!==null?` (${tr('nba.daysAgo').replace('{n}',String(age))})`:''}</p>
  {sig&&<blockquote>« {sig.excerpt} » {href(sig.source_url)&&<a href={href(sig.source_url)!} target="_blank" rel="noreferrer">{sig.source_domain??tr('nba.openSource')} ↗</a>}</blockquote>}
  <p className="nba-chips">{([['FIT',item.fit_score??'—'],['INTENT',item.intent_score],['TIMING',item.timing_score],['EVIDENCE',item.evidence_quality_score],['OUTREACH',`${item.outreach_score} / ${item.score_threshold}`]] as [string,string|number][])
   .map(([k,v])=><span key={k} className="pill">{k} {v}</span>)}</p>
  <ul className="nba-statements">{(item.explanation.lines??[]).map(l=><li key={l.component}><b>{l.component.toUpperCase()}</b> {l.value} × {l.weight} — {l.why}</li>)}
   {(item.explanation.gates??[]).map(g=><li key={g} className="nba-unknown">{g}</li>)}</ul>
  {evidence.length>0&&<ul className="nba-statements">{evidence.map(e=><li key={e.id} className="nba-fact"><span className="pill">{tr('so.evidence')}</span> {e.excerpt} {href(e.source_url)&&<a href={href(e.source_url)!} target="_blank" rel="noreferrer">{tr('nba.openSource')} ↗</a>}</li>)}</ul>}
  {msg&&<div className="so-message"><p><b>{msg.subject}</b> <span className="pill">{msg.kind} · {msg.review_status} · {msg.send_status}</span></p>
   {reviewable?<textarea aria-label={tr('so.message')} value={text} onChange={e=>setText(e.target.value)} rows={12}/>:<pre>{msg.final_content??msg.generated_content}</pre>}
   {reviewable&&<div className="actions">
    <button className="primary" disabled={busy} onClick={()=>act(`self-outreach/messages/${msg.id}/review`,{decision:'APPROVE'})}>{tr('so.approve')}</button>
    <button disabled={busy||text===(msg.human_edit??msg.generated_content)} onClick={()=>act(`self-outreach/messages/${msg.id}/review`,{decision:'EDIT',content:text})}>{tr('so.saveEdit')}</button>
    <button disabled={busy} onClick={()=>act(`self-outreach/messages/${msg.id}/review`,{decision:'REJECT'})}>{tr('so.reject')}</button></div>}</div>}
  {(item.status==='SENT'||item.status==='REPLIED')&&<div className="actions">{['POSITIVE','NEUTRAL','OBJECTION','NOT_INTERESTED','UNSUBSCRIBE'].map(o=>
   <button key={o} disabled={busy||item.outcome===o} onClick={()=>act(`self-outreach/candidates/${item.id}/outcome`,{outcome:o})}>{o}</button>)}
   <button disabled={busy||!!item.demo_at} onClick={()=>act(`self-outreach/candidates/${item.id}/outcome`,{milestone:'DEMO'})}>DEMO</button>
   <button disabled={busy||!!item.paid_at} onClick={()=>act(`self-outreach/candidates/${item.id}/outcome`,{milestone:'PAID'})}>PAID</button></div>}
 </article>;
}

export function SelfOutreachPanel({projectId,api,locale}:{projectId:string;api:Api;locale:Locale}){
 const tr=(k:TKey)=>translate(locale,k);
 const [data,setData]=useState<{items:Item[];signals:Sig[];evidence:Ev[];now:string}|null>(null);
 const [metrics,setMetrics]=useState<Record<string,unknown>|null>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const load=async()=>{try{setData(await api(`self-outreach/projects/${projectId}/queue`));setMetrics(await api(`self-outreach/projects/${projectId}/metrics`));setError('')}catch(e){setError(String((e as Error).message))}};
 useEffect(()=>{void load()},[projectId]);// eslint-disable-line react-hooks/exhaustive-deps
 const act=async(path:string,body:Record<string,unknown>)=>{setBusy(true);try{await api(path,'POST',body);await load()}catch(e){setError(String((e as Error).message))}finally{setBusy(false)}};
 return <section className="panel" data-testid="self-outreach">
  <h2>{tr('so.title')}</h2><p className="muted">{tr('so.subtitle')}</p>
  {error&&<p className="error" role="alert">{error}</p>}
  {metrics&&<p className="nba-chips">{['qualified','needs_review','approved','sent','replied','positive','demo','paid'].map(k=><span key={k} className="pill">{k} {String(metrics[k]??0)}</span>)}</p>}
  {!data?<p>{tr('so.loading')}</p>:data.items.length===0?<p>{tr('so.empty')}</p>:
   data.items.map(i=><Card key={i.id} item={i} sig={data.signals.find(s=>s.id===i.signal_id)} evidence={data.evidence.filter(e=>(i.evidence_ids??[]).includes(e.id))} now={data.now} locale={locale} busy={busy} act={act}/>)}
 </section>;
}
