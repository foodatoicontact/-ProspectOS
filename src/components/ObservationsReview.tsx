'use client';
import {useEffect,useRef,useState} from 'react';
import snapshots from '../discovery/demo-observations.json';
import type {StoredObservation,Observation} from '../discovery/types';
import type {Criterion,Evidence,Prospect} from '../domain/core';
import {translate,proposalScoreNote,type Locale,type TKey} from '../i18n';
import {presentObservations,type EvidenceCard,type CriterionGroup,type ReviewSummary} from './evidence-presentation';
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
export function ObservationsReview({prospect,criteria,mode,api,onChanged,onReviewSummary,disabled,onBusyChange,locale}:{prospect:Prospect;criteria:Criterion[];mode:'demo'|'live';api:Api;disabled:boolean;onBusyChange:(active:boolean)=>void;onChanged:(evidence?:Evidence[])=>Promise<void>;onReviewSummary?:(summary:ReviewSummary)=>void;locale:Locale}){
 const tr=(key:TKey)=>translate(locale,key);
 const [rows,setRows]=useState<StoredObservation[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[website,setWebsite]=useState(prospect.website??'');const generation=useRef(0);
 const key=`prospectos-observations:${prospect.id}`;
 useEffect(()=>{const r=++generation.current;setRows([]);setWebsite(prospect.website??'');setError('');if(mode==='demo'){try{setRows(JSON.parse(localStorage.getItem(key)??'[]'))}catch{}}else api(`prospects/${prospect.id}/observations`).then(data=>{if(r===generation.current)setRows(data)}).catch(()=>{if(r===generation.current)setError(tr('evidence.unavailable'))});return()=>{generation.current++}},[prospect.id,mode]);
 const persist=(next:StoredObservation[])=>{setRows(next);if(mode==='demo')localStorage.setItem(key,JSON.stringify(next))};
 async function execute(fn:()=>Promise<void>){if(disabled||busy)return;onBusyChange(true);setBusy(true);setError('');try{await fn()}catch(e){setError(e instanceof Error?e.message:tr('error.generic'))}finally{setBusy(false);onBusyChange(false)}}
 function evidenceFor(o:StoredObservation):Evidence|null{if(!o.evidence_id||!o.criterion||o.value===null)return null;return {id:o.evidence_id,criterion:o.criterion,value:o.value,status:o.review_status,source_url:o.source_url,excerpt:o.source_excerpt,observed_at:o.collected_at,verified_by:o.review_status==='NOT_VERIFIED'?null:'demo-human'}}
 async function analyze(){await execute(async()=>{const r=generation.current;if(mode==='demo'){
 if(localStorage.getItem(`prospectos-discovery-origin:${prospect.id}`)!=='fixture')throw Error(tr('evidence.demoAnalyzeRestriction'));
 const collected=new Date(),expires=new Date(+collected+90*86400000);const next=snapshots.map(raw=>{const old=rows.find(o=>o.observation_type===raw.observation_type);return old??{...raw,id:crypto.randomUUID(),prospect_id:prospect.id,organization_id:prospect.organization_id,source_url:prospect.website,collected_at:collected.toISOString(),expires_at:expires.toISOString(),evidence_id:raw.criterion&&raw.status!=='UNKNOWN'?crypto.randomUUID():null,review_status:'NOT_VERIFIED'}}) as StoredObservation[];if(r!==generation.current)return;persist(next);await onChanged(next.map(evidenceFor).filter((e):e is Evidence=>!!e));
 }else {const result=await api(`prospects/${prospect.id}/analyze`,'POST',{});if(r!==generation.current)return;setRows(result.observations);await onChanged()}})}
 async function review(row:StoredObservation,decision:'confirm'|'contradict'|'unverify'){await execute(async()=>{const r=generation.current;const changed=mode==='demo'?{...row,review_status:decision==='confirm'?'VERIFIED':decision==='contradict'?'CONTRADICTED':'NOT_VERIFIED'}:await api(`prospects/${prospect.id}/observations/${row.id}/${decision}`,'POST',{});if(r!==generation.current)return;persist(rows.map(o=>o.id===row.id?changed:o));const evidence=evidenceFor(changed);await onChanged(mode==='demo'&&evidence?[evidence]:undefined)})}
 // Display only: the rows stay exactly what the server returned; only what a person reads is derived.
 const view=presentObservations(rows,criteria,locale);
 // The ICP section above reads exactly this summary (same groups as the blocks below): one source of truth.
 const summaryKey=JSON.stringify(view.summary);
 useEffect(()=>{onReviewSummary?.(JSON.parse(summaryKey))},[summaryKey]);
 const date=(value:string)=>new Date(value).toLocaleDateString(locale==='fr'?'fr-FR':'en-US');
 // Context only (never a proposal): no review button, no score line, the extraction note stays technical.
 const card=(c:EvidenceCard)=>{const o=c.row;return <article key={o.id} className={`evidence-card tone-${c.tone}`}>
  <header><div><h4>{c.title}</h4>{c.subtitle&&<small>{c.subtitle}</small>}</div><span className={`pill status-pill tone-${c.tone}`}>{c.statusLabel}</span></header>
  {o.source_excerpt&&<><p className="evidence-label">{tr('evidence.excerptFound')}</p><blockquote>{o.source_excerpt}</blockquote></>}
  {c.note&&<p className="muted">{c.note}</p>}
  <p className="evidence-source">{tr('evidence.sourceLabel')} {c.sourceText}{c.sourceHref&&<> · <a href={c.sourceHref} target="_blank" rel="noopener noreferrer">{tr('evidence.openSource')} ↗</a></>}</p>
  <details className="technical"><summary>{tr('evidence.technicalDetails')}</summary><dl><dt>{tr('evidence.extractionConfidence')}</dt><dd>{c.technical.confidencePct} %</dd><dt>{tr('evidence.extractionType')}</dt><dd>{c.technical.type} · {o.status}</dd><dt>{tr('evidence.collectedOn')}</dt><dd>{date(c.technical.collectedAt)} · {tr('evidence.expiresOnLabel')} {date(c.technical.expiresAt)}</dd>{o.claim&&<><dt>{tr('evidence.extractionNote')}</dt><dd>{o.claim}</dd></>}</dl></details>
 </article>};
 const proof=(c:EvidenceCard,g:CriterionGroup)=>{const o=c.row;return <div key={o.id} id={c.anchorId??undefined} className={`evidence-proof tone-${c.tone}`}>
  {g.cards.length>1&&<span className={`pill status-pill tone-${c.tone}`}>{c.statusLabel}</span>}
  {c.subtitle&&<small>{c.subtitle}</small>}
  <p className="evidence-label">{tr('evidence.signalFound')}</p><blockquote>{o.source_excerpt}</blockquote>
  <p className="evidence-label">{tr('evidence.whyRelevant')}</p><p>{o.claim}</p>
  <p className="evidence-source">{tr('evidence.sourceLabel')} {c.sourceText}{c.sourceHref&&<> · <a href={c.sourceHref} target="_blank" rel="noopener noreferrer">{tr('evidence.openSource')} ↗</a></>}</p>
  <div className="actions evidence-actions"><button className="primary" aria-label={tr('evidence.confirmAria')} disabled={busy||disabled||o.review_status==='VERIFIED'} onClick={()=>review(o,'confirm')}>{tr('evidence.confirm')}</button><button disabled={busy||disabled||o.review_status==='CONTRADICTED'} onClick={()=>review(o,'contradict')}>{tr('evidence.contradict')}</button><button disabled={busy||disabled||o.review_status==='NOT_VERIFIED'} onClick={()=>review(o,'unverify')}>{tr('evidence.leaveUnverified')}</button></div>
  <details className="technical"><summary>{tr('evidence.technicalDetails')}</summary><dl><dt>{tr('evidence.extractionConfidence')}</dt><dd>{c.technical.confidencePct} %</dd><dt>{tr('evidence.extractionType')}</dt><dd>{c.technical.type} · {o.status}</dd><dt>{tr('evidence.collectedOn')}</dt><dd>{date(c.technical.collectedAt)} · {tr('evidence.expiresOnLabel')} {date(c.technical.expiresAt)}</dd></dl></details>
 </div>};
 // One block per criterion. The first proof is shown, the others stay one tap away — each keeps its own
 // excerpt, source and review buttons (individually auditable), nothing is merged or dropped.
 const group=(g:CriterionGroup)=><article key={g.anchorId} id={g.anchorId} tabIndex={-1} className={`evidence-card evidence-group tone-${g.tone}`}>
  <header><div><h4>{g.criterion.label}</h4>{g.cards.length>1&&<small>{tr('evidence.proofsFound')} ({g.cards.length})</small>}</div><span className={`pill status-pill tone-${g.tone}`}>{g.statusLabel}</span></header>
  <p className="muted">{proposalScoreNote(locale,g.criterion.weight,g.tone==='verified'?'VERIFIED':g.tone==='contradicted'?'CONTRADICTED':'NOT_VERIFIED')}</p>
  {proof(g.cards[0],g)}
  {g.cards.length>1&&<details className="evidence-more"><summary>{tr('evidence.moreProofs')} ({g.cards.length-1})</summary>{g.cards.slice(1).map(c=>proof(c,g))}</details>}
 </article>;
 return <section className="observations-review"><div className="section-title"><h3>{tr('evidence.reviewTitle')}</h3><button disabled={busy||disabled} onClick={analyze}>{tr('evidence.analyzeWebsite')}</button></div><p className="muted">{tr('evidence.foundVsVerified')}</p>{!prospect.website&&mode==='live'&&<form onSubmit={e=>{e.preventDefault();execute(async()=>{await api(`prospects/${prospect.id}/website`,'POST',{website,official_confirmed:true});await onChanged()})}}><label>{tr('evidence.officialWebsiteLabel')}<input type="url" required value={website} onChange={e=>setWebsite(e.target.value)}/></label><label className="checkbox"><input type="checkbox" required/>{tr('evidence.confirmWebsiteCheckbox')}</label><button disabled={busy||disabled}>{tr('evidence.saveWebsite')}</button></form>}{error&&<p role="alert" className="note">{error}</p>}{rows.length>0&&<div className="observations"><h4 className="evidence-group-title">{tr('evidence.proposalsTitle')}</h4>{view.groups.length?view.groups.map(group):<p className="muted">{tr('evidence.noProposals')}</p>}{view.missing.length>0&&<p className="muted evidence-missing">{tr('evidence.notFoundTitle')} {view.missing.join(' · ')}</p>}{view.others.length>0&&<details className="evidence-others"><summary>{tr('evidence.otherFindings')} ({view.others.length})</summary>{view.others.map(card)}</details>}</div>}</section>
}
