'use client';
// Public simulator V1 (/simulateur) — a CONTROLLED simulation for visitors without an account. What the visitor types only
// picks one of the fictional demonstration scenarios (deterministic dictionary matching, no model); it is never sent,
// stored or echoed. FIT, "why now" and the reason card are the product's own rules applied to fictional data at a fixed
// date; the angle is stored with the data. No Discovery, no search, no AI, no account, no write: the only request is the
// closed analytics beacon. Up to 3 prospects, each flagged "Entreprise fictive", under a permanent demo notice.
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {matchScenario,SIM_INPUT_LIMITS,type SimMatch} from '../simulator/match';
import {simulate,type SimProspectView,type SimProof,type SimView} from '../simulator/view';
import {REGIONS,type RegionCode,type ScenarioId} from '../simulator/types';
import {sendSimEvent,tabSid} from '../simulator/events';
import {fitToConfirmLabel,reasonCountsLabel,proofsSummaryLabel,whyStateLabel} from '../simulator/wording';
import {translate,type TKey} from '../i18n';

const tr=(key:TKey)=>translate('fr',key);
const VIEWED_KEY='prospectos.simulator.viewed';

function Why({p}:{p:SimProspectView}){
 const h=p.hero;
 return <section className={`sim-why ux-hero ux-hero-${h.state}${h.state==='verified'?'':' ux-hero-compact'}`} aria-label={tr('ux.whyNow.title')}>
  <p className="eyebrow">{tr('ux.whyNow.title')}</p>
  {h.state==='verified'&&<>
   <p className="ux-badges"><span className="ux-badge">{tr(`signals.type.${h.signal_type}` as TKey)}</span><span className="pill verified">{tr('ux.status.verified')}</span></p>
   <p className="ux-hero-line">{h.title}</p>
   <p className="muted">{h.source_domain?`${h.source_domain} · `:''}{tr('ux.whyNow.age').replace('{n}',String(h.age_days))}</p>
  </>}
  {h.state==='to_confirm'&&<><p className="ux-badges"><span className="pill">{tr('ux.status.to_confirm')}</span></p><p className="ux-hero-line">{tr('ux.hero.toConfirm').replace('{n}',String(h.count))}</p></>}
  {(h.state==='none'||h.state==='loading')&&<><p className="ux-badges"><span className="pill">{tr('ux.status.unknown')}</span></p><p className="ux-hero-line">{tr('ux.hero.none')}</p></>}
 </section>;
}

function Proofs({title,items,empty}:{title:string;items:SimProof[];empty:string}){
 return <div className="sim-proof-group"><h4>{title}</h4>{items.length?<ul>{items.map(i=><li key={`${i.kind}:${i.id}`}>
  <p><span className="ux-tl-kind">{tr(`ux.timeline.kind.${i.kind}` as TKey)}</span> {i.title}</p>
  {i.detail&&<p className="muted">{i.detail}</p>}
  <p className="muted">{i.source?`${i.source} · `:''}{tr('ux.whyNow.age').replace('{n}',String(i.age_days))} · <span className={`ux-status ux-status-${i.status}`}>{tr(`ux.status.${i.status}` as TKey)}</span></p>
 </li>)}</ul>:<p className="muted">{empty}</p>}</div>;
}

export function Simulator(){
 const [offer,setOffer]=useState(''),[target,setTarget]=useState(''),[region,setRegion]=useState<RegionCode>('fr');
 const [result,setResult]=useState<{match:SimMatch;view:SimView;region:RegionCode}|null>(null);
 // Which analyses are open: a local UI state only (the full analysis is always rendered, hidden when compact).
 const [open,setOpen]=useState<Set<number>>(new Set());const opened=useRef(new Set<number>());
 const sid=useRef('');const resultsRef=useRef<HTMLElement>(null);
 useEffect(()=>{
  sid.current=tabSid();
  let seen=false;try{seen=sessionStorage.getItem(VIEWED_KEY)==='1';sessionStorage.setItem(VIEWED_KEY,'1')}catch{/* private mode */}
  if(!seen)sendSimEvent({kind:'simulator.viewed',sid:sid.current});
 },[]);
 const id=()=>sid.current||(sid.current=tabSid());
 function submit(e:FormEvent){
  e.preventDefault();
  sendSimEvent({kind:'simulator.started',sid:id(),region});
  const match=matchScenario(offer,target);const view=simulate(match.scenario_id);
  // On a phone the first account is open and the others compact; a wider screen keeps every analysis open.
  const phone=(()=>{try{return window.matchMedia('(max-width:719px)').matches}catch{return false}})();
  setOpen(new Set(phone?[0]:view.prospects.map((_,i)=>i)));opened.current=new Set();
  setResult({match,view,region});
  sendSimEvent({kind:'simulator.completed',sid:id(),scenario_id:view.scenario_id,fallback:match.fallback,prospects:view.prospects.length});
  requestAnimationFrame(()=>resultsRef.current?.scrollIntoView({block:'start'}));
 }
 const signup=(scenario_id:ScenarioId,slot?:number)=>()=>sendSimEvent(slot?{kind:'simulator.signup_clicked',sid:id(),scenario_id,slot}:{kind:'simulator.signup_clicked',sid:id(),scenario_id});
 const regionLabel=(code:RegionCode)=>REGIONS.find(r=>r.code===code)?.label??'';
 // One "prospect opened" per account and simulation, whether from "Voir l'analyse" or the evidence list.
 const markOpened=(scenario_id:ScenarioId,i:number)=>{if(opened.current.has(i))return;opened.current.add(i);sendSimEvent({kind:'simulator.prospect_opened',sid:id(),scenario_id,slot:i+1})};
 const toggle=(i:number)=>{const next=new Set(open);if(next.has(i))next.delete(i);else{next.add(i);if(result)markOpened(result.view.scenario_id,i)}setOpen(next)};
 return <main className="sim">
  <p className="sim-banner" role="note">{tr('sim.banner')}</p>
  <header className="sim-head"><a href="/" className="seo-brand"><b className="logo">P</b> ProspectOS</a></header>
  <section className="sim-intro">
   <p className="eyebrow">{tr('sim.eyebrow')}</p>
   <h1>{tr('sim.title')}</h1>
   <p className="muted">{tr('sim.subtitle')}</p>
  </section>
  <form className="sim-form card" onSubmit={submit}>
   <label>{tr('sim.offer.label')}<textarea rows={2} required minLength={3} maxLength={SIM_INPUT_LIMITS.offer} value={offer} placeholder={tr('sim.offer.placeholder')} onChange={e=>setOffer(e.target.value)}/></label>
   <label>{tr('sim.target.label')}<input required minLength={3} maxLength={SIM_INPUT_LIMITS.target} value={target} placeholder={tr('sim.target.placeholder')} onChange={e=>setTarget(e.target.value)}/></label>
   <label>{tr('sim.region.label')}<select value={region} onChange={e=>setRegion(e.target.value as RegionCode)}>{REGIONS.map(r=><option key={r.code} value={r.code}>{r.label}</option>)}</select></label>
   <button className="primary" type="submit">{tr('sim.submit')}</button>
   <p className="muted sim-privacy">{tr('sim.privacy')}</p>
  </form>
  {result&&<section className="sim-results" ref={resultsRef} aria-live="polite" aria-labelledby="sim-results-title">
   <h2 id="sim-results-title">{tr('sim.results.title')}</h2>
   <p className="sim-summary">{(result.match.fallback?tr('sim.summary.fallback'):tr('sim.summary.match').replace('{s}',result.view.label)).replace('{r}',regionLabel(result.region))}</p>
   <details className="sim-how"><summary>{tr('sim.how.title')}</summary>
    <p className="sim-match">{result.match.fallback?tr('sim.match.fallback'):tr('sim.match.found').replace('{s}',result.view.label).replace('{t}',result.match.matched.join(', '))}</p>
    <p className="muted">{tr('sim.region.note').replace('{r}',regionLabel(result.region))}</p>
    <p className="muted">{tr('sim.results.note')}</p>
    <p className="muted">{tr('sim.footer')}</p>
   </details>
   {result.view.prospects.map((p,i)=>{const isOpen=open.has(i);return <article key={p.id} className="sim-prospect card">
    <header className="sim-identity"><span className="sim-rank" aria-hidden="true">{i+1}</span><div><h3>{p.name}</h3><p className="muted">{p.sector_label} · {p.size_label} · {p.domain}</p></div><span className="pill sim-fictional">{tr('sim.fictional')}</span></header>
    {!isOpen&&<p className="sim-compact"><span><b>{p.fit.main??'—'}</b>{p.fit.main!==null&&'/100'} {tr('ux.fit.title')}{p.fit.kind==='estimated'?` · ${tr('score.estimated')}`:''}</span><span className={`ux-status ux-status-${p.hero.state==='verified'?'verified':p.hero.state==='to_confirm'?'to_confirm':'unknown'}`}>{whyStateLabel(p.hero.state)}</span></p>}
    <div className="sim-analysis" id={`sim-analysis-${p.id}`} hidden={!isOpen}>
    <Why p={p}/>
    <div className="sim-fit ux-stack">
     <section className="ux-card" aria-label={tr('ux.fit.title')}><p className="eyebrow">{tr('ux.fit.title')}</p>
      <p className="ux-metric"><b>{p.fit.main??'—'}</b><small>{p.fit.kind==='none'?tr('score.notScored'):p.fit.kind==='estimated'?`/100 · ${tr('score.estimated')}`:'/100'}</small></p>
      {p.fit.kind==='estimated'&&<>{p.fit.verified!==null&&<p className="muted">{tr('sim.verifiedPart').replace('{n}',String(p.fit.verified))}</p>}<p className="muted">{fitToConfirmLabel(p.fit.toVerify,p.fit.toVerifyPoints)}</p></>}</section>
     <section className="ux-card" aria-label={tr('ux.reason.title')}><p className="eyebrow">{tr('ux.reason.title')}</p>
      {p.reason.state==='ready'&&<><p className="ux-metric"><b>{p.reason.score===null?'—':`${p.reason.score}/100`}</b></p>
      <p className="muted">{reasonCountsLabel(p.reason.verified,p.reason.to_confirm)}</p></>}</section>
    </div>
    <section className="sim-angle" aria-label={tr('ux.angle.title')}>
     <p className="ux-nba-label">{tr('ux.angle.title')}</p>
     <p><b>{tr(`outreach.angle.${p.angle.type}` as TKey)}</b></p>
     {p.angle.label&&<p>« {p.angle.label} »</p>}
     {p.angle.source_host&&<p className="muted">{tr('ux.angle.source')} : {p.angle.source_host}</p>}
     <p className="muted">{tr('sim.angle.hint')}</p>
     <a href="/" className="button primary sim-prepare" onClick={signup(result.view.scenario_id,i+1)}>{tr('sim.cta.prepare')}</a>
    </section>
    <details className="sim-proofs" onToggle={e=>{if((e.currentTarget as HTMLDetailsElement).open)markOpened(result.view.scenario_id,i)}}>
     <summary>{proofsSummaryLabel(p.verified.length,p.to_confirm.length)}</summary>
     <Proofs title={tr('sim.proofs.verified')} items={p.verified} empty={tr('sim.proofs.none')}/>
     <Proofs title={tr('sim.proofs.toConfirm')} items={p.to_confirm} empty={tr('sim.proofs.none')}/>
     {p.undocumented.length>0&&<p className="muted">{tr('sim.proofs.undocumented').replace('{l}',p.undocumented.join(' · '))}</p>}
    </details>
    </div>{/* end analysis */}
    <button type="button" className="sim-toggle" aria-expanded={isOpen} aria-controls={`sim-analysis-${p.id}`} onClick={()=>toggle(i)}>{isOpen?tr('sim.analysis.hide'):tr('sim.analysis.show')}</button>
   </article>})}
   <section className="sim-cta card">
    <h2>{tr('sim.cta.title')}</h2>
    <p>{tr('sim.cta.text')}</p>
    <div className="sim-cta-actions">
     <a href="/" className="button primary" onClick={signup(result.view.scenario_id)}>{tr('sim.cta.signup')}</a>
     <a href="/" className="button" onClick={signup(result.view.scenario_id)}>{tr('sim.cta.realProspects')}</a>
    </div>
   </section>
  </section>}
  <footer className="sim-footer muted">{tr('sim.footer')}</footer>
 </main>;
}
