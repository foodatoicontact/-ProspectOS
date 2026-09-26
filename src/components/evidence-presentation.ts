// What a person reads about an observation, derived from the stored row and the project's own ICP.
// Pure display: it never changes a status, never decides a criterion, never computes a score. Internal
// names (PHONE_RAW, GENERIC_KEYWORD_MATCH, UNKNOWN, INFERRED, ICP_SIGNAL:…) and the extraction confidence
// only ever appear under "Détails techniques", never as a title or a status.
import type {Criterion} from '../domain/core.ts';
import {safeLink} from '../domain/core.ts';
import type {StoredObservation} from '../discovery/types.ts';
import type {Locale} from '../i18n/locale.ts';
import {fr} from '../i18n/fr.ts';
import {en} from '../i18n/en.ts';
import {isContactChannelCriterion} from '../discovery/strategies/contact-channel.ts';
import {isCommercialSignalCriterion,COMMERCIAL_SIGNAL_TYPES} from '../discovery/strategies/commercial-signal.ts';
import {TARGET_FIT_KEYS} from '../discovery/strategies/target-fit.ts';
import {NEED_FIT_KEYS} from '../discovery/strategies/need-fit.ts';

type Key=keyof typeof fr;
const t=(locale:Locale,key:Key)=>(locale==='fr'?fr:en)[key];
// Same value as ICP_SIGNAL_PREFIX in discovery/strategies/icp-concepts.ts (server-only module, it
// imports node:crypto); tests/icp-evidence-mapping.test.ts keeps the two equal.
export const ICP_SIGNAL_TYPE_PREFIX='ICP_SIGNAL:';

export type StatusTone='pending'|'verified'|'contradicted'|'neutral';
export type EvidenceCard={
 row:StoredObservation;
 // proposal: a criterion of the ICP and a linked evidence a human can confirm/contradict (the only
 // kind that can ever reach the score, after confirmation); context: anything else that was found.
 kind:'proposal'|'context';
 title:string;
 subtitle:string|null;
 criterion:Criterion|null;
 statusLabel:string;
 tone:StatusTone;
 note:string|null;
 sourceText:string;
 sourceHref:string|null;
 anchorId:string|null;
 technical:{type:string;confidencePct:number;sourceType:string;collectedAt:string;expiresAt:string};
};
// One block per ICP criterion: every proposal of that criterion, each still reviewable on its own row.
export type CriterionGroup={criterion:Criterion;anchorId:string;cards:EvidenceCard[];tone:StatusTone;statusLabel:string;pending:number;verified:number};
// What the "Pourquoi cet établissement ?" section reads — derived from the very groups displayed below it,
// never from a second, separately loaded list. linkedEvidenceIds covers every row of a group (duplicate
// copies included) so the section never re-lists them as manual evidence.
export type CriterionReviewSummary={anchorId:string;pending:number;total:number;tone:StatusTone;statusLabel:string;excerpts:{text:string;statusLabel:string}[]};
export type ReviewSummary={criteria:Record<string,CriterionReviewSummary>;linkedEvidenceIds:string[];contextEvidenceIds:string[]};
// contextEvidenceIds: evidences linked to rows shown as context only — the ICP section must not list them
// under a criterion either (unless a human already verified them).
export type EvidencePresentation={proposals:EvidenceCard[];groups:CriterionGroup[];others:EvidenceCard[];missing:string[];contextEvidenceIds:string[];summary:ReviewSummary};

const normalizeExcerpt=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const SOURCE_TYPE_KEYS:Record<string,Key>={official_website:'evidence.sourceOfficial',search_result:'evidence.sourceSearch',public_directory:'evidence.sourceDirectory',test_fixture:'evidence.sourceFixture'};

export const evidenceAnchorId=(evidenceId:string)=>`evidence-review-${evidenceId}`;
export const criterionAnchorId=(key:string)=>`criterion-review-${key.replace(/[^A-Za-z0-9_-]/g,'-')}`;

// Which criterion each extraction rule is allowed to speak for. A stored criterion is only trusted when the
// rule that produced the row explicitly maps to it — never by position, order or "first criterion" — so a
// row written by an older engine (e.g. a phone number attached to a default key the user relabeled
// "Amplitude horaire étendue") is shown as context, never as a proof of that criterion.
const RULE_KEYS:Record<string,readonly string[]>={
 TARGET_FIT_RULE_MATCH:TARGET_FIT_KEYS,NEED_FIT_SIGNAL_MATCH:NEED_FIT_KEYS,
 // Restaurant preset (strategies/restaurant.ts): one fixed criterion key per rule.
 FOOD_ACTIVITY:['food'],GEOGRAPHY:['region'],PHONE_ORDERING:['phone_orders'],SOCIAL_ORDERING:['social_orders'],
 DELIVERY_PLATFORM:['platforms'],CLICK_AND_COLLECT:['weak_collect'],INTERNAL_DELIVERY:['internal_delivery'],
};
export function isExplicitlyMapped(o:StoredObservation,criterion:Criterion|null):boolean{
 if(!criterion||o.criterion!==criterion.key)return false;
 const type=o.observation_type;
 if(type.startsWith(ICP_SIGNAL_TYPE_PREFIX))return type===ICP_SIGNAL_TYPE_PREFIX+criterion.key||(ICP_SIGNAL_TYPE_PREFIX+criterion.key).length>60;
 if(type==='PHONE_RAW')return isContactChannelCriterion(criterion);
 if((COMMERCIAL_SIGNAL_TYPES as readonly string[]).includes(type))return isCommercialSignalCriterion(criterion);
 return RULE_KEYS[type]?.includes(criterion.key)??false; // GENERIC_KEYWORD_MATCH, UNKNOWN, unknown types: never
}
// Mirrors the conditions review_discovery_observation requires to confirm (status, value, evidence,
// excerpt), a criterion still part of the current ICP, and an explicit rule -> criterion mapping.
export function isReviewable(o:StoredObservation,criteria:Criterion[]):boolean{
 const criterion=o.criterion?criteria.find(c=>c.key===o.criterion)??null:null;
 return !!o.evidence_id&&o.value!==null&&o.status!=='UNKNOWN'&&!!o.source_excerpt.trim()&&isExplicitlyMapped(o,criterion);
}

export function humanStatus(o:StoredObservation,reviewable:boolean,locale:Locale):{label:string;tone:StatusTone}{
 if(o.review_status==='VERIFIED')return {label:t(locale,'evidence.statusVerified'),tone:'verified'};
 if(o.review_status==='CONTRADICTED')return {label:t(locale,'evidence.statusContradicted'),tone:'contradicted'};
 if(o.status==='UNKNOWN')return {label:t(locale,'evidence.statusToExamine'),tone:'neutral'};
 if(reviewable&&o.status==='INFERRED')return {label:t(locale,'evidence.statusToConfirm'),tone:'pending'};
 if(o.status==='INFERRED')return {label:t(locale,'evidence.statusToExamine'),tone:'neutral'};
 return {label:t(locale,'evidence.statusObservedUnverified'),tone:reviewable?'pending':'neutral'};
}

function sourceOf(o:StoredObservation,locale:Locale):{text:string;href:string|null}{
 const href=safeLink(o.source_url);
 let host:string|null=null;try{host=href?new URL(href).hostname.replace(/^www\./,''):null}catch{/* unparseable: no host */}
 const name=o.source_title.trim()||host||o.source_url;
 const kind=SOURCE_TYPE_KEYS[o.source_type];
 return {text:kind?`${name} — ${t(locale,kind)}`:name,href};
}

export function presentObservation(o:StoredObservation,criteria:Criterion[],locale:Locale):EvidenceCard{
 const reviewable=isReviewable(o,criteria);
 const criterion=o.criterion?criteria.find(c=>c.key===o.criterion)??null:null;
 const status=humanStatus(o,reviewable,locale);
 const isPhone=o.observation_type==='PHONE_RAW';
 const isKeyword=o.observation_type==='GENERIC_KEYWORD_MATCH';
 let title:string;let subtitle:string|null=null;let note:string|null=null;
 if(reviewable&&criterion){title=criterion.label;subtitle=isPhone?t(locale,'evidence.titlePhone'):null}
 else if(isPhone){title=t(locale,'evidence.titlePhone');note=t(locale,'evidence.contextNote')}
 else if(isKeyword){title=t(locale,'evidence.titleKeyword');subtitle=criterion?`${t(locale,'evidence.possibleCriterion')} ${criterion.label}`:null;note=t(locale,'evidence.keywordNote')}
 else if(o.status==='UNKNOWN'){title=t(locale,'evidence.titleUnknown')}
 else {title=t(locale,'evidence.titleGeneric');if(!o.evidence_id)note=t(locale,'evidence.contextNote')}
 const source=sourceOf(o,locale);
 return {row:o,kind:reviewable&&criterion?'proposal':'context',title,subtitle,criterion:reviewable?criterion:null,statusLabel:status.label,tone:status.tone,note,
  sourceText:source.text,sourceHref:source.href,anchorId:reviewable&&o.evidence_id?evidenceAnchorId(o.evidence_id):null,
  technical:{type:o.observation_type,confidencePct:Math.round(o.confidence*100),sourceType:o.source_type,collectedAt:o.collected_at,expiresAt:o.expires_at}};
}

// Display order when the same sentence was stored more than once (several analyses, several pages): the
// row a human already decided on wins, then the one that can still be reviewed, then the most recent.
const REVIEW_RANK:Record<string,number>={VERIFIED:0,CONTRADICTED:1,NOT_VERIFIED:2};
function preferred(a:StoredObservation,b:StoredObservation,criteria:Criterion[]):StoredObservation{
 const ra=REVIEW_RANK[a.review_status]??3,rb=REVIEW_RANK[b.review_status]??3;if(ra!==rb)return ra<rb?a:b;
 const va=isReviewable(a,criteria),vb=isReviewable(b,criteria);if(va!==vb)return va?a:b;
 return a.collected_at>=b.collected_at?a:b;
}

export function presentObservations(rows:StoredObservation[],criteria:Criterion[],locale:Locale):EvidencePresentation{
 const informative=rows.filter(o=>o.status!=='UNKNOWN');
 const byKey=new Map<string,StoredObservation>();
 for(const o of informative){
  const k=`${o.criterion??o.observation_type}|${normalizeExcerpt(o.source_excerpt)}`;
  const seen=byKey.get(k);byKey.set(k,seen?preferred(seen,o,criteria):o);
 }
 const order=(c:Criterion|null)=>c?criteria.indexOf(c):criteria.length;
 const toneRank:Record<StatusTone,number>={pending:0,verified:1,contradicted:2,neutral:3};
 const cards=[...byKey.values()].map(o=>presentObservation(o,criteria,locale));
 const proposals=cards.filter(c=>c.kind==='proposal').sort((a,b)=>order(a.criterion)-order(b.criterion)||toneRank[a.tone]-toneRank[b.tone]);
 const others=cards.filter(c=>c.kind==='context');
 // Once something was analyzed, a criterion is listed as "not found" when no row informs it. Derived from
 // the ICP rather than from the UNKNOWN rows, which share one storage key per page (only the last one
 // of a page is kept) and so cannot list every missing criterion.
 const informed=new Set(informative.filter(o=>isReviewable(o,criteria)).map(o=>o.criterion));
 const missing=rows.length?criteria.filter(c=>!informed.has(c.key)).map(c=>c.label):[];
 // Every row, not only the displayed one of a duplicate group: a hidden copy must not surface either.
 const contextEvidenceIds=rows.filter(o=>o.evidence_id&&!isReviewable(o,criteria)).map(o=>o.evidence_id!);
 // Group the proposals by criterion (ICP order): a block's state is pending as soon as one proof still
 // waits for a human, verified when one was confirmed and none waits, contradicted otherwise. Display only.
 const groups:CriterionGroup[]=[];
 for(const c of proposals){
  const g=groups.find(x=>x.criterion.key===c.criterion!.key);
  if(g)g.cards.push(c);else groups.push({criterion:c.criterion!,anchorId:criterionAnchorId(c.criterion!.key),cards:[c],tone:'pending',statusLabel:'',pending:0,verified:0});
 }
 for(const g of groups){
  g.pending=g.cards.filter(c=>c.tone==='pending').length;g.verified=g.cards.filter(c=>c.tone==='verified').length;
  g.tone=g.pending?'pending':g.verified?'verified':'contradicted';
  g.statusLabel=t(locale,g.tone==='pending'?'evidence.statusToConfirm':g.tone==='verified'?'evidence.statusVerified':'evidence.statusContradicted');
 }
 const linkedEvidenceIds=rows.filter(o=>o.evidence_id&&isReviewable(o,criteria)).map(o=>o.evidence_id!);
 const summary:ReviewSummary={criteria:Object.fromEntries(groups.map(g=>[g.criterion.key,{anchorId:g.anchorId,pending:g.pending,total:g.cards.length,tone:g.tone,statusLabel:g.statusLabel,
  excerpts:g.cards.map(c=>({text:c.row.source_excerpt,statusLabel:c.statusLabel}))}])),linkedEvidenceIds,contextEvidenceIds};
 return {proposals,groups,others,missing,contextEvidenceIds,summary};
}
