// UX A/B, variant B ("decision first") — a pure view of data the page already holds. Nothing is fetched, scored or
// selected here: the INTENT comes from the Signals panel (scoreIntent, unchanged), the angle from the server with the
// generated message (selectAngle never runs on the client), the step from the O1 message status.
import type {IntentScore} from '../domain/intent.ts';
import type {Angle,AngleType} from '../outreach/angle.ts';

export type WhyNowView={state:'loading'}|{state:'unknown'}
 |{state:'verified';signal_id:string;title:string;source_domain:string|null;age_days:number;intent_score:number;count:number}
 |{state:'to_confirm';count:number;title:string|null};
// 1 — Pourquoi maintenant ? A VERIFIED signal that still counts (points > 0) is a reason now; a signal still to review is
// only "to confirm"; an archived one (0 point) is no reason now. A status is never upgraded.
export function whyNowView(intent:IntentScore|null):WhyNowView{
 if(!intent)return {state:'loading'};
 const counting=intent.lines.filter(l=>l.verified&&l.points>0);
 if(counting.length){
  const top=[...counting].sort((a,b)=>b.points-a.points||a.signal_id.localeCompare(b.signal_id))[0];
  return {state:'verified',signal_id:top.signal_id,title:top.title,source_domain:top.source_domain,age_days:top.age_days,intent_score:intent.score,count:counting.length};
 }
 const toReview=intent.estimated.lines.filter(l=>!l.verified&&l.points>0).sort((a,b)=>b.points-a.points);
 if(intent.pending.count>0||toReview.length)return {state:'to_confirm',count:Math.max(intent.pending.count,toReview.length),title:toReview[0]?.title??null};
 return {state:'unknown'};
}

export type AngleView={state:'pending_generation'}|{state:'ready';type:AngleType;label:string;source_host:string|null};
const hostOf=(url:string|null)=>{if(!url)return null;try{const u=new URL(url);return u.protocol==='https:'||u.protocol==='http:'?u.hostname:null}catch{return null}};
// 2 — Angle recommandé: exactly the angle the server chose and stored with the message; none before a generation.
export function angleView(angle:Angle|null):AngleView{
 if(!angle)return {state:'pending_generation'};
 return {state:'ready',type:angle.type,label:angle.label,source_host:hostOf(angle.source_url)};
}

export type NextStep='generate'|'review_and_approve'|'copy'|'done';
// 3 — the next step of the existing O1 workflow (DRAFT → APPROVED → USED). USED means copied — never "contacted".
export function nextStep(hasDraft:boolean,status:string):NextStep{
 if(!hasDraft||status==='DISCARDED')return 'generate';
 return status==='APPROVED'?'copy':status==='USED'?'done':'review_and_approve';
}
