'use client';
import {useEffect,useRef,useState} from 'react';
import snapshots from '../discovery/demo-observations.json';
import type {StoredObservation,Observation} from '../discovery/types';
import type {Criterion,Evidence,Prospect} from '../domain/core';
import {translate,proposalScoreNote,type Locale,type TKey} from '../i18n';
import {presentObservations,shortReason,type EvidenceCard,type CriterionGroup,type ReviewSummary} from './evidence-presentation';
import {contactsIn,separateGluedContacts} from './contact-format';
import {createInFlight,reviewChangesState} from './evidence-verification';
// "Autres informations trouvées": collapsed, then a few at a time.
const OTHERS_PAGE=3;
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
export function ObservationsReview({prospect,criteria,mode,api,onChanged,onReviewSummary,disabled,onBusyChange,locale}:{prospect:Prospect;criteria:Criterion[];mode:'demo'|'live';api:Api;disabled:boolean;onBusyChange:(active:boolean)=>void;onChanged:(evidence?:Evidence[])=>Promise<void>;onReviewSummary?:(summary:ReviewSummary)=>void;locale:Locale}){
 const tr=(key:TKey)=>translate(locale,key);
 const [rows,setRows]=useState<StoredObservation[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[website,setWebsite]=useState(prospect.website??'');const generation=useRef(0);const [othersShown,setOthersShown]=useState(OTHERS_PAGE);
 // loaded: the observations of THIS prospect were read (or their read failed). Until then the review summary
 // sent to the page is not ready, so the ICP section does not mistake analysis evidence for manual evidence.
 const [loaded,setLoaded]=useState(false);const reviewing=useRef(createInFlight());const analyzing=useRef(createInFlight());
 const key=`prospectos-observations:${prospect.id}`;
 useEffect(()=>{const r=++generation.current;setRows([]);setLoaded(false);setWebsite(prospect.website??'');setError('');if(mode==='demo'){try{setRows(JSON.parse(localStorage.getItem(key)??'[]'))}catch{}setLoaded(true)}else api(`prospects/${prospect.id}/observations`).then(data=>{if(r===generation.current){setRows(data);setLoaded(true)}}).catch(()=>{if(r===generation.current){setError(tr('evidence.unavailable'));setLoaded(true)}});return()=>{generation.current++}},[prospect.id,mode]);
 const persist=(next:StoredObservation[])=>{setRows(next);if(mode==='demo')localStorage.setItem(key,JSON.stringify(next))};
 async function execute(fn:()=>Promise<void>){if(disabled||busy)return;onBusyChange(true);setBusy(true);setError('');try{await fn()}catch(e){setError(e instanceof Error?e.message:tr('error.generic'))}finally{setBusy(false);onBusyChange(false)}}
 function evidenceFor(o:StoredObservation):Evidence|null{if(!o.evidence_id||!o.criterion||o.value===null)return null;return {id:o.evidence_id,criterion:o.criterion,value:o.value,status:o.review_status,source_url:o.source_url,excerpt:o.source_excerpt,observed_at:o.collected_at,verified_by:o.review_status==='NOT_VERIFIED'?null:'demo-human'}}
 // One analysis request per prospect at a time: a double click never reserves (nor bills) two analyses.
 async function analyze(){await analyzing.current.run(prospect.id,()=>execute(async()=>{const r=generation.current;if(mode==='demo'){
 if(localStorage.getItem(`prospectos-discovery-origin:${prospect.id}`)!=='fixture')throw Error(tr('evidence.demoAnalyzeRestriction'));
 const collected=new Date(),expires=new Date(+collected+90*86400000);const next=snapshots.map(raw=>{const old=rows.find(o=>o.observation_type===raw.observation_type);return old??{...raw,id:crypto.randomUUID(),prospect_id:prospect.id,organization_id:prospect.organization_id,source_url:prospect.website,collected_at:collected.toISOString(),expires_at:expires.toISOString(),evidence_id:raw.criterion&&raw.status!=='UNKNOWN'?crypto.randomUUID():null,review_status:'NOT_VERIFIED'}}) as StoredObservation[];if(r!==generation.current)return;persist(next);await onChanged(next.map(evidenceFor).filter((e):e is Evidence=>!!e));
 }else {const result=await api(`prospects/${prospect.id}/analyze`,'POST',{});if(r!==generation.current)return;setRows(result.observations);await onChanged()}}))}
 // One request per proof at a time, and never a decision that would not change its state (idempotent UI).
 async function review(row:StoredObservation,decision:'confirm'|'contradict'|'unverify'){if(!reviewChangesState(row,decision))return;await reviewing.current.run(row.id,()=>execute(async()=>{const r=generation.current;const changed=mode==='demo'?{...row,review_status:decision==='confirm'?'VERIFIED':decision==='contradict'?'CONTRADICTED':'NOT_VERIFIED'}:await api(`prospects/${prospect.id}/observations/${row.id}/${decision}`,'POST',{});if(r!==generation.current)return;persist(rows.map(o=>o.id===row.id?changed:o));const evidence=evidenceFor(changed);await onChanged(mode==='demo'&&evidence?[evidence]:undefined)}))}
 // Display only: the rows stay exactly what the server returned; only what a person reads is derived.
 const view=presentObservations(rows,criteria,locale);
 // The ICP section above reads exactly this summary (same groups as the blocks below): one source of truth.
 const summaryKey=JSON.stringify({...view.summary,ready:loaded,prospectId:prospect.id});
 useEffect(()=>{onReviewSummary?.(JSON.parse(summaryKey))},[summaryKey]);
 const date=(value:string)=>new Date(value).toLocaleDateString(locale==='fr'?'fr-FR':'en-US');
 // A phone number or an e-mail glued to the next words is shown separated and in a readable form; the
 // stored excerpt itself is untouched (technical details keep it verbatim). Never translated.
 const contactLine=(text:string)=>{const found=contactsIn(text);return found.length>0&&<p className="contact-values">{found.map((x,i)=><span key={i}>{x.kind==='phone'?tr('evidence.phoneLabel'):tr('evidence.emailLabel')} <b>{x.display}</b></span>)}</p>};
 const technical=(c:EvidenceCard)=>{const o=c.row;return <details className="technical"><summary>{tr('evidence.technicalDetails')}</summary><dl><dt>{tr('evidence.extractionConfidence')}</dt><dd>{c.technical.confidencePct} %</dd><dt>{tr('evidence.extractionType')}</dt><dd>{c.technical.type} · {o.status}</dd><dt>{tr('evidence.collectedOn')}</dt><dd>{date(c.technical.collectedAt)} · {tr('evidence.expiresOnLabel')} {date(c.technical.expiresAt)}</dd><dt>{tr('evidence.rawExcerpt')}</dt><dd>{o.source_excerpt}</dd>{o.claim&&<><dt>{tr('evidence.extractionNote')}</dt><dd><p>{o.claim}</p></dd></>}</dl></details>};
 // Context only (never a proposal): no review button, no score line, the extraction note stays technical.
 const card=(c:EvidenceCard)=>{const o=c.row;return <article key={o.id} className={`evidence-card compact tone-${c.tone}`}>
  <header><div><h4>{c.title}</h4>{c.subtitle&&<small>{c.subtitle}</small>}</div><span className={`pill status-pill tone-${c.tone}`}>{c.statusLabel}</span></header>
  {o.source_excerpt&&<blockquote>{separateGluedContacts(o.source_excerpt)}</blockquote>}
  {contactLine(o.source_excerpt)}
  {c.note&&<p className="muted">{c.note}</p>}
  <p className="evidence-source">{tr('evidence.sourceLabel')} {c.sourceText}{c.sourceHref&&<> · <a href={c.sourceHref} target="_blank" rel="noopener noreferrer">{tr('evidence.openSource')} ↗</a></>}</p>
  {technical(c)}
 </article>};
 const proof=(c:EvidenceCard,g:CriterionGroup,index=0)=>{const o=c.row;return <div key={o.id} id={c.anchorId??undefined} className={`evidence-proof compact tone-${c.tone}`}>
  <div className="proof-body">
   {index>0&&<span className={`pill status-pill tone-${c.tone}`}>{c.statusLabel}</span>}
   {c.subtitle&&<small>{c.subtitle}</small>}
   <blockquote>{separateGluedContacts(o.source_excerpt)}</blockquote>
   {contactLine(o.source_excerpt)}
   <p className="evidence-reason">{shortReason(o.claim)}</p>
   <p className="evidence-source">{tr('evidence.sourceLabel')} {c.sourceText}{c.sourceHref&&<> · <a href={c.sourceHref} target="_blank" rel="noopener noreferrer">{tr('evidence.openSource')} ↗</a></>}</p>
  </div>
  <div className="actions evidence-actions"><button className="primary" aria-label={tr('evidence.confirmAria')} disabled={busy||disabled||o.review_status==='VERIFIED'} onClick={()=>review(o,'confirm')}>{tr('evidence.confirm')}</button><button disabled={busy||disabled||o.review_status==='CONTRADICTED'} onClick={()=>review(o,'contradict')}>{tr('evidence.contradict')}</button>{o.review_status!=='NOT_VERIFIED'&&<button className="text-button" disabled={busy||disabled} onClick={()=>review(o,'unverify')}>{tr('evidence.leaveUnverified')}</button>}</div>
  {technical(c)}
 </div>};
 // One block per criterion: its best proof is shown (bestFirst), the others stay one tap away — each keeps
 // its own excerpt, source and review buttons (individually auditable), nothing is merged or dropped.
 const group=(g:CriterionGroup)=><article key={g.anchorId} id={g.anchorId} tabIndex={-1} className={`evidence-card evidence-group compact tone-${g.tone}`}>
  <header><h4>{g.criterion.label}</h4>{g.cards.length>1&&<small className="group-count">{tr('evidence.proofsFound')} ({g.cards.length})</small>}<span className={`pill status-pill tone-${g.tone}`}>{g.statusLabel}</span></header>
  {proof(g.cards[0],g)}
  <p className="muted group-score">{proposalScoreNote(locale,g.criterion.weight,g.tone==='verified'?'VERIFIED':g.tone==='contradicted'?'CONTRADICTED':'NOT_VERIFIED')}</p>
  {g.cards.length>1&&<details className="evidence-more"><summary>{tr('evidence.moreProofs')} ({g.cards.length-1})</summary>{g.cards.slice(1).map((c,i)=>proof(c,g,i+1))}</details>}
 </article>;
 // A failed analysis is one compact card (what failed, retry) — never a page of empty criteria.
 const failed=error&&rows.length===0;
 return <section className="observations-review"><div className="section-title"><h3>{tr('evidence.reviewTitle')}</h3><button disabled={busy||disabled} onClick={analyze}>{tr('evidence.analyzeWebsite')}</button></div><p className="muted">{tr('evidence.foundVsVerified')}</p>{!prospect.website&&mode==='live'&&<form onSubmit={e=>{e.preventDefault();execute(async()=>{await api(`prospects/${prospect.id}/website`,'POST',{website,official_confirmed:true});await onChanged()})}}><label>{tr('evidence.officialWebsiteLabel')}<input type="url" required value={website} onChange={e=>setWebsite(e.target.value)}/></label><label className="checkbox"><input type="checkbox" required/>{tr('evidence.confirmWebsiteCheckbox')}</label><button disabled={busy||disabled}>{tr('evidence.saveWebsite')}</button></form>}
  {failed?<div className="analysis-failed" role="alert"><b>{tr('evidence.analysisFailedTitle')}</b><p>{error}</p><p className="muted">{tr('evidence.analysisFailedNote')}</p><button disabled={busy||disabled} onClick={analyze}>{tr('evidence.retry')}</button></div>:error&&<p role="alert" className="note">{error}</p>}
  {rows.length>0&&<div className="observations"><h4 className="evidence-group-title">{tr('evidence.proposalsTitle')}</h4>{view.groups.length?view.groups.map(group):<p className="muted">{tr('evidence.noProposals')}</p>}{view.missing.length>0&&<p className="muted evidence-missing">{tr('evidence.notFoundTitle')} {view.missing.join(' · ')}</p>}{view.others.length>0&&<details className="evidence-others"><summary>{tr('evidence.otherFindings')} ({view.others.length})</summary>{view.others.slice(0,othersShown).map(card)}{view.others.length>othersShown&&<button className="more-button" onClick={()=>setOthersShown(n=>n+OTHERS_PAGE)}>{tr('evidence.showMore')} ({view.others.length-othersShown})</button>}</details>}</div>}</section>
}
