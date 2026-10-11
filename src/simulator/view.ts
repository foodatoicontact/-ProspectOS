// Public simulator V1 — what the visitor sees for each fictional prospect, computed ONLY with the product's existing
// pure rules: FIT = fitDisplay(estimateFit(...)), INTENT = scoreIntent(...), proofs = timelineView(...) split by status.
// No composite score, no probability, no confidence gauge, no opportunity score. The recommended angle is the one
// STORED with the fixture: it is resolved here (looked up), never selected.
import {SIM_MAX_PROSPECTS,type ScenarioId,type SimProspect,type SimScenario} from './types.ts';
import {getScenario} from './scenarios/index.ts';
import type {AngleType} from '../outreach/angle.ts';
import {estimateFit} from '../domain/fit-estimate.ts';
import {fitDisplay,type FitDisplay} from '../domain/score-display.ts';
import {scoreIntent} from '../domain/intent.ts';
import {heroView,reasonView,timelineView,type HeroView,type ReasonView,type TimelineItem} from '../ux/cockpit-view.ts';

// The proofs the factual template may quote: verified, supporting, in fixture order (O2's evidenceIds input).
export const verifiedEvidenceIds=(p:SimProspect)=>p.evidence.filter(e=>e.status==='VERIFIED'&&e.value).map(e=>e.id);

// Same wording rule as O2's label (src/outreach/angle.ts): whitespace collapsed, 120 characters at most.
const label=(s:string)=>{const t=s.replace(/\s+/g,' ').trim();return t.length<=120?t:`${t.slice(0,119)}…`};
const hostOf=(url:string|null)=>{if(!url)return null;try{return new URL(url).hostname}catch{return null}};
export type SimAngle={type:AngleType;label:string;source_host:string|null};
export function resolveAngle(p:SimProspect):SimAngle{
 const {type,source_id}=p.angle_ref;
 if(type==='signal'){const s=p.signals.find(x=>x.id===source_id);if(s)return {type,label:label(s.title),source_host:hostOf(s.source_url)}}
 if(type==='public_content'||type==='public_content_pinned'){const c=p.public_content.find(x=>x.id===source_id);if(c)return {type,label:label(c.content),source_host:hostOf(c.source_url)}}
 if(type==='evidence'){const e=p.evidence.find(x=>x.id===source_id);if(e)return {type,label:label(e.excerpt),source_host:hostOf(e.source_url)}}
 return {type:'generic',label:'',source_host:null};
}

export type SimProof=TimelineItem;
export type SimProspectView={
 id:string;name:string;fictional:true;domain:string;sector_label:string;size_label:string;
 hero:HeroView;fit:FitDisplay;coverage:number;reason:ReasonView;angle:SimAngle;
 verified:SimProof[];to_confirm:SimProof[];undocumented:string[];
};
export type SimView={scenario_id:ScenarioId;label:string;prospects:SimProspectView[]};

const DAY=86_400_000;
// Signals as they are: VERIFIED is verified, PENDING_REVIEW is to confirm, REJECTED is not shown.
function signalProofs(p:SimProspect,now:Date):SimProof[]{
 return p.signals.filter(g=>g.status!=='REJECTED').map(g=>{
  const day=g.event_date??(g.published_at??g.observed_at).slice(0,10);
  return {kind:'signal',id:g.id,title:g.title,detail:null,source:g.source_domain,date:day,age_days:Math.max(0,Math.floor((now.getTime()-Date.parse(`${day}T00:00:00Z`))/DAY)),status:g.status==='VERIFIED'?'verified':'to_confirm'};
 });
}
function prospectView(s:SimScenario,p:SimProspect):SimProspectView{
 const now=new Date(s.reference_date);
 const estimate=estimateFit(s.criteria,p.evidence,now);
 const intent=scoreIntent(p.signals,null,now);
 // Evidence and public content through the B timeline rules (supporting proofs only, contradicted / rejected left out).
 const content=p.public_content.flatMap(c=>c.status==='VERIFIED'||c.status==='PENDING_REVIEW'?[{...c,status:c.status as 'VERIFIED'|'PENDING_REVIEW',source_domain:c.source_domain??null}]:[]);
 const others=timelineView({now,intent:null,criteria:s.criteria,evidence:p.evidence,content}).items;
 const proofs=[...signalProofs(p,now),...others].sort((a,b)=>a.age_days-b.age_days||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
 return {
  id:p.id,name:p.name,fictional:true,domain:p.domain,sector_label:p.sector_label,size_label:p.size_label,
  hero:heroView(intent),fit:fitDisplay(estimate),coverage:estimate.verified.coverage,reason:reasonView(intent),angle:resolveAngle(p),
  verified:proofs.filter(x=>x.status==='verified'),to_confirm:proofs.filter(x=>x.status!=='verified'),
  undocumented:estimate.estimated.breakdown.filter(b=>b.state==='UNKNOWN').map(b=>b.label),
 };
}
export function simulateScenario(s:SimScenario):SimView{
 return {scenario_id:s.id,label:s.label,prospects:s.prospects.slice(0,SIM_MAX_PROSPECTS).map(p=>prospectView(s,p))};
}
export function simulate(id:ScenarioId):SimView{return simulateScenario(getScenario(id)??getScenario('generique')!)}
