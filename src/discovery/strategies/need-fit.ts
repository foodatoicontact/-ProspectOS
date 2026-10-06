import type {Criterion} from '../../domain/core.ts';
import type {ObservationContext} from './restaurant.ts';
import {findConceptMatch,isMeaningfulTerm} from './text-match.ts';
import {findTermMatches,assessMatch,type RejectCode} from './match-context.ts';
// Same closed-key + user-authored-rules discipline as target-fit.ts / contact-channel.ts. Without a
// valid rules.type==='need_fit', the criterion behaves exactly as it always has.
export const NEED_FIT_KEYS=['need_fit','offer_need_fit','need_match'] as const;
export function findNeedFitCriterion(criteria:Criterion[]):Criterion|null{
 const keys=new Set<string>(NEED_FIT_KEYS);
 return criteria.find(c=>keys.has(c.key)&&c.rules?.type==='need_fit')??null;
}
export type NeedFitMatch={signal:string; line:string};
function isStringArray(value:unknown):value is string[]{return Array.isArray(value)&&value.every(v=>typeof v==='string')}
// The vocabulary comes EXCLUSIVELY from the user's own rules.config.signals — never the criterion's
// label, never the project's offer text, never a category, never a phone number, never
// commercial_signal, and never a bare GENERIC_KEYWORD_MATCH guess. `signals` is read from a
// schema-less jsonb column writable outside this application's own Zod validation (e.g. directly via
// PostgREST), so its declared TypeScript type is never trusted at runtime: anything short of a real
// array of strings is "no exploitable rule" — never repaired, never partially used.
export type NeedFitRejection={signal:string; line:string; code:RejectCode};
// The best sentence of the page for any of the user's signals (match-context.ts): the signal as written, in its
// compound or inflected forms, or (multi-word) every content word conjugated in one sentence — then judged in
// context: a menu, a short title, legal text, a quotation or a general article is never a need.
export function evaluateNeedFit(ctx:Pick<ObservationContext,'lines'>,signals:unknown):{match:NeedFitMatch|null;rejected:NeedFitRejection[]}{
 if(!isStringArray(signals))return {match:null,rejected:[]};
 const rejected:NeedFitRejection[]=[];
 for(const signal of signals){
  // A grammatical word or a discourse marker ("idéalement") is never a need. A multi-word signal written as a
  // phrase ("recrutent un RSSI") also matches the same words conjugated in one sentence — never one word alone.
  if(!isMeaningfulTerm(signal))continue;
  for(const line of ctx.lines){
   const found=findTermMatches([line],signal)[0]??(findConceptMatch([line],signal)?{line,index:undefined}:null);
   if(!found)continue;
   const a=assessMatch(line,signal,'need',found.index);
   if(a.accepted)return {match:{signal,line},rejected};
   rejected.push({signal,line,code:a.code});
  }
 }
 return {match:null,rejected};
}
export function matchNeedFitSignal(ctx:Pick<ObservationContext,'lines'>,signals:unknown):NeedFitMatch|null{return evaluateNeedFit(ctx,signals).match}
