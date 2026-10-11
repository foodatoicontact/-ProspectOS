'use client';
// UX A/B, variant B ("decision first") — presentation only. It reads data the page already holds and calls nothing:
// no fetch, no mutation, no score, no angle selection, no message generation, no lifecycle step (those stay in the shared
// message block of the page). « Pourquoi maintenant ? » shows the INTENT as the Signals panel computed it, statuses as they
// are; the angle is the one the server returned with the message, none before a generation. Copier n'est pas « contacté ».
import type {ReactNode} from 'react';
import type {IntentScore} from '../domain/intent';
import type {Angle} from '../outreach/angle';
import {whyNowView,angleView,nextStep} from '../ux/decision-view';
import {translate,type Locale,type TKey} from '../i18n';

export function ProspectDecisionSummary({intent,angle,whyNowSentence,hasDraft,draftStatus,locale}:{intent:IntentScore|null;angle:Angle|null;whyNowSentence:string|null;hasDraft:boolean;draftStatus:string;locale:Locale}){
 const tr=(key:TKey)=>translate(locale,key);
 const why=whyNowView(intent),a=angleView(angle),step=nextStep(hasDraft,draftStatus);
 return <section className="ux-decision" aria-labelledby="ux-decision-title">
  <h3 id="ux-decision-title" className="sr-only">{tr('ux.title')}</h3>
  <div className="ux-step">
   <p className="eyebrow">1 · {tr('ux.whyNow.title')}</p>
   {why.state==='loading'&&<p className="muted">{tr('ux.whyNow.loading')}</p>}
   {why.state==='verified'&&<><p><span className="pill verified">{tr('ux.whyNow.verified')}</span> <b>{why.title}</b></p>
    <p className="muted">{why.source_domain??''}{why.source_domain?' · ':''}{tr('ux.whyNow.age').replace('{n}',String(why.age_days))} · {tr('ux.whyNow.intent').replace('{n}',String(why.intent_score))}{why.count>1?` · ${tr('ux.whyNow.more').replace('{n}',String(why.count-1))}`:''}</p></>}
   {why.state==='to_confirm'&&<><p><span className="pill">{tr('ux.whyNow.toConfirm')}</span>{why.title?<> {why.title}</>:null}</p><p className="muted">{tr('ux.whyNow.toConfirmHint').replace('{n}',String(why.count))}</p></>}
   {why.state==='unknown'&&<p><span className="pill">{tr('ux.whyNow.unknown')}</span> <span className="muted">{tr('ux.whyNow.unknownHint')}</span></p>}
  </div>
  <div className="ux-step">
   <p className="eyebrow">2 · {tr('ux.angle.title')}</p>
   {a.state==='pending_generation'?<p className="muted">{tr('ux.angle.pending')}</p>:<>
    <p><b>{tr(`outreach.angle.${a.type}` as TKey)}</b></p>
    {a.label&&a.type!=='generic'&&<p className="muted">{a.label}</p>}
    {whyNowSentence&&<p className="muted">{whyNowSentence}</p>}
    {a.source_host&&<p className="muted">{tr('ux.angle.source')} : {a.source_host}</p>}
    <p className="muted">{tr('ux.angle.serverChosen')}</p>
   </>}
  </div>
  <div className="ux-step">
   <p className="eyebrow">3 · {tr('ux.message.title')}</p>
   <p className="muted">{tr(`ux.next.${step}` as TKey)}</p>
  </div>
 </section>;
}

// In B the proof panels become secondary justifications, grouped in one collapsed block; in A this renders its children
// exactly as they are (no wrapper element, the page is unchanged).
export function UxJustifications({variant,locale,children}:{variant:'A'|'B';locale:Locale;children:ReactNode}){
 if(variant!=='B')return <>{children}</>;
 return <details className="ux-justifications"><summary>{translate(locale,'ux.justifications.title')}</summary><p className="muted">{translate(locale,'ux.justifications.hint')}</p>{children}</details>;
}
