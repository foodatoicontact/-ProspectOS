// ICP import — the output budget of one extraction call (docs/ICP_IMPORT.md §Budget de sortie). The answer must fit in
// ICP_MAX_TOKENS (src/server/ai.ts) or it is cut and refused (AI_TRUNCATED_RESULT). max_tokens is not raised: 4 096
// output tokens already take about 29 s, and the route has 60 s, a retry included. So the profile filled to EVERY
// bound of ICP_LIMITS — every list full, every text and every source at its maximum length — must stay under
// ICP_OUTPUT_BUDGET_TOKENS, which leaves a margin under max_tokens for what the estimate does not see.
//
// Token estimate: compact JSON characters ÷ CHARS_PER_TOKEN. Calibration (4 Nov. 2026, claude-sonnet-5, French):
//  - the valid profile of smoke test #1 is 7 064 characters as compact JSON; the public @anthropic-ai/tokenizer (an
//    older Claude vocabulary) counts 2 035 tokens, i.e. 3.47 characters per token;
//  - on the real input of smoke test #3 (system prompt + document) that tokenizer counts 3 891 tokens where the API
//    billed about 5 423: the current vocabulary costs ×1.39 on this kind of text;
//  - 3.47 ÷ 1.39 ≈ 2.5 characters per token for compact profile JSON; 2.4 is used, rounding toward more tokens.
// Cross-check: the same profile, indented, is 9 181 characters ≈ 4 050 tokens — close to the 7 140 output tokens
// billed for the two answers of smoke test #1. The prompt therefore asks for compact JSON, on one line.
import {ICP_LIMITS,type IcpProfile} from './schema.ts';

export const CHARS_PER_TOKEN=2.4;
export const ICP_OUTPUT_BUDGET_TOKENS=3000;

export const estimateOutputTokens=(value:unknown)=>Math.ceil(JSON.stringify(value).length/CHARS_PER_TOKEN);

// The largest profile the schema accepts: every list at its bound, every text at its maximum length, every source at
// SOURCE_MAX, the longest enum values and confidence written with two decimals.
export function largestProfile(L:typeof ICP_LIMITS=ICP_LIMITS):IcpProfile{
 const t=(n:number)=>'é'.repeat(n);
 const leaf=<T>(value:T)=>({value,source:t(L.source),confidence:0.85});
 const n=<T>(count:number,make:(i:number)=>T)=>Array.from({length:count},(_,i)=>make(i));
 const key=(i:number)=>`${String(i)}${'k'.repeat(L.segmentKey-String(i).length)}`;
 return {
  version:1,
  company:{name:leaf(t(L.name)),activity:leaf(t(L.activity)),
   sites:n(L.sites,()=>leaf({city:t(L.city),department:'2A',role:'PARTNER' as const})),
   interventionZones:n(L.zones,()=>leaf('974')),coverage:leaf('REGIONAL' as const)},
  offer:{services:n(L.services,()=>leaf(t(L.service))),
   promises:n(L.promises,()=>leaf({text:t(L.promise),value:9999,unit:t(L.unit)})),
   differentiators:n(L.differentiators,()=>leaf(t(L.differentiator))),proofs:n(L.proofs,()=>leaf(t(L.proof)))},
  segments:n(L.segments,i=>({key:key(i),label:leaf(t(L.segmentLabel)),apeCodes:n(L.apeCodes,()=>leaf('12.34A')),
   sizeRange:leaf(n(L.sizeBands,()=>'53')),priority:leaf(3 as const),estimatedValue:leaf('MEDIUM' as const),salesCycle:leaf(t(L.salesCycle))})),
  personas:n(L.personas,()=>({role:leaf(t(L.role)),painPoints:n(L.painPoints,()=>leaf(t(L.painPoint))),messageAngle:leaf(t(L.messageAngle))})),
  signals:n(L.signals,()=>({type:leaf('CONTRACT_RENEWAL' as const),segmentRefs:n(Math.min(L.segmentRefs,L.segments),key)})),
  exclusions:n(L.exclusions,()=>({label:leaf(t(L.exclusionLabel)),reason:leaf(t(L.exclusionReason))})),
 } as IcpProfile;
}
