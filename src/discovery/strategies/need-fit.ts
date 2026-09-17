import type {Criterion} from '../../domain/core.ts';
import type {ObservationContext} from './restaurant.ts';
import {findLiteralMatch} from './text-match.ts';
// Same closed-key + user-authored-rules discipline as target-fit.ts / contact-channel.ts. Without a
// valid rules.type==='need_fit', the criterion behaves exactly as it always has.
export const NEED_FIT_KEYS=['need_fit','offer_need_fit','need_match'] as const;
export function findNeedFitCriterion(criteria:Criterion[]):Criterion|null{
 const keys=new Set<string>(NEED_FIT_KEYS);
 return criteria.find(c=>keys.has(c.key)&&c.rules?.type==='need_fit')??null;
}
export type NeedFitMatch={signal:string; line:string};
// The vocabulary comes EXCLUSIVELY from the user's own rules.config.signals — never the criterion's
// label, never the project's offer text, never a category, never a phone number, never
// commercial_signal, and never a bare GENERIC_KEYWORD_MATCH guess.
export function matchNeedFitSignal(ctx:Pick<ObservationContext,'lines'>,signals:string[]):NeedFitMatch|null{
 for(const signal of signals){
  const found=findLiteralMatch(ctx.lines,signal);
  if(found)return {signal,line:found.line};
 }
 return null;
}
