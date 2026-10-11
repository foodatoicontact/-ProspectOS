'use client';
// UX A/B, variant B "Workflow-first" (Figma: B — REIMAGINED, a decision cockpit) — presentation only. It reads data the
// page already holds and calls nothing: no fetch, no mutation, no score, no angle selection, no message generation, no
// lifecycle step (those stay in the page's one message block, which B shows as the Next best action card).
// Hero: why now, from the strongest verified signal as it is (or an explicit neutral state). Decision stack: the existing
// FIT and the existing verified INTENT. Timeline: signals, ICP evidence and public content with their own statuses.
// The mockup's conceptual metrics (overall "86" score, certainty gauge) have no ProspectOS source: they are omitted.
// The angle is the one the server returned with the message, none before a generation. Copier n'est pas « contacté ».
import {useState,type ReactNode} from 'react';
import type {IntentScore} from '../domain/intent';
import type {Angle} from '../outreach/angle';
import type {FitDisplay} from '../domain/score-display';
import {angleView,nextStep} from '../ux/decision-view';
import {heroView,reasonView,type TimelineItem} from '../ux/cockpit-view';
import {translate,type Locale,type TKey} from '../i18n';

const t=(locale:Locale)=>(key:TKey)=>translate(locale,key);

export function DecisionHero({intent,locale}:{intent:IntentScore|null;locale:Locale}){
 const tr=t(locale),h=heroView(intent);
 // The big card is kept for a real verified trigger; without one, the same exact information in a compact card.
 return <section className={`ux-hero ux-hero-${h.state}${h.state==='verified'?'':' ux-hero-compact'}`} aria-labelledby="ux-hero-title">
  <p className="eyebrow" id="ux-hero-title">{tr('ux.whyNow.title')}</p>
  {h.state==='loading'&&<p className="ux-hero-line muted">{tr('ux.whyNow.loading')}</p>}
  {h.state==='verified'&&<>
   <p className="ux-badges"><span className="ux-badge">{tr(`signals.type.${h.signal_type}` as TKey)}</span><span className="pill verified">{tr('ux.status.verified')}</span></p>
   <p className="ux-hero-line">{h.title}</p>
   <p className="muted">{h.source_domain??''}{h.source_domain?' · ':''}{tr('ux.whyNow.age').replace('{n}',String(h.age_days))}{h.count>1?` · ${tr('ux.whyNow.more').replace('{n}',String(h.count-1))}`:''}</p>
  </>}
  {h.state==='to_confirm'&&<>
   <p className="ux-badges"><span className="pill">{tr('ux.status.to_confirm')}</span></p>
   <p className="ux-hero-line">{tr('ux.hero.toConfirm').replace('{n}',String(h.count))}</p>
   {h.title&&<p className="muted">{h.title}</p>}
  </>}
  {h.state==='none'&&<>
   <p className="ux-badges"><span className="pill">{tr('ux.status.unknown')}</span></p>
   <p className="ux-hero-line">{tr('ux.hero.none')}</p>
  </>}
 </section>;
}

// Right column: only metrics ProspectOS really has — FIT (estimateFit, unchanged) and the verified INTENT.
export function DecisionStack({fit,coverage,intent,locale}:{fit:FitDisplay;coverage:number;intent:IntentScore|null;locale:Locale}){
 const tr=t(locale),r=reasonView(intent);
 return <div className="ux-stack">
  <section className="ux-card ux-fit" aria-label={tr('ux.fit.title')}>
   <p className="eyebrow">{tr('ux.fit.title')}</p>
   <p className="ux-metric"><b>{fit.main??'—'}</b><small>{fit.kind==='none'?tr('score.notScored'):fit.kind==='estimated'?`/100 · ${tr('score.estimated')}`:'/100'}</small></p>
   {fit.kind==='estimated'&&<p className="muted">{fit.verified!==null?`${tr('score.verifiedPart').replace('{n}',String(fit.verified))} · `:''}{tr('score.toVerify').replace('{n}',String(fit.toVerify)).replace('{p}',String(fit.toVerifyPoints))}</p>}
   <p className="muted">{tr('detail.coverageShort')} : {coverage}%</p>
  </section>
  <section className="ux-card ux-reason" aria-label={tr('ux.reason.title')}>
   <p className="eyebrow">{tr('ux.reason.title')}</p>
   {r.state==='loading'?<p className="muted">{tr('ux.whyNow.loading')}</p>:<>
    <p className="ux-metric"><b>{r.score??'—'}</b>{r.score!==null&&<small>{tr('ux.reason.verifiedIntent')}</small>}</p>
    <p className="muted">{tr('ux.reason.counts').replace('{v}',String(r.verified)).replace('{c}',String(r.to_confirm))}</p>
   </>}
  </section>
 </div>;
}

// Head of the Next best action card, inside the page's one message block: the server's angle, then the next O1 step.
export function NextBestActionHead({angle,whyNowSentence,hasDraft,draftStatus,locale}:{angle:Angle|null;whyNowSentence:string|null;hasDraft:boolean;draftStatus:string;locale:Locale}){
 const tr=t(locale),a=angleView(angle),step=nextStep(hasDraft,draftStatus);
 return <div className="ux-nba-head">
  <p className="eyebrow">{tr('ux.nba.title')}</p>
  <div className="ux-nba-angle">
   <p className="ux-nba-label">{tr('ux.angle.title')}</p>
   {a.state==='pending_generation'?<p className="muted">{tr('ux.angle.pending')}</p>:<>
    <p><b>{tr(`outreach.angle.${a.type}` as TKey)}</b>{a.label&&a.type!=='generic'?<span className="muted"> · {a.label}</span>:null}</p>
    {whyNowSentence&&<p className="muted">{whyNowSentence}</p>}
    {a.source_host&&<p className="muted">{tr('ux.angle.source')} : {a.source_host}</p>}
   </>}
  </div>
  <p className="ux-nba-step">{tr(`ux.next.${step}` as TKey)}</p>
 </div>;
}

// Folded by default: the most recent items first (3 on a phone, 6 on a wide detail), then "Voir les X autres preuves".
// Every item stays in the page; CSS only hides the folded rows until the list is unfolded.
const TL_PHONE=3,TL_WIDE=6;
export function EvidenceTimeline({items,more,locale}:{items:TimelineItem[];more:number;locale:Locale}){
 const tr=t(locale),dateLocale=locale==='fr'?'fr-FR':'en-US';
 const [open,setOpen]=useState(false);
 const extra=(n:number)=>Math.max(0,items.length-n);
 const toggle=(n:number,cls:string)=>extra(n)>0&&<button type="button" className={`text-button ux-tl-toggle ${cls}`} aria-expanded={open} aria-controls="ux-timeline-list" onClick={()=>setOpen(o=>!o)}>{open?tr('ux.timeline.showLess'):extra(n)===1?tr('ux.timeline.showOne'):tr('ux.timeline.showMore').replace('{n}',String(extra(n)))}</button>;
 return <section className={`ux-card ux-timeline${open?' open':''}`} aria-labelledby="ux-timeline-title">
  <h3 id="ux-timeline-title">{tr('ux.timeline.title')}</h3>
  {!items.length?<p className="muted">{tr('ux.timeline.empty')}</p>:<ol id="ux-timeline-list">{items.map((i,n)=><li key={`${i.kind}:${i.id}`} className={`ux-tl-${i.status}${n>=TL_PHONE?' ux-tl-extra-phone':''}${n>=TL_WIDE?' ux-tl-extra-wide':''}`}>
   <span className="ux-tl-when">{i.date?new Date(`${i.date}T12:00:00Z`).toLocaleDateString(dateLocale,{day:'numeric',month:'short'}):tr('ux.whyNow.age').replace('{n}',String(i.age_days))}</span>
   <div><p><span className="ux-tl-kind">{tr(`ux.timeline.kind.${i.kind}` as TKey)}</span> {i.title}</p>
    {i.detail&&<p className="muted">{i.detail}</p>}
    <p className="muted">{i.source?`${i.source} · `:''}<span className={`ux-status ux-status-${i.status}`}>{tr(`ux.status.${i.status}` as TKey)}</span></p></div>
  </li>)}</ol>}
  {toggle(TL_PHONE,'ux-tl-toggle-phone')}{toggle(TL_WIDE,'ux-tl-toggle-wide')}
  {more>0&&<p className="muted">{tr('ux.timeline.more').replace('{n}',String(more))}</p>}
 </section>;
}

// In B the proof panels become secondary justifications, grouped in one collapsed block; in A this renders its children
// exactly as they are (no wrapper element, the page is unchanged).
export function UxJustifications({variant,locale,children}:{variant:'A'|'B';locale:Locale;children:ReactNode}){
 if(variant!=='B')return <>{children}</>;
 return <details className="ux-justifications"><summary>{translate(locale,'ux.justifications.title')}</summary><p className="muted">{translate(locale,'ux.justifications.hint')}</p>{children}</details>;
}
