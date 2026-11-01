'use client';
// Recherche 2.0 (UI-5B) — the native v2 composition of the search, rendered by DiscoveryPanel through its `view` prop.
// Everything it shows and every action it offers comes from DiscoveryView: the panel's own state, derived lists and
// handlers (search, add, ignore, open a run, replay, more runs). It calls no API, no provider and no quota itself.
// Hierarchy: Recherche (compact form) → résultats → pourquoi cette entreprise → source / contexte → action humaine;
// the technical settings and figures stay one tap away ("Plus de réglages", "Détails de la recherche", "Détails avancés").
import {useId} from 'react';
import type {DiscoveryView} from '../../../components/DiscoveryPanel.tsx';
import type {DiscoveryResult} from '../../../discovery/types.ts';
import type {NoveltyStatus} from '../../../discovery/novelty.ts';
import {runState,type RunSummary} from '../../../discovery/run-history.ts';
import {FIXTURE_LABEL} from '../../../discovery/providers/fixture.ts';
import {nafGroupLabel} from '../../../discovery/registry/naf.ts';
import type {SearchMode} from '../../../discovery/search-until-new.ts';
import {searchDoneNote,runDateLabel,runCountsLabel,resultsSummaryLabel,noveltySummaryLabel,runNoveltyLabel,deepStopLabel,passesLabel,
 deepPassLine,newActorsFoundLabel,type TKey} from '../../../i18n/index.ts';
import type {Locale} from '../../../i18n/locale.ts';
import {Button,Icon} from '../primitives.tsx';
import {verificationOf,scoreText,shortReasons,priorityChip,type VerificationKind} from './model.ts';

export const NATIVE_TEXT:Record<Locale,{settings:string;searchSummary:(q:string,l:string)=>string;edit:string;searching:string;results:(n:number)=>string;
 why:string;source:string;verification:string;advanced:string;runDetails:string;noResults:string;noResultsBody:string;startTitle:string;startBody:string;
 targeting:string;thirdParty:string;history:string;filters:string;kind:string;confidence:string;sources:string;
 editCriteria:string;salesOption:string;salesNote:string;salesCompanies:string}>={
 fr:{settings:'Plus de réglages',searchSummary:(q,l)=>`${q} · ${l}`,edit:'Modifier la recherche',searching:'Recherche en cours…',
  results:n=>n===1?'1 entreprise trouvée':`${n} entreprises trouvées`,why:'Pourquoi elle correspond',source:'Source',verification:'Vérification',
  advanced:'Détails avancés',runDetails:'Détails de la recherche',noResults:'Aucune entreprise trouvée.',
  noResultsBody:'Élargissez la zone, retirez une catégorie ou reformulez la requête.',startTitle:'Lancez une recherche',
  startBody:'Décrivez l’activité recherchée et la zone. Les résultats s’affichent ici, chacun à vérifier à la source.',
  targeting:'Ciblage utilisé',thirdParty:'trouvée via une source tierce',history:'Historique des recherches',filters:'Filtrer les résultats',kind:'Type de résultat',confidence:'Lecture du résultat',sources:'Sources',
  editCriteria:'Modifier les critères',
  salesOption:'Reprises de commerces (BODACC)',
  salesNote:'Entreprises qui ont racheté un fonds de commerce ou un établissement ces 90 derniers jours, d’après les annonces officielles du BODACC. Seuls les acheteurs qui sont des sociétés sont proposés ; chaque résultat renvoie à son annonce, à vérifier avant tout contact. Indiquez une activité (ex. restaurant, boulangerie) ou laissez « reprises » pour toutes.',
  salesCompanies:'acheteurs identifiés dans les annonces de reprise'},
 en:{settings:'More settings',searchSummary:(q,l)=>`${q} · ${l}`,edit:'Edit the search',searching:'Searching…',
  results:n=>n===1?'1 company found':`${n} companies found`,why:'Why it matches',source:'Source',verification:'Verification',
  advanced:'Advanced details',runDetails:'Search details',noResults:'No company found.',
  noResultsBody:'Widen the area, remove a category or rephrase the query.',startTitle:'Run a search',
  startBody:'Describe the activity and the area. Results show here, each to be checked at its source.',
  targeting:'Targeting used',thirdParty:'found via a third-party source',history:'Search history',filters:'Filter results',kind:'Result type',confidence:'Result reading',sources:'Sources',
  editCriteria:'Edit the criteria',
  salesOption:'Business takeovers (BODACC)',
  salesNote:'Companies that bought a business or an establishment in the last 90 days, from the official BODACC notices. Only buyers that are companies are proposed; each result links to its notice, to be checked before any contact. Enter an activity (e.g. restaurant, bakery) or leave “reprises” for all.',
  salesCompanies:'buyers identified in takeover notices'},
};
// "Lecture du résultat": how sure the automatic reading of this search result is, and where it came from — in words, never
// a provider id ("fixture", "brave"). The legacy line (discoveryFoundNote) stays for the legacy screen.
const SOURCE_NAME:Record<Locale,Record<string,string>>={fr:{brave:'recherche web',registry:'registre des entreprises',bodacc_sales:'annonces de reprise du BODACC',fixture:'données de test'},
 en:{brave:'web search',registry:'company register',bodacc_sales:'BODACC takeover notices',fixture:'test data'}};
export function foundLine(locale:Locale,pct:number,source:string):string{
 const from=SOURCE_NAME[locale][source]??(locale==='fr'?'autre source':'other source');
 return locale==='fr'?`Fiabilité ${pct} % · via ${from}`:`Reliability ${pct}% · via ${from}`;
}
// The legacy state wording (DiscoveryPanel STATE_LABEL), same keys.
const STATE_KEY:Record<'candidate'|'added'|'ignored'|'unresolved',TKey>={candidate:'discovery.state.candidate',added:'discovery.addedToProject',ignored:'discovery.ignoredBadge',unresolved:'discovery.state.unresolved'};
const VERIFY_ICON:Record<VerificationKind,'verified'|'info'|'verify'|'excluded'>={verified:'verified',estimated:'info',document:'verify',unknown:'excluded'};
const TABS=['ALL','NEW','SEEN','ADDED','IGNORED','CURRENT_RUN_DUPLICATE'] as const;

function Form({m}:{m:DiscoveryView}){
 const {tr,form:f,mode}=m;const t=NATIVE_TEXT[m.locale];const id=useId();
 const sourceNote=f.provider==='fixture'?FIXTURE_LABEL:f.provider==='registry'?tr('discovery.registryNote'):f.provider==='bodacc_sales'?t.salesNote:tr('discovery.braveNote');
 // After a search, the form folds into one line; "Modifier la recherche" opens it again (same state as the legacy details).
 if(m.current&&!f.formOpen)return <div className="pos-sform pos-sform--folded" data-testid="search-folded">
  <p className="pos-sform__summary"><Icon name="search" size={18}/><span><b>{t.searchSummary(m.current.query,m.current.location)}</b></span></p>
  <Button variant="secondary" size="sm" onClick={()=>f.setFormOpen(true)}>{t.edit}</Button>
 </div>;
 return <form ref={f.formRef} className="pos-sform" aria-label={tr('discovery.newSearch')} onSubmit={e=>{e.preventDefault();f.submit(new FormData(e.currentTarget))}} data-testid="search-form">
  <div className="pos-sform__main">
   <label className="pos-sfield pos-sfield--query"><span>{tr('discovery.queryLabel')}</span>
    <input name="query" placeholder={tr('discovery.queryPlaceholder')} required maxLength={250} value={f.fields.query} onChange={e=>f.setFields(x=>({...x,query:e.target.value}))}/></label>
   <label className="pos-sfield"><span>{tr('discovery.locationLabel')}</span>
    <input name="location" placeholder={tr('discovery.locationPlaceholder')} required maxLength={120} value={f.fields.location} onChange={e=>f.setFields(x=>({...x,location:e.target.value}))}/></label>
   <Button type="submit" variant="primary" size="md" iconStart="search" className="pos-sform__submit" loading={m.busy} disabled={m.busy}>{tr('discovery.runSearch')}</Button>
  </div>
  <details className="pos-sform__more" id={`${id}-more`}>
   <summary><span>{t.settings}</span><Icon name="chevron-down" size={16}/></summary>
   <p className="pos-snote">{sourceNote}</p>
   {f.registryPlan&&<div className="pos-snote"><p><b>{tr('discovery.registryPlan')}</b> {f.registryPlan.groups.map(g=>g.label).join(' · ')||'—'}</p>
    {f.registryPlan.unmapped.length>0&&<p>{tr('discovery.registryUnmapped')} {f.registryPlan.unmapped.join(', ')}</p>}
    {f.fields.employeeRange&&<p>{tr('discovery.registryHeadcount')} {f.fields.employeeRange.min}–{f.fields.employeeRange.max} {tr('discovery.registryEmployees')}</p>}</div>}
   <div className="pos-sform__grid">
    <label className="pos-sfield"><span>{tr('discovery.categoriesLabel')}</span>
     <input name="categories" placeholder={tr('discovery.categoriesPlaceholder')} value={f.fields.categories} onChange={e=>f.setFields(x=>({...x,categories:e.target.value}))}/></label>
    <label className="pos-sfield"><span>{tr('discovery.maxResultsLabel')}</span>
     <input name="max" type="number" min={1} max={20} value={f.fields.max} onChange={e=>f.setFields(x=>({...x,max:Number(e.target.value)}))}/></label>
    <label className="pos-sfield"><span>{tr('deep.modeLabel')}</span>
     <select name="search_mode" value={f.fields.searchMode} onChange={e=>f.setFields(x=>({...x,searchMode:e.target.value as SearchMode}))}>
      <option value="all">{tr('deep.mode.all')}</option><option value="new_first">{tr('deep.mode.new_first')}</option>
      <option value="search_new" disabled={mode==='demo'}>{tr('deep.mode.search_new')}</option></select></label>
    {f.fields.searchMode==='search_new'&&<label className="pos-sfield"><span>{tr('deep.targetLabel')}</span>
     <input name="desired" type="number" min={1} max={f.fields.max} value={f.fields.desiredNew??f.fields.max} onChange={e=>f.setFields(x=>({...x,desiredNew:Number(e.target.value)}))}/>
     <small>{tr('deep.hint')}</small></label>}
    <label className="pos-sfield"><span>{tr('discovery.sourceLabel')}</span>
     <select value={f.provider} onChange={e=>f.setProvider(e.target.value)}>
      <option value="fixture">{tr('discovery.fixtureOption')}</option>
      <option value="brave" disabled={mode==='demo'||!f.available}>Brave Search {f.available&&mode==='live'?tr('discovery.braveConfigured'):tr('discovery.braveNotConfigured')}</option>
      <option value="registry" disabled={mode==='demo'||!f.registryAvailable}>{tr('discovery.providerRegistry')}</option>
      <option value="bodacc_sales" disabled={mode==='demo'||!f.registryAvailable}>{t.salesOption}</option></select></label>
    {f.provider==='registry'&&<fieldset className="pos-sfield pos-sfield--range"><legend>{tr('discovery.headcountLabel')}</legend>
     <label><span>{tr('discovery.headcountMin')}</span><input name="employee_min" type="number" min={0} max={1000000} step={1} inputMode="numeric" value={f.headcount.min} onChange={e=>f.typeHeadcount({...f.headcount,min:e.target.value})}/></label>
     <label><span>{tr('discovery.headcountMax')}</span><input name="employee_max" type="number" min={1} max={1000000} step={1} inputMode="numeric" value={f.headcount.max} onChange={e=>f.typeHeadcount({...f.headcount,max:e.target.value})}/></label>
     <small>{tr('discovery.registryEmployees')}</small></fieldset>}
   </div>
  </details>
  {m.current&&<Button variant="quiet" size="sm" onClick={()=>f.setFormOpen(false)}>{m.tr('common.close')}</Button>}
 </form>;
}

function ResultCard({m,r}:{m:DiscoveryView;r:DiscoveryResult}){
 const {tr,locale}=m;const t=NATIVE_TEXT[locale];const f=m.factsOf(r);const meta=f.meta as typeof f.meta&{observed_location?:unknown;observed_location_basis?:unknown};
 const name=f.nameResolved?r.normalized_payload.name:f.legacy?tr('discovery.legacyUnclassified'):tr('discovery.unresolvedCompany');
 const place=r.normalized_payload.city??(typeof meta.observed_location==='string'?`${meta.observed_location} · ${tr(meta.observed_location_basis==='THIRD_PARTY_SOURCE'?'discovery.locationThirdParty':'discovery.locationMentioned')}`:tr('discovery.cityToConfirm'));
 const v=verificationOf(f,locale);const pr=f.canAdd?m.priorityOf(r):null;const titleId=`pos-sres-${r.id}`;
 // The candidate state is the default of a result: only a decided or not identified one says its state on the face.
 const stateTag=f.state!=='candidate'&&!(f.state==='added'&&f.nov?.status==='ADDED');
 const why=pr?shortReasons(pr.reasons,locale):f.typeKey?tr(f.typeKey):tr('discovery.class.uncertain');
 const sources=1+(f.meta.additional_sources?.length??0);
 return <li><article className={`pos-sres pos-sres--${f.state}`} aria-labelledby={titleId} data-testid="search-result" data-state={f.state} data-novelty={f.nov?.status??''}>
  <header className="pos-sres__head">
   <h3 id={titleId} className="pos-sres__name">{name}</h3>
   <p className="pos-sres__place"><span>{place}</span>
    <a className="pos-sres__source" href={r.normalized_payload.source_url} title={r.normalized_payload.source_url} rel="noreferrer" target="_blank">{t.source}<Icon name="external" size={12}/><span className="pos-visually-hidden"> {f.sourceHost||r.normalized_payload.source_title}</span></a></p>
  </header>
  {(f.nov||pr||stateTag)&&<p className="pos-sres__tags">
   {f.nov&&<span className={`pos-stag pos-stag--novelty-${f.nov.status.toLowerCase()}`} title={f.hist&&f.hist.status!==f.nov.status?`${tr('novelty.atRunTime')} ${tr(`novelty.${f.hist.status}` as TKey)}`:undefined}>{tr(`novelty.${f.nov.status}` as TKey)}</span>}
   {pr&&<span className={`pos-stag pos-stag--priority-${pr.level.toLowerCase()}`} data-priority={pr.level}>{priorityChip(pr.level,locale)}</span>}
   {stateTag&&<span className={`pos-stag pos-stag--state-${f.state}`}>{tr(STATE_KEY[f.state])}</span>}
  </p>}
  <p className="pos-sres__why"><span className="pos-visually-hidden">{t.why} : </span>{why}</p>
  <p className="pos-sres__verify"><span className="pos-visually-hidden">{t.verification} : </span><span className={`pos-sverify pos-sverify--${v.kind}`} data-verification={v.kind}><Icon name={VERIFY_ICON[v.kind]} size={14}/>{v.label}</span>
   {v.hint&&<small className="pos-sres__hint">{v.hint}</small>}</p>
  {r.status==='pending'&&r.dedupe_status!=='unique'&&<p className="pos-snote pos-snote--warn">{r.reason??tr('discovery.possibleDuplicate')} · {r.dedupe_status==='duplicate_candidate'?tr('discovery.existingProspect'):tr('discovery.noAutoMerge')}</p>}
  {/* The legacy card's actions, same conditions and same handlers. */}
  <div className="pos-sres__actions">
   {f.alreadyProspect?<>{m.canOpenProspect&&<Button variant="secondary" size="sm" iconEnd="arrow-right" onClick={()=>m.openProspect(f.nov!.prospect_id!)}>{tr('discovery.viewProspect')}</Button>}</>
    :r.status==='pending'&&!f.canAdd?<Button variant="secondary" size="sm" disabled={m.busy} onClick={()=>m.ignore(r)}>{tr('discovery.ignore')}</Button>
    :r.status==='pending'?<><Button variant="primary" size="sm" iconStart="plus" disabled={m.busy} onClick={()=>m.accept(r,r.dedupe_status==='merge_review_required')}>
      {r.dedupe_status==='merge_review_required'?tr('discovery.addSeparately'):r.dedupe_status==='duplicate_candidate'?tr('discovery.openExisting'):tr('discovery.addThenAnalyze')}</Button>
     <Button variant="quiet" size="sm" disabled={m.busy} onClick={()=>m.ignore(r)}>{tr('discovery.ignore')}</Button></>
    :<>{r.status==='accepted'&&r.prospect_id&&m.canOpenProspect&&<Button variant="secondary" size="sm" iconEnd="arrow-right" onClick={()=>m.openProspect(r.prospect_id!)}>{tr('discovery.viewProspect')}</Button>}</>}
   {(f.nov?.status==='SEEN'||f.nov?.status==='IGNORED')&&f.nov.run_id&&f.nov.run_id!==m.run&&<Button variant="quiet" size="sm" disabled={m.busy} onClick={()=>m.openRun(f.nov!.run_id!)}>{tr('novelty.viewOldRun')}</Button>}
  </div>
  <details className="pos-sdetails">
   <summary><span>{t.advanced}</span><Icon name="chevron-down" size={16}/></summary>
   <dl className="pos-sadv">
    {f.cls&&<div><dt>{t.kind}</dt><dd><span className="pos-schip">{f.cls==='COMPANY_CANDIDATE'?tr('discovery.class.companyCandidate'):f.cls==='SIGNAL_SOURCE'?tr('discovery.class.signalSource'):tr('discovery.class.uncertain')}</span>
     <span className="pos-schip">{tr(STATE_KEY[f.state])}</span></dd></div>}
    {f.nameResolved&&<div><dt>{tr('discovery.identifiedCompanyLabel')}</dt><dd>{r.normalized_payload.name}</dd></div>}
    {f.nameResolved&&<div><dt>{tr('discovery.companyWebsiteLabel')}</dt><dd>{r.normalized_payload.website??tr('discovery.websitePendingReview')}</dd></div>}
    <div><dt>{tr('discovery.signalFoundVia')}</dt><dd><a href={r.normalized_payload.source_url} rel="noreferrer" target="_blank">{f.sourceHost||r.normalized_payload.source_title}<Icon name="external" size={12}/></a>
     {f.typeKey&&<span className="pos-schip">{tr(f.typeKey)}</span>}{f.viaThirdParty&&<span className="pos-schip">{t.thirdParty}</span>}
     <span className="pos-sres__muted pos-sadv__title">{r.normalized_payload.source_title}</span></dd></div>
    {f.nameResolved&&<div><dt>{tr('discovery.resolutionLabel')}</dt><dd>{f.domainResolved?tr('discovery.resolutionBothLabel'):tr('discovery.resolutionNameOnlyLabel')}</dd></div>}
    <div><dt>{t.confidence}</dt><dd>{foundLine(locale,Math.round(r.normalized_payload.confidence*100),r.normalized_payload.discovered_source)}</dd></div>
    <div><dt>{t.sources}</dt><dd>{sources}{!!f.meta.additional_sources?.length&&<> · {f.meta.additional_sources.map((s,i)=><a key={i} href={s.source_url} rel="noreferrer" target="_blank">{i?' · ':''}{s.source_title}<Icon name="external" size={12}/></a>)}</>}</dd></div>
    <div><dt>{tr('discovery.currentScore')}</dt><dd><b>{scoreText(f.score,locale)??tr('score.notScored')}</b>{f.score===null&&<span className="pos-sres__muted"> — {tr('discovery.noEvidenceAtDiscovery')}</span>}</dd></div>
    {pr&&<div><dt>{tr('discovery.reviewPriority')}</dt><dd>{tr(`discovery.priority.${pr.level}` as TKey)}{pr.reasons.length>0&&<span className="pos-sres__muted"> — {pr.reasons.slice(0,4).map(x=>tr(`discovery.priorityReason.${x}` as TKey)).join(' · ')}</span>}</dd></div>}
   </dl>
   {f.viaThirdParty&&<p className="pos-sres__muted">{tr('discovery.signalSourceNote')}</p>}
   {f.canAdd&&<p className="pos-sres__muted">{tr('discovery.priorityExplain')}</p>}
   {r.status==='pending'&&!f.canAdd&&<p className="pos-sres__muted">{tr('discovery.notAddable')}</p>}
  </details>
 </article></li>;
}

function RunDetails({m,c}:{m:DiscoveryView;c:RunSummary}){
 const {tr,locale}=m;const t=NATIVE_TEXT[locale];
 return <details className="pos-sdetails pos-sdetails--run">
  <summary><span>{t.runDetails}</span><Icon name="chevron-down" size={16}/></summary>
  <p className="pos-sres__muted">{tr('discovery.viewingRun')} {runDateLabel(locale,c.started_at)} · {tr(`discovery.runStatus.${runState(c)}` as TKey)} · {c.provider==='brave'?tr('discovery.providerBrave'):c.provider==='registry'?tr('discovery.providerRegistry'):c.provider==='bodacc_sales'?NATIVE_TEXT[locale].salesOption:tr('discovery.providerFixture')}</p>
  {c.categories.length>0&&<p className="pos-sres__muted">{c.categories.join(', ')}</p>}
  {c.search&&<><p>{passesLabel(locale,c.search.passes)} · {c.search.stop_reason==='TARGET_REACHED'?deepStopLabel(locale,'TARGET_REACHED',c.search.new_results_found):<>{newActorsFoundLabel(locale,c.search.new_results_found)} · {deepStopLabel(locale,c.search.stop_reason,c.search.new_results_found)}</>}</p>
   <ul>{c.search.pass_results.map((n,i)=><li key={i}>{deepPassLine(locale,i+1,n,c.search!.pass_new_results[i]??0,c.search!.pass_durations_ms[i]??0)}</li>)}</ul>
   <p className="pos-sres__muted">{tr('deep.limitsNote')}</p></>}
  {m.cost&&<div><p><b>{tr('discovery.estimatedCost')}</b> {m.cost.total_estimated_cost_micros!=null?`${(m.cost.total_estimated_cost_micros/1000000).toFixed(4)} $`:tr('discovery.costUnavailable')}</p>
   <p><b>{tr('discovery.searches')}</b> {m.cost.search_requests} · <b>{tr('discovery.prospectsCreated')}</b> {m.cost.prospects_created} · <b>{tr('discovery.evidenceVerified')}</b> {m.cost.evidence_verified}</p>
   <p className="pos-sres__muted">{m.cost.cost_unavailable_reason??tr('discovery.defaultCostReason')}</p></div>}
 </details>;
}

function Results({m}:{m:DiscoveryView}){
 const {tr,locale}=m;const t=NATIVE_TEXT[locale];const c=m.current;
 if(!m.run)return m.busy?<p className="pos-sstatus" role="status" data-testid="search-loading"><span className="pos-sspinner" aria-hidden="true"/>{t.searching}</p>
  :<div className="pos-empty" data-testid="search-start"><p className="pos-empty__title">{t.startTitle}</p><p className="pos-empty__body">{t.startBody}</p></div>;
 return <section className="pos-sresults" aria-labelledby="pos-sresults-title" data-testid="search-results">
  <header className="pos-sresults__head">
   <h3 id="pos-sresults-title" className="pos-sresults__title">{t.results(m.candidates.length)}</h3>
   <p className="pos-sres__muted">{resultsSummaryLabel(locale,m.results.length,m.counts.added,m.counts.ignored,m.counts.unresolved)} — {searchDoneNote(locale,m.results.length,m.form.provider==='fixture'?tr('discovery.fixtureIndependent'):m.form.provider==='registry'?tr('discovery.registryCompanies'):m.form.provider==='bodacc_sales'?NATIVE_TEXT[locale].salesCompanies:tr('discovery.candidatePages'))}</p>
  </header>
  {c?.reused&&<p role="status" className="pos-snote">{tr('discovery.reusedNote').replace('{email}',c.reused.by_email??tr('discovery.reusedTeammate')).replace('{date}',runDateLabel(locale,c.reused.started_at))}</p>}
  {c?.partial&&<p role="status" className="pos-snote pos-snote--warn"><b>{tr('discovery.partialSearch')}</b>{c.partial.failed_groups.length>0&&<> {tr('discovery.partialGroups')} {c.partial.failed_groups.map(k=>nafGroupLabel(k)??k).join(' · ')}.</>}{c.partial.failure_codes.includes('HTTP_429')&&<> {tr('discovery.partialRateLimited')}</>}</p>}
  {m.hasNovelty&&<div className="pos-snovelty">
   <p className="pos-sres__muted">{noveltySummaryLabel(locale,m.noveltyTotals)}</p>
   <div className="pos-stabs" role="group" aria-label={tr('novelty.filterAria')}>
    {TABS.filter(k=>k!=='CURRENT_RUN_DUPLICATE'||m.tabCount(k)>0).map(k=><button key={k} type="button" className="pos-stab" aria-pressed={m.noveltyTab===k}
     onClick={()=>m.selectTab(k as 'ALL'|NoveltyStatus)}>{tr(`novelty.tab.${k}` as TKey)} <b>{m.tabCount(k)}</b></button>)}
   </div>
   <p className="pos-sres__muted pos-snovelty__note">{tr('novelty.newFirstNote')}</p>
  </div>}
  {m.shown.length>0?<ul className="pos-sresults__list">{m.shown.slice(0,m.resultsShown).map(r=><ResultCard key={r.id} m={m} r={r}/>)}</ul>
   :m.hasNovelty&&m.candidates.length>0?<p className="pos-sres__muted">{tr('novelty.emptyTab')}</p>
   :<div className="pos-empty" data-testid="search-empty"><p className="pos-empty__title">{t.noResults}</p><p className="pos-empty__body">{t.noResultsBody}</p></div>}
  {m.shown.length>m.resultsShown&&<Button variant="secondary" size="md" fullWidth onClick={m.showMore}>{tr('discovery.showMoreResults')} ({m.morePage})</Button>}
  {m.discarded.length>0&&<details className="pos-sdetails">
   <summary><span>{tr('discovery.discardedTitle')} ({m.discarded.length})</span><Icon name="chevron-down" size={16}/></summary>
   <p className="pos-sres__muted">{tr('discovery.discardedNote')}</p>
   <ul className="pos-sdiscarded">{m.discarded.map(r=>{const label=m.discardedLabel(r);return <li key={r.id}>{label&&<span className="pos-sres__muted">{label} · </span>}<a href={r.normalized_payload.source_url} rel="noreferrer" target="_blank">{r.normalized_payload.source_title}<Icon name="external" size={12}/></a></li>})}</ul>
  </details>}
  {c&&<RunDetails m={m} c={c}/>}
 </section>;
}

function History({m}:{m:DiscoveryView}){
 const {tr,locale}=m;const t=NATIVE_TEXT[locale];const runs=m.runs;
 return <section className="pos-shistory" aria-labelledby="pos-shistory-title" data-testid="search-history">
  <h3 id="pos-shistory-title" className="pos-shistory__title">{t.history}</h3>
  {m.historyError&&<p className="pos-sres__muted">{tr('discovery.historyUnavailable')}</p>}
  {runs&&!runs.length&&!m.historyError&&<p className="pos-sres__muted">{tr('discovery.historyEmpty')}</p>}
  {runs&&runs.length>0&&!m.current&&<div className="pos-slast"><p className="pos-sres__muted">{tr('discovery.lastSearch')} · {runDateLabel(locale,runs[0]!.started_at)}</p>
   <p><b>{runs[0]!.query}</b> · {runs[0]!.location}</p>
   <Button variant="secondary" size="sm" disabled={m.busy} onClick={()=>m.viewRun(runs[0]!)}>{tr('discovery.resumeResults')}</Button></div>}
  {!!runs?.length&&<ul className="pos-sruns">{runs.map(h=>{const state=runState(h);return <li key={h.id}><article className={`pos-srun${m.current?.id===h.id?' is-current':''}`} aria-current={m.current?.id===h.id?'true':undefined}>
   <p className="pos-srun__top"><span className="pos-sres__muted">{runDateLabel(locale,h.started_at)}</span><span className={`pos-stag pos-stag--run-${state}`}>{tr(`discovery.runStatus.${state}` as TKey)}</span></p>
   <h4 className="pos-srun__query" title={h.query}>{h.query}</h4>
   <p className="pos-sres__muted">{h.location} · {runCountsLabel(locale,h.result_count,h.accepted_count,h.ignored_count)}{h.novelty&&<> · {runNoveltyLabel(locale,h.novelty)}</>}{h.search&&<> · {passesLabel(locale,h.search.passes)}</>}</p>
   <div className="pos-srun__actions"><Button variant="secondary" size="sm" disabled={m.busy} onClick={()=>m.viewRun(h)}>{tr('discovery.viewResults')}</Button>
    <Button variant="quiet" size="sm" disabled={m.busy} onClick={()=>m.replay(h)}>{tr('discovery.replay')}</Button></div>
  </article></li>})}</ul>}
  {m.hasMoreRuns&&<Button variant="quiet" size="sm" fullWidth disabled={m.busy} onClick={()=>void m.moreRuns()}>{tr('discovery.showMoreRuns')}</Button>}
 </section>;
}

// onEditTargeting: opens « Offre et cible » (the ICP editor), where every criterion and its rule can be changed.
export function SearchNative({m,onEditTargeting}:{m:DiscoveryView;onEditTargeting?:()=>void}){
 const {tr}=m;const t=NATIVE_TEXT[m.locale];
 return <div className="pos-snative" data-testid="search-native">
  {m.mode==='demo'&&<p className="pos-snote">{tr('discovery.demoNote')}</p>}
  <Form m={m}/>
  <details className="pos-sdetails pos-sdetails--context">
   <summary><span>{t.targeting} · {m.projectName}</span><Icon name="chevron-down" size={16}/></summary>
   <p><b>{tr('discovery.offerUsed')}</b> {m.offer.trim()||tr('discovery.noOffer')}</p>
   <p><b>{tr('discovery.icpUsed')}</b> {m.criteria.map(c=>c.label).join(' · ')||tr('discovery.noCriteria')}</p>
   {onEditTargeting&&<button type="button" className="pos-slink" onClick={onEditTargeting}>{t.editCriteria}</button>}
  </details>
  {m.replayed&&<p className="pos-snote" role="status">{tr('discovery.replayNote')}</p>}
  {m.busy&&m.deepPending&&<p className="pos-snote" role="status">{tr('deep.running')}</p>}
  {m.info&&<p className="pos-snote" role="status">{m.info}</p>}
  {m.error&&<p className="pos-snote pos-snote--error" role="alert" data-testid="search-error">{m.error}</p>}
  <div className="pos-snative__layout">
   <div className="pos-snative__main"><Results m={m}/></div>
   <aside className="pos-snative__side" aria-label={t.history}><History m={m}/></aside>
  </div>
 </div>;
}
