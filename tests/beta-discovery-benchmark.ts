// Reproducible Discovery quality benchmark (not a test file: imported by tests/beta-discovery-quality.test.ts and
// runnable alone). Inputs: the 20 REAL public results of the Thomas run (thomas-real-run-2026-09-27.json, human
// feedback: ribiere.eu/mdtp.fr very relevant, ambtpvrd.fr to qualify) + REPRESENTATIVE fixtures of the Carla beta
// (carla-beta-representative.json, labelled expected=company|content). Same pipeline as DiscoveryService:
// normalize every page → merge one organization's pages → review priority.
//   RAW_RESULTS              rows given to the pipeline
//   CANDIDATES               COMPANY_CANDIDATE after the in-run merge
//   DUPLICATES               pages merged into another candidate of the same run
//   UNRESOLVED               set aside with reason ENTITY_UNRESOLVED (no organization could be named)
//   REJECTED                 set aside with any other reason (directory, sector body, event, zone…)
//   QUALIFIED_OR_REVIEWABLE  candidates with review priority HIGH or MEDIUM (worth a human's look first)
//   FALSE_POSITIVE_LIKE      candidates whose human label says it is not a company to work (Thomas real run: not one of
//                            the 3 kept domains AND not a resolved company site; labelled fixtures: expected!=company)
//   ENTITY_TYPE_MISMATCH_AS_CANDIDATE  candidates that are a federation, association, public body, media or event
//                            (by type, or by the fixture's human label) — THOMAS_CANARY: representative canary shapes
import {readFileSync} from 'node:fs';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {assessCandidateQuality} from '../src/discovery/candidate-quality.ts';
import {mergeSameEntityCandidates} from '../src/discovery/admissibility.ts';
import {reviewPriority} from '../src/discovery/review-priority.ts';
import type {Candidate} from '../src/discovery/types.ts';
type Row={id?:string;expected?:string;title:string;url:string;description:string};
type Bench={query:string;location:string;categories:string[];rows:Row[]};
const load=(f:string)=>JSON.parse(readFileSync(new URL(`./fixtures/${f}`,import.meta.url),'utf8')) as Bench;
export const THOMAS=load('thomas-real-run-2026-09-27.json'),CARLA=load('carla-beta-representative.json'),THOMAS_CANARY=load('thomas-canary-representative.json');
const provider=new BraveProvider('benchmark-key');
export function run(b:Bench){
 const ctx={query:b.query,categories:b.categories,location:b.location};
 const normalized=b.rows.map(r=>({row:r,c:provider.normalizeResult({...r,__quality:assessCandidateQuality(r,b.location),__context:ctx})}));
 const {kept,merged}=mergeSameEntityCandidates(normalized.map(x=>x.c));
 const rowOf=(c:Candidate)=>normalized.find(x=>x.c.source_url===c.source_url)!.row;
 return kept.map(c=>({c,row:rowOf(c),meta:c.raw_metadata as Record<string,any>,priority:reviewPriority(c.raw_metadata,c.website).level})).map(x=>({...x,merged}));
}
const THOMAS_KEPT=['ribiere.eu','mdtp.fr','ambtpvrd.fr'];
const isFalsePositiveLike=(x:ReturnType<typeof run>[number],bench:Bench)=>x.row.expected?x.row.expected!=='company':!THOMAS_KEPT.some(d=>(x.c.website??'').includes(d))&&x.meta.entity_confidence!=='RESOLVED_HIGH';
export function metrics(bench:Bench){
 const out=run(bench);const cand=out.filter(x=>x.meta.source_class==='COMPANY_CANDIDATE');const aside=out.filter(x=>x.meta.source_class!=='COMPANY_CANDIDATE');
 return {RAW_RESULTS:bench.rows.length,CANDIDATES:cand.length,REJECTED:aside.filter(x=>x.meta.admissibility?.reason_code!=='ENTITY_UNRESOLVED').length,DUPLICATES:out[0]?.merged??0,
  UNRESOLVED:aside.filter(x=>x.meta.admissibility?.reason_code==='ENTITY_UNRESOLVED').length,QUALIFIED_OR_REVIEWABLE:cand.filter(x=>x.priority!=='LOW').length,
  FALSE_POSITIVE_LIKE_RESULTS:cand.filter(x=>isFalsePositiveLike(x,bench)).length,
  ENTITY_TYPE_MISMATCH_AS_CANDIDATE:cand.filter(x=>['FEDERATION','ASSOCIATION','PUBLIC_BODY','MEDIA','EVENT'].includes(x.meta.entity_type)||x.row.expected==='non_commercial').length,candidates:cand.map(x=>`${x.c.name}[${x.priority}]`)};
}
if(process.argv[1]?.endsWith('beta-discovery-benchmark.ts'))console.log(JSON.stringify({THOMAS:metrics(THOMAS),CARLA:metrics(CARLA),THOMAS_CANARY:metrics(THOMAS_CANARY)},null,1));
