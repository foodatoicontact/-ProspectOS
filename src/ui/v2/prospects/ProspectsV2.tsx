'use client';
// Prospects 2.0 (UI-5A, docs/UI_V2.md) — the v2 "Prospects" entry: the list, then one record at a time. Rendered by the
// v2 shell only (UI_V2_ENABLED); flag OFF, app/page.tsx renders the legacy list + record exactly as before.
// Same data, same handlers, same dialogs as the legacy screen: app/page.tsx passes its own state and functions (search,
// status filter, add, export, status change, evidence, channels, outreach) — nothing here calls the API or decides.
// The components that load and review data themselves (observations, signals, public content, writing style, feedback)
// are the existing ones, rendered unchanged inside a v2-themed island (.pos-island).
// Nothing is ever sent from here: a message is prepared, approved and copied by a person.
import {useEffect,useRef,type KeyboardEvent as ReactKeyboardEvent,type ReactNode} from 'react';
import './prospects.css';
import {translate} from '../../../i18n/index.ts';
import type {Locale} from '../../../i18n/locale.ts';
import {bestChannel,safeLink,type Criterion,type Evidence,type Prospect,type scoreProspect} from '../../../domain/core.ts';
import type {FitEstimate} from '../../../domain/fit-estimate.ts';
import type {FitDisplay} from '../../../domain/score-display.ts';
import type {ReviewSummary} from '../../../components/evidence-presentation.ts';
import {statusLabel,outreachStatusLabel} from '../../../i18n/labels.ts';
import {Button,Icon,StatusBadge} from '../primitives.tsx';
import {prospectRows,fitBadge,criteriaView,situationOf,advancedOf,type ProspectRow,type CriterionView,type EvidenceItem,type FitKind} from './model.ts';

export const PROSPECTS_TEXT:Record<Locale,{
 title:string;export:string;add:string;createProject:string;search:string;searchPlaceholder:string;filter:string;all:string;count:(n:number,total:number)=>string;
 noMatchTitle:string;noMatchBody:string;reset:string;open:(name:string)=>string;placeUnknown:string;
 situation:string;context:string;evidence:string;evidenceIntro:string;observations:string;publicContent:string;action:string;message:string;decision:string;
 channels:string;history:string;advanced:string;advancedNote:string;criteria:string;addEvidence:string;analyze:string;addChannel:string;review:string;source:string;
 verify:string;website:string;status:string;contacted:string;ignore:string;prepare:string;regenerate:string;save:string;approve:string;copy:string;linkedin:string;
 noEvidence:string;fitLabel:string;channelToConfirm:string;channelVerified:string;dismiss:string;signalHint:string}>={
 fr:{title:'Prospects',export:'Exporter en CSV',add:'Ajouter un prospect',createProject:'Créer un projet',search:'Rechercher un prospect',
  searchPlaceholder:'Rechercher par nom…',filter:'Filtrer par statut',all:'Tous les statuts',
  count:(n,total)=>n===total?`${total} prospect${total>1?'s':''}`:`${n} sur ${total} prospect${total>1?'s':''}`,
  noMatchTitle:'Aucun prospect ne correspond.',noMatchBody:'Modifiez la recherche ou le statut choisi.',reset:'Effacer la recherche et le filtre',
  open:name=>`Ouvrir la fiche de ${name}`,placeUnknown:'Localisation à confirmer',
  situation:'Situation',context:'Signaux et contexte',evidence:'Preuves par critère',
  evidenceIntro:'Une preuve vérifiée a une source relue par une personne. Une information déclarée par vous aide l’estimation, sans être une preuve.',
  observations:'Observations à vérifier',publicContent:'Contenu public',action:'Votre action',message:'Message',decision:'Statut commercial',
  channels:'Canaux de contact',history:'Historique de la session',advanced:'Détails avancés',advancedNote:'Chiffres du moteur — pour auditer, jamais nécessaires pour décider.',
  criteria:'Critères',addEvidence:'Ajouter une preuve',analyze:'Analyser un texte public',addChannel:'Ajouter un canal',review:'Revoir les observations',source:'Source',
  verify:'J’ai vérifié la source : valider',website:'Site',status:'Statut du prospect',contacted:'Marquer contacté',ignore:'Ignorer',
  prepare:'Préparer le message',regenerate:'Régénérer',save:'Enregistrer',approve:'Approuver',copy:'Copier',linkedin:'Ouvrir le profil LinkedIn',
  noEvidence:'Aucune preuve listée ici.',fitLabel:'FIT',channelToConfirm:'à confirmer',channelVerified:'vérifié',dismiss:'Fermer le message',
  signalHint:'Les signaux récents et leur source.'},
 en:{title:'Prospects',export:'Export CSV',add:'Add a prospect',createProject:'Create a project',search:'Search a prospect',
  searchPlaceholder:'Search by name…',filter:'Filter by status',all:'All statuses',
  count:(n,total)=>n===total?`${total} prospect${total>1?'s':''}`:`${n} of ${total} prospect${total>1?'s':''}`,
  noMatchTitle:'No prospect matches.',noMatchBody:'Change the search or the chosen status.',reset:'Clear search and filter',
  open:name=>`Open ${name}’s record`,placeUnknown:'Location to confirm',
  situation:'Situation',context:'Signals and context',evidence:'Evidence by criterion',
  evidenceIntro:'Verified evidence has a source a person checked. Information declared by you helps the estimate without being evidence.',
  observations:'Observations to check',publicContent:'Public content',action:'Your action',message:'Message',decision:'Commercial status',
  channels:'Contact channels',history:'Session history',advanced:'Advanced details',advancedNote:'Engine figures — for auditing, never needed to decide.',
  criteria:'Criteria',addEvidence:'Add evidence',analyze:'Analyze a public text',addChannel:'Add a channel',review:'Review the observations',source:'Source',
  verify:'I checked the source: validate',website:'Website',status:'Prospect status',contacted:'Mark contacted',ignore:'Ignore',
  prepare:'Prepare the message',regenerate:'Regenerate',save:'Save',approve:'Approve',copy:'Copy',linkedin:'Open the LinkedIn profile',
  noEvidence:'No evidence listed here.',fitLabel:'FIT',channelToConfirm:'to confirm',channelVerified:'verified',dismiss:'Dismiss message',
  signalHint:'Recent signals and their source.'},
};

type Scored=ReturnType<typeof scoreProspect>;
export type ProspectsOutreach={draft:string;status:string;description:string;angle:ReactNode;hint:string|null;note:string|null;error:string;
 ai:{checked:boolean;label:string;onChange:(v:boolean)=>void}|null;canSave:boolean;linkedin:string|null;style:ReactNode;
 onChange:(v:string)=>void;onGenerate:()=>void;onSave:()=>void;onApprove:()=>void;onCopy:()=>void};
export type ProspectRecord={prospect:Prospect;criteria:Criterion[];scored:Scored;estimate:FitEstimate;fit:FitDisplay;summary:ReviewSummary;intent:{score:number;estimated:{score:number}}|null;
 back:{label:string;onBack:()=>void};badge:string|null;note:string|null;statuses:readonly string[];
 onStatus:(v:string)=>void;onAddEvidence:()=>void;onAnalyze:()=>void;onAddChannel:()=>void;onVerify:(e:Evidence)=>void;onReview:(anchor:string)=>void;
 observations:ReactNode;signals:ReactNode;publicContent:ReactNode;outreach:ProspectsOutreach;history:{text:string;at:string}[]};
export type ProspectsV2Props={locale:Locale;busy:boolean;
 visible:Prospect[];total:number;criteria:Criterion[];statuses:readonly string[];
 query:string;onQuery:(v:string)=>void;filter:string;onFilter:(v:string)=>void;onOpen:(id:string)=>void;
 // The row to focus when the list comes back (the record just closed).
 focusId:string|null;
 hasProject:boolean;onAdd:()=>void;onExport:()=>void;
 // A live project without any prospect: the legacy activation (prepare the targeting, or find prospects).
 activation:{kind:'target'|'find';onActivate:()=>void}|null;
 top:ReactNode;notice:string;onDismissNotice:()=>void;paywall:{text:string;action:string;onAction:()=>void;onDismiss:()=>void}|null;
 listFooter:ReactNode;record:ProspectRecord|null};

const FIT_ICON:Record<FitKind,'verified'|'info'|'verify'>={verified:'verified',estimated:'info',document:'verify'};
function FitTag({kind,label,hint,locale}:{kind:FitKind;label:string;hint:string|null;locale:Locale}){
 return <span className={`pos-fit pos-fit--${kind}`} data-fit={kind}>
  <Icon name={FIT_ICON[kind]} size={14}/><span><span className="pos-visually-hidden">{PROSPECTS_TEXT[locale].fitLabel} : </span>{label}</span>
  {hint&&<small className="pos-fit__hint" title={hint}>{hint}</small>}
 </span>;
}

function Row({row,locale,busy,onOpen,refFor}:{row:ProspectRow;locale:Locale;busy:boolean;onOpen:(id:string)=>void;refFor:(id:string,el:HTMLButtonElement|null)=>void}){
 const t=PROSPECTS_TEXT[locale];
 return <li><button ref={el=>refFor(row.id,el)} type="button" className="pos-prow" data-testid="prospect-row" data-id={row.id} disabled={busy}
  aria-label={t.open(row.name)} onClick={()=>onOpen(row.id)}>
  <span className="pos-prow__initial" aria-hidden="true">{row.initial}</span>
  <span className="pos-prow__main">
   <span className="pos-prow__name">{row.name}</span>
   <span className={`pos-prow__meta${row.place?'':' pos-prow__meta--unknown'}`}>{row.place??t.placeUnknown}</span>
  </span>
  <span className="pos-prow__facts">
   <span className="pos-pstatus">{row.statusLabel}</span>
   <FitTag kind={row.fit.kind} label={row.fit.label} hint={row.fit.hint} locale={locale}/>
  </span>
  <Icon name="chevron-right" size={18} className="pos-prow__chevron"/>
 </button></li>;
}

function Banners({p}:{p:ProspectsV2Props}){
 const t=PROSPECTS_TEXT[p.locale];
 return <>
  {p.top}
  {p.paywall&&<div className="pos-banner pos-banner--verify" role="status"><p>{p.paywall.text}</p>
   <Button variant="primary" size="sm" onClick={p.paywall.onAction}>{p.paywall.action}</Button>
   <Button variant="quiet" size="sm" aria-label={t.dismiss} onClick={p.paywall.onDismiss}><Icon name="close" size={16}/></Button></div>}
  {p.notice&&<div className="pos-banner" role="status"><p>{p.notice}</p>
   <Button variant="quiet" size="sm" aria-label={t.dismiss} onClick={p.onDismissNotice}><Icon name="close" size={16}/></Button></div>}
 </>;
}

function List({p}:{p:ProspectsV2Props}){
 const t=PROSPECTS_TEXT[p.locale];
 const rows=prospectRows(p.visible,p.criteria,p.locale,new Date());
 const refs=useRef(new Map<string,HTMLButtonElement>());
 const refFor=(id:string,el:HTMLButtonElement|null)=>{if(el)refs.current.set(id,el);else refs.current.delete(id)};
 // Back from a record: the row of the prospect just closed gets the focus again.
 useEffect(()=>{if(p.focusId)refs.current.get(p.focusId)?.focus({preventScroll:false})},[p.focusId]);
 // ↑ / ↓ move between the rows (each row stays a plain button: Tab and Enter work as usual).
 const onKeyDown=(e:ReactKeyboardEvent<HTMLUListElement>)=>{
  if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
  const items=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('.pos-prow:not(:disabled)')];
  const i=items.indexOf(document.activeElement as HTMLButtonElement);if(i<0)return;
  const next=items[e.key==='ArrowDown'?Math.min(items.length-1,i+1):Math.max(0,i-1)];
  if(next){e.preventDefault();next.focus()}
 };
 const filtered=p.total>0&&!rows.length;
 return <section className="pos-plist" aria-labelledby="pos-plist-title">
  <div className="pos-plist__head">
   <div className="pos-plist__titles"><h2 id="pos-plist-title" className="pos-plist__title">{t.title}</h2>
    <p className="pos-plist__count" aria-live="polite">{t.count(rows.length,p.total)}</p></div>
   <div className="pos-plist__actions">
    <Button variant="secondary" size="sm" className="pos-plist__export" onClick={p.onExport}>{t.export}</Button>
    <Button variant="primary" size="sm" iconStart="plus" disabled={p.busy} onClick={p.onAdd}>{p.hasProject?t.add:t.createProject}</Button>
   </div>
  </div>
  {p.total>0&&<div className="pos-plist__tools" role="search">
   <label className="pos-psearch"><Icon name="search" size={18}/><span className="pos-visually-hidden">{t.search}</span>
    <input type="search" value={p.query} placeholder={t.searchPlaceholder} onChange={e=>p.onQuery(e.target.value)} data-testid="prospects-search"/></label>
   <label className="pos-pfilter"><span className="pos-visually-hidden">{t.filter}</span>
    <select value={p.filter} onChange={e=>p.onFilter(e.target.value)} data-testid="prospects-filter">
     <option value="Tous">{t.all}</option>{p.statuses.map(s=><option key={s} value={s}>{statusLabel(s,p.locale)}</option>)}</select>
    <Icon name="chevron-down" size={16}/></label>
  </div>}
  {rows.length>0&&<ul className="pos-plist__rows" onKeyDown={onKeyDown}>{rows.map(r=><Row key={r.id} row={r} locale={p.locale} busy={p.busy} onOpen={p.onOpen} refFor={refFor}/>)}</ul>}
  {filtered&&<div className="pos-empty" data-testid="prospects-no-match"><p className="pos-empty__title">{t.noMatchTitle}</p><p className="pos-empty__body">{t.noMatchBody}</p>
   <Button variant="secondary" size="sm" onClick={()=>{p.onQuery('');p.onFilter('Tous')}}>{t.reset}</Button></div>}
  {p.total===0&&(p.activation
   ?<div className="pos-empty" data-testid="prospects-activation">
    <p className="pos-empty__title">{translate(p.locale,p.activation.kind==='target'?'activation.targetTitle':'activation.findTitle')}</p>
    <p className="pos-empty__body">{translate(p.locale,p.activation.kind==='target'?'activation.targetBody':'activation.findBody')}</p>
    <Button variant="primary" size="md" disabled={p.busy} onClick={p.activation.onActivate}>{translate(p.locale,p.activation.kind==='target'?'activation.prepareTargeting':'actions.findProspects')}</Button>
    <Button variant="quiet" size="sm" disabled={p.busy} onClick={p.onAdd}>{translate(p.locale,'activation.addManually')}</Button></div>
   :<div className="pos-empty" data-testid="prospects-empty">
    <p className="pos-empty__title">{translate(p.locale,'prospects.emptyTitle')}</p><p className="pos-empty__body">{translate(p.locale,'prospects.emptyBody')}</p>
    <Button variant="primary" size="md" iconStart="plus" disabled={p.busy} onClick={p.onAdd}>{p.hasProject?t.add:t.createProject}</Button></div>)}
  {p.listFooter&&<div className="pos-island pos-plist__footer">{p.listFooter}</div>}
 </section>;
}

const BASIS_STATUS={verified:'verified',declared:'declared',to_verify:'verify'} as const;
function EvidenceRow({item,locale,busy,onVerify}:{item:EvidenceItem;locale:Locale;busy:boolean;onVerify:(e:Evidence)=>void}){
 const t=PROSPECTS_TEXT[locale];
 return <li className={`pos-pev pos-pev--${item.basis}`} data-basis={item.basis}>
  <StatusBadge status={BASIS_STATUS[item.basis]} locale={locale} label={item.basis==='to_verify'?item.statusLabel:undefined}/>
  <p className="pos-pev__text">{item.basis==='declared'?item.text:<q>{item.text}</q>}{item.note&&<span className="pos-pev__note"> — {item.note}</span>}</p>
  <p className="pos-pev__meta">{item.href&&<><a href={item.href} target="_blank" rel="noopener noreferrer">{t.source}<Icon name="external" size={14}/></a> · </>}{item.date}</p>
  {item.verifiable&&<Button variant="secondary" size="sm" disabled={busy} onClick={()=>onVerify(item.evidence)}>{t.verify}</Button>}
 </li>;
}
const CRITERION_ICON:Record<CriterionView['state'],{icon:'verified'|'declared'|'verify'|'excluded'|'warning'|'info';tone:string}>={
 verified:{icon:'verified',tone:'ok'},verified_false:{icon:'excluded',tone:'neutral'},contradicted:{icon:'warning',tone:'alert'},
 declared:{icon:'declared',tone:'declared'},declared_false:{icon:'declared',tone:'declared'},to_verify:{icon:'verify',tone:'todo'},unknown:{icon:'info',tone:'neutral'},
};
function CriterionBlock({c,locale,busy,onVerify,onReview}:{c:CriterionView;locale:Locale;busy:boolean;onVerify:(e:Evidence)=>void;onReview:(a:string)=>void}){
 const t=PROSPECTS_TEXT[locale];const m=CRITERION_ICON[c.state];
 return <li className="pos-pcrit" data-state={c.state}>
  <div className="pos-pcrit__head">
   <Icon name={m.icon} size={18} className={`pos-pcrit__icon pos-pcrit__icon--${m.tone}`}/>
   <span className="pos-pcrit__label">{c.label}<small data-testid="criterion-state">{c.stateLabel}</small>{c.contraryLabel&&<small className="pos-pcrit__contrary" data-testid="criterion-contrary" role="note">{c.contraryLabel}</small>}</span>
   {c.reviewAnchor&&<Button variant="quiet" size="sm" onClick={()=>onReview(c.reviewAnchor!)}>{t.review}</Button>}
  </div>
  {c.items.length>0&&<ul className="pos-pev__list">{c.items.map(i=><EvidenceRow key={i.id} item={i} locale={locale} busy={busy} onVerify={onVerify}/>)}</ul>}
 </li>;
}

function Section({id,title,children,actions,className}:{id:string;title:string;children:ReactNode;actions?:ReactNode;className?:string}){
 return <section className={`pos-psec${className?` ${className}`:''}`} aria-labelledby={id}>
  <div className="pos-psec__head"><h3 id={id} className="pos-psec__title">{title}</h3>{actions&&<div className="pos-psec__actions">{actions}</div>}</div>
  {children}
 </section>;
}

function Outreach({o,locale,busy}:{o:ProspectsOutreach;locale:Locale;busy:boolean}){
 const t=PROSPECTS_TEXT[locale];const drafted=!!o.draft;
 return <Section id="pos-prec-message" title={t.message} actions={<span className="pos-pdraft__status">{outreachStatusLabel(drafted?o.status:'DRAFT',locale)}</span>}>
  <p className="pos-psec__intro">{o.description}</p>
  {o.angle&&<div className="pos-island">{o.angle}</div>}
  {drafted?<textarea className="pos-pdraft" aria-label={translate(locale,'outreach.messageAria')} rows={7} value={o.draft} readOnly={o.status!=='DRAFT'} onChange={e=>o.onChange(e.target.value)}/>
   :<p className="pos-pdraft__empty">{translate(locale,'outreach.emptyDraft')}</p>}
  {o.note&&<p className="pos-psec__muted" role="status">{o.note}</p>}
  {o.hint&&<p className="pos-psec__muted">{o.hint}</p>}
  {o.ai&&<label className="pos-pcheck"><input type="checkbox" checked={o.ai.checked} disabled={busy} onChange={e=>o.ai!.onChange(e.target.checked)}/><span>{o.ai.label}</span></label>}
  {o.error&&<p className="pos-perror" role="alert">{o.error}</p>}
  <div className="pos-pactions">
   <Button variant="primary" size="md" iconStart="ai" disabled={busy} onClick={o.onGenerate}>{drafted?t.regenerate:t.prepare}</Button>
   {drafted&&o.status==='DRAFT'&&o.canSave&&<Button variant="secondary" size="md" disabled={busy} onClick={o.onSave}>{t.save}</Button>}
   {drafted&&o.status==='DRAFT'&&<Button variant="secondary" size="md" iconStart="check" disabled={busy} onClick={o.onApprove}>{t.approve}</Button>}
   {drafted&&o.status==='APPROVED'&&<Button variant="secondary" size="md" disabled={busy} onClick={o.onCopy}>{t.copy}</Button>}
   {o.linkedin&&<a className="pos-btn pos-btn--quiet pos-btn--md" href={o.linkedin} target="_blank" rel="noreferrer"><span className="pos-btn__label">{t.linkedin}</span><Icon name="external" size={18}/></a>}
  </div>
  {o.style&&<div className="pos-island">{o.style}</div>}
 </Section>;
}

function Record({r,locale,busy}:{r:ProspectRecord;locale:Locale;busy:boolean}){
 const t=PROSPECTS_TEXT[locale];const pr=r.prospect;
 const heading=useRef<HTMLHeadingElement>(null);
 // Opening a record moves the focus to its name (the list is gone); the back button is the next stop.
 useEffect(()=>{heading.current?.focus({preventScroll:true});window.scrollTo?.({top:0})},[pr.id]);
 const view=criteriaView(r.scored.breakdown,r.estimate,r.summary,pr,locale);
 const fit=fitBadge(r.fit,r.estimate,locale);const site=safeLink(pr.website);
 const channels=pr.channels??[];const best=bestChannel(channels);
 return <article className="pos-prec" aria-labelledby="pos-prec-name" data-testid="prospect-record">
  <Button variant="quiet" size="sm" iconStart="chevron-left" className="pos-prec__back" onClick={r.back.onBack}>{r.back.label}</Button>
  <header className="pos-prec__hero">
   <span className="pos-prec__initial" aria-hidden="true">{(pr.name.trim()[0]??'?').toUpperCase()}</span>
   <div className="pos-prec__id">
    <h2 id="pos-prec-name" ref={heading} tabIndex={-1} className="pos-prec__name">{pr.name}</h2>
    <p className="pos-prec__meta">{pr.city?.trim()||t.placeUnknown}{site&&<> · <a href={site} target="_blank" rel="noreferrer">{t.website}<Icon name="external" size={14}/></a></>}</p>
    <p className="pos-prec__tags"><span className="pos-pstatus">{statusLabel(pr.status,locale)}</span>{r.badge&&<span className="pos-pstatus pos-pstatus--muted">{r.badge}</span>}</p>
   </div>
  </header>
  <Section id="pos-prec-situation" title={t.situation} className="pos-psec--lead">
   <p className="pos-prec__situation"><FitTag kind={fit.kind} label={fit.label} hint={null} locale={locale}/> <span>{situationOf(view,locale)}</span></p>
   {r.note&&<p className="pos-psec__muted">{r.note}</p>}
  </Section>
  <div className="pos-prec__grid">
   <div className="pos-prec__col">
    <Section id="pos-prec-context" title={t.context}><div className="pos-island">{r.signals}</div><div className="pos-island">{r.publicContent}</div></Section>
    <Section id="pos-prec-evidence" title={t.evidence} actions={<>
     <Button variant="secondary" size="sm" iconStart="plus" onClick={r.onAddEvidence}>{t.addEvidence}</Button>
     <Button variant="quiet" size="sm" onClick={r.onAnalyze}>{t.analyze}</Button></>}>
     <p className="pos-psec__intro">{t.evidenceIntro}</p>
     <ul className="pos-pcrit__list" data-testid="record-criteria">{view.map(c=><CriterionBlock key={c.key} c={c} locale={locale} busy={busy} onVerify={r.onVerify} onReview={r.onReview}/>)}</ul>
     <h4 className="pos-psec__sub">{t.observations}</h4>
     <div className="pos-island">{r.observations}</div>
    </Section>
    <Outreach o={r.outreach} locale={locale} busy={busy}/>
   </div>
   <aside className="pos-prec__side" aria-label={t.action}>
    <Section id="pos-prec-decision" title={t.decision}>
     <label className="pos-pfilter pos-pfilter--full"><span className="pos-visually-hidden">{t.status}</span>
      <select value={pr.status} disabled={busy} onChange={e=>r.onStatus(e.target.value)} data-testid="record-status">
       {r.statuses.map(s=><option key={s} value={s}>{statusLabel(s,locale)}</option>)}</select><Icon name="chevron-down" size={16}/></label>
     <div className="pos-pactions">
      <Button variant="secondary" size="sm" iconStart="check" disabled={busy} onClick={()=>r.onStatus('Contacté')}>{t.contacted}</Button>
      <Button variant="quiet" size="sm" disabled={busy} onClick={()=>r.onStatus('Ignoré')}>{t.ignore}</Button>
     </div>
    </Section>
    <Section id="pos-prec-channels" title={t.channels} actions={<Button variant="quiet" size="sm" iconStart="plus" onClick={r.onAddChannel}>{t.addChannel}</Button>}>
     {channels.length?<ul className="pos-pchannels">{channels.map((c,i)=><li key={i}><b>{c.kind}</b><span>{c.value}</span>
      <small>{c.verified?t.channelVerified:t.channelToConfirm}</small></li>)}</ul>:<p className="pos-psec__muted">{translate(locale,'detail.noChannels')}</p>}
     {best&&<p className="pos-psec__muted">{translate(locale,'detail.suggestedChannelPrefix')}<b>{best.kind}</b>{translate(locale,'detail.suggestedChannelSuffix')}</p>}
    </Section>
   </aside>
  </div>
  <details className="pos-pdetails" data-testid="record-history">
   <summary>{t.history} {r.history.length?`(${r.history.length})`:''}<Icon name="chevron-down" size={16}/></summary>
   {r.history.length?<ul className="pos-phistory">{r.history.map((e,i)=><li key={i}>{e.text}<small> · {e.at}</small></li>)}</ul>:<p className="pos-psec__muted">{translate(locale,'outreach.noHistory')}</p>}
  </details>
  <details className="pos-pdetails" data-testid="record-advanced">
   <summary>{t.advanced}<Icon name="chevron-down" size={16}/></summary>
   <p className="pos-psec__muted">{t.advancedNote}</p>
   <dl className="pos-facts pos-facts--mono">{advancedOf(r.scored,r.fit,locale,r.intent).map(f=><div key={f.label} className="pos-facts__row"><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
   <h4 className="pos-psec__sub">{t.criteria}</h4>
   <dl className="pos-facts pos-facts--mono">{r.scored.breakdown.map(b=><div key={b.key} className="pos-facts__row"><dt>{b.label}</dt><dd>{b.state} · {b.points}/{b.weight}</dd></div>)}</dl>
  </details>
 </article>;
}

export function ProspectsV2(p:ProspectsV2Props){
 return <div className="pos-prospects" data-testid="prospects-v2">
  <div className="pos-prospects__main">
   <Banners p={p}/>
   {p.record?<Record r={p.record} locale={p.locale} busy={p.busy}/>:<List p={p}/>}
  </div>
 </div>;
}
