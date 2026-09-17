import type {Observation} from '../types.ts';
import type {Criterion} from '../../domain/core.ts';
import type {ObservationContext} from './restaurant.ts';
import {findContactChannelCriterion} from './contact-channel.ts';
import {findCommercialSignalCriterion,matchCommercialSignal} from './commercial-signal.ts';
import {findTargetFitCriterion,evaluateTargetFit,TARGET_FIT_DIMENSION_LABELS} from './target-fit.ts';
import {findNeedFitCriterion,matchNeedFitSignal} from './need-fit.ts';
// Sector-agnostic extraction: works from the project's own ICP labels instead of any hardcoded vertical.
// A criterion never seen at compile time can still receive a proposal as long as it exists in the ICP passed in.
const STOPWORDS=new Set(['dans','pour','avec','sans','plus','votre','vos','vous','notre','nos','nous','cette','ces','sont','être','avoir','leur','leurs','qui','que','dont','tout','tous','toute','toutes','fait','faire','très','bien','aussi','donc','ainsi','comme','the','and','for','with','this','that','from','your','have']);
function significantWords(label:string):string[]{return label.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>=4&&!STOPWORDS.has(w))}
const PHONE_PATTERN=/(?:\+33\s*(?:\(0\)\s*)?|0)[1-9](?:[ .-]?\d{2}){4}/;
export function extractGenericObservations(ctx:ObservationContext,criteria:Criterion[],covered:Set<string>):Observation[]{
 const {lines,text,make}=ctx;const out:Observation[]=[];
 // Cross-sector raw contact signal — a phone number is not tied to any vertical. It is only ever
 // attached to a real criterion for the one concept it deterministically proves: a documented contact
 // channel (see findContactChannelCriterion). Any other criterion never receives a value from a bare
 // phone number — that would be exactly the hazardous "any phone -> any criterion" shortcut this
 // module must avoid. When the ICP defines no such criterion, the phone stays a contextual note.
 const phone=text.match(PHONE_PATTERN)?.[0];
 const contactCriterion=phone?findContactChannelCriterion(criteria):null;
 const attachPhoneTo=contactCriterion&&!covered.has(contactCriterion.key)?contactCriterion:null;
 if(phone){
  if(attachPhoneTo)out.push(make(attachPhoneTo.key,'PHONE_RAW',phone,true,'OBSERVED','Numéro de téléphone professionnel public documenté',.8));
  else out.push(make(null,'PHONE_RAW',phone,null,'OBSERVED','Numéro public présent ; usage commercial non déduit',.95));
 }
 // Same closed-vocabulary + explicit-phrase discipline as the phone rule above, for the other
 // self-contained, cross-sector concept this engine can prove deterministically: an explicit
 // commercial/growth event (recruiting, opening, launch, tender, expansion). Existence of a website,
 // a phone number, or the company itself is never enough — only a concrete, named event is.
 const signalCriterion=findCommercialSignalCriterion(criteria);
 const signalMatch=signalCriterion&&!covered.has(signalCriterion.key)?matchCommercialSignal(ctx):null;
 const attachSignalTo=signalMatch?signalCriterion:null;
 if(attachSignalTo&&signalMatch)out.push(make(attachSignalTo.key,signalMatch.type,signalMatch.line,true,'OBSERVED',signalMatch.claim,.75));
 // target_fit: the ICP's OWN user-authored rules are the sole vocabulary — never the label, never a
 // per-sector guess. Unsatisfied rules never produce value:false; the criterion simply falls through
 // to the ordinary loop below (INFERRED/UNKNOWN), exactly as an ICP without any rules always has.
 const targetFitCriterion=findTargetFitCriterion(criteria);
 const targetFitEvaluation=targetFitCriterion&&!covered.has(targetFitCriterion.key)&&targetFitCriterion.rules?.type==='target_fit'?evaluateTargetFit(ctx,targetFitCriterion.rules.config):null;
 const attachTargetFitTo=targetFitEvaluation?.satisfied?targetFitCriterion:null;
 if(attachTargetFitTo&&targetFitEvaluation){
  const claim=targetFitEvaluation.matches.map(m=>`${TARGET_FIT_DIMENSION_LABELS[m.dimension]} correspond à « ${m.matchedValue} »`).join(' ; ');
  out.push(make(attachTargetFitTo.key,'TARGET_FIT_RULE_MATCH',targetFitEvaluation.matches[0].line,true,'OBSERVED',`Règle ICP explicite satisfaite : ${claim}`,.85));
 }
 // need_fit: same discipline — the vocabulary is exclusively the user's own rules.config.signals.
 const needFitCriterion=findNeedFitCriterion(criteria);
 const needFitMatch=needFitCriterion&&!covered.has(needFitCriterion.key)&&needFitCriterion.rules?.type==='need_fit'?matchNeedFitSignal(ctx,needFitCriterion.rules.config.signals):null;
 const attachNeedFitTo=needFitMatch?needFitCriterion:null;
 if(attachNeedFitTo&&needFitMatch)out.push(make(attachNeedFitTo.key,'NEED_FIT_SIGNAL_MATCH',needFitMatch.line,true,'OBSERVED',`Signal de besoin défini par l'utilisateur explicitement observé : « ${needFitMatch.signal} »`,.8));
 for(const criterion of criteria){
  if(covered.has(criterion.key))continue; // already handled by a specialized preset for this ICP
  if(attachPhoneTo&&criterion.key===attachPhoneTo.key)continue; // already given a stronger, deterministic signal above — no redundant/weaker guess
  if(attachSignalTo&&criterion.key===attachSignalTo.key)continue; // idem, for the explicit commercial-signal rule above
  if(attachTargetFitTo&&criterion.key===attachTargetFitTo.key)continue; // idem, for the explicit target_fit rule above
  if(attachNeedFitTo&&criterion.key===attachNeedFitTo.key)continue; // idem, for the explicit need_fit rule above
  const words=significantWords(criterion.label);if(!words.length)continue;
  const line=lines.find(l=>{const normalized=' '+l.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()+' ';return words.some(w=>normalized.includes(' '+w))});
  // A bare keyword overlap is a candidate excerpt, never a determination: no deterministic rule
  // established that the criterion is actually satisfied, so this can never resolve to TRUE/FALSE
  // on its own — status INFERRED with value null keeps it out of EvidenceProposalService until a
  // human confirms it (value===null is filtered out there).
  if(line){const matched=words.filter(w=>(' '+line.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()+' ').includes(' '+w)).length;const confidence=Math.min(.4,.15+.05*matched);
  out.push(make(criterion.key,'GENERIC_KEYWORD_MATCH',line,null,'INFERRED','Extrait potentiellement pertinent — correspondance avec le critère à confirmer',confidence))}
 }
 return out;
}
