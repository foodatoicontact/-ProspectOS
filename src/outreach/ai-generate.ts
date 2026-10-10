// O1/O2 — one AI outreach attempt, end to end, with every dependency injected (the route wires Supabase, BYOK, the
// provider and the cost ledger). Order: availability (provider configured, BYOK usable) → reserve ONE unit (plan and
// hourly limits, database) → the composer (angle, verified sources, style profile, ≤ 5 of the same user's own edits,
// masked) → fact guard → the AI text, or the rule-based message of the SAME attempt (no second unit). Nothing possible
// before the reservation (not configured, BYOK broken, no unit) = no attempt, 0 unit, the rule-based message.
import {composeWithAi,type ComposerRequest} from './ai-composer.ts';
import {pickStyleExamples,type StyleExampleRow,type StyleProfile} from './style.ts';
import type {Composed} from './compose.ts';

export type AiUsage={provider:'anthropic'|'openai';model:string;input_tokens:number|null;output_tokens:number|null};
export type AiAvailability={ok:true;apiKeyOverride:string|null;billingSource:'PLATFORM'|'BYOK'}|{ok:false;reason:string};
export type AiGenerateDeps={
 userId:string;
 availability:()=>Promise<AiAvailability>;
 reserve:()=>Promise<string>;
 loadExampleRows:()=>Promise<StyleExampleRow[]>;
 // The provider call; on failure it may carry the real billed usage as `error.usage`.
 call:(req:ComposerRequest,apiKeyOverride:string|null)=>Promise<{text:string;usage:AiUsage|null}>;
 meter:(usage:AiUsage,billingSource:'PLATFORM'|'BYOK')=>Promise<void>;
 timeoutMs?:number;
};
export type AiGenerateInput={composed:Composed;name:string;offer:string;locale:'fr'|'en';style:StyleProfile|null;sources:string[];userId:string};
export type AiGenerateResult={text:string;provider:'ai_composer_v1'|'rule_based_v1'|'rule_based_fallback_v1';attempted:boolean;usage_id:string|null;
 outcome:'AI_VALID'|'FALLBACK'|null;fallback_reason:string|null;examples_used:number;evidence_ids:string[];signal_ids:string[];public_content_ids:string[]};

// The database refusal behind a reservation that failed (route errors wrap it as `cause`).
function reservationRefusal(e:unknown):string{
 const text=`${e instanceof Error?e.message:String(e)} ${String((e as {cause?:{message?:unknown}})?.cause?.message??'')}`;
 if(/ai_outreach_limit_reached/i.test(text))return 'AI_OUTREACH_LIMIT_REACHED';
 if(/ai_outreach_not_configured/i.test(text))return 'AI_OUTREACH_NOT_CONFIGURED';
 if(/ai_outreach_not_available/i.test(text))return 'AI_OUTREACH_NOT_AVAILABLE';
 if(/quota_exceeded/i.test(text))return 'QUOTA_EXCEEDED';
 return 'AI_QUOTA_UNAVAILABLE';
}
export async function generateOutreachWithAi(input:AiGenerateInput,deps:AiGenerateDeps):Promise<AiGenerateResult>{
 const c=input.composed;
 const base={evidence_ids:c.evidence_ids,signal_ids:c.signal_ids,public_content_ids:c.public_content_ids};
 const noAttempt=(reason:string):AiGenerateResult=>({...base,text:c.text,provider:'rule_based_v1',attempted:false,usage_id:null,outcome:null,fallback_reason:reason,examples_used:0});
 let available:AiAvailability;
 try{available=await deps.availability()}catch{return noAttempt('AI_NOT_CONFIGURED')}
 if(!available.ok)return noAttempt(available.reason);
 let usageId:string;
 try{usageId=await deps.reserve()}catch(e){return noAttempt(reservationRefusal(e))}
 // From here on the unit is spent: whatever happens, the attempt ends with an AI text or its own rule-based fallback.
 let rows:StyleExampleRow[]=[];try{rows=await deps.loadExampleRows()}catch{rows=[]}
 const examples=pickStyleExamples(rows,deps.userId);
 let usage:AiUsage|null=null;
 const call=async(req:ComposerRequest)=>{try{const r=await deps.call(req,available.ok?available.apiKeyOverride:null);usage=r.usage;return r.text}catch(e){usage=(e as {usage?:AiUsage|null})?.usage??null;throw e}};
 const result=await composeWithAi({name:input.name,offer:input.offer,locale:input.locale,angle:c.angle,sources:input.sources,style:input.style,examples,fallback:{text:c.text,...base}},call,deps.timeoutMs);
 // A billed provider answer is metered once, accepted or not; a call that never got an answer meters nothing.
 if(usage)try{await deps.meter(usage,available.billingSource)}catch{/* cost ledger is best-effort (usage.ts) */}
 const valid=result.provider==='ai_composer_v1';
 return {...base,text:result.text,provider:valid?'ai_composer_v1':'rule_based_fallback_v1',attempted:true,usage_id:usageId,outcome:valid?'AI_VALID':'FALLBACK',fallback_reason:valid?null:result.fallback_reason,examples_used:examples.length};
}
