// IcpProfile — the single description of a company, its offer and its target (docs/ICP_IMPORT.md). The import only
// pre-fills it; a person reviews and validates it (migration 041). The profile never scores anything: a deterministic
// projection writes what the person accepted into the existing model (projects.offer, target_fit / need_fit rules,
// the search pre-fill), and the scoring engine keeps reading the criteria exactly as before.
//
// Zero invention, by construction: every extracted leaf is wrapped in { value, source, confidence }. A value without a
// source is refused; an unknown field is refused (strict objects); every list and text is bounded.
import {z} from 'zod';
import {DEPARTMENTS} from '../../discovery/geo-fr.ts';
import {EMPLOYEE_BANDS} from '../../discovery/registry/admission.ts';

export const ICP_PROFILE_VERSION=1 as const;
// Every bound of the profile, in one place: the schema below, the extraction prompt (src/server/ai.ts) and the output
// budget (src/domain/icp/budget.ts) all read it. A profile filled to every one of these bounds must fit the output
// budget of one AI call (tests/icp-budget.test.ts): raising a bound means re-doing that calculation.
export const ICP_LIMITS={
 source:40,
 name:60,activity:100,city:40,sites:6,zones:4,
 service:40,services:9,promise:50,unit:10,promises:3,differentiator:60,differentiators:3,proof:50,proofs:1,
 segmentKey:20,segmentLabel:40,segments:3,apeCodes:1,sizeBands:2,salesCycle:20,
 personas:1,role:40,painPoints:1,painPoint:50,messageAngle:50,
 signals:2,segmentRefs:2,
 exclusions:1,exclusionLabel:40,exclusionReason:40,
} as const;
export const SOURCE_MAX=ICP_LIMITS.source;
export const CRITICAL_CONFIDENCE=0.6;

export const DEPARTMENT_CODES=DEPARTMENTS.map(d=>d.code) as readonly string[];
// INSEE headcount bands (tranches d'effectif salarié), as the register codes them.
export const SIZE_BANDS=Object.keys(EMPLOYEE_BANDS) as readonly string[];
// NAF rév. 2 sub-class, as written by INSEE: 2 digits, dot, 2 digits, a capital letter (e.g. 80.20Z).
export const APE_CODE=/^\d{2}\.\d{2}[A-Z]$/;

export const SITE_ROLES=['HQ','AGENCY','PARTNER'] as const;
export const SIGNAL_TYPES=['CREATION','TRANSFER','OPENING','WORKS','HIRING','ACQUISITION','CONTRACT_RENEWAL'] as const;
export const VALUE_LEVELS=['LOW','MEDIUM','HIGH'] as const;
// How far the company says it works: the whole country, a region, a local area. Optional (profiles written before it
// stay valid); the department codes of interventionZones stay the detailed zones.
export const COVERAGE_LEVELS=['NATIONAL','REGIONAL','LOCAL'] as const;

const text=(max:number)=>z.string().trim().min(1).max(max);
const departmentCode=z.string().refine(c=>DEPARTMENT_CODES.includes(c),'Unknown department code');
const sizeBand=z.string().refine(c=>SIZE_BANDS.includes(c),'Unknown headcount band');

// One extracted leaf. value null = not found (confidence then says nothing); a value must say where it comes from.
export function sourced<T extends z.ZodType>(inner:T){
 return z.object({
  value:inner.nullable(),
  source:z.string().trim().min(1).max(SOURCE_MAX).nullable(),
  confidence:z.number().min(0).max(1),
 }).strict().refine(f=>{
  // The generic inner type hides `value` from the inferred shape here; it is always present (strict object).
  const leaf=f as unknown as {value:unknown;source:string|null};
  return leaf.value===null||leaf.source!==null;
 },{message:'A value needs its source',path:['source']});
}
export type Sourced<T>={value:T|null;source:string|null;confidence:number};

const Site=z.object({city:text(ICP_LIMITS.city),department:departmentCode.nullable(),role:z.enum(SITE_ROLES)}).strict();
const Promise_=z.object({text:text(ICP_LIMITS.promise),value:z.number().finite().nullable(),unit:text(ICP_LIMITS.unit).nullable()}).strict();
const SegmentKey=z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).max(ICP_LIMITS.segmentKey);

export const CompanyBlock=z.object({
 name:sourced(text(ICP_LIMITS.name)),
 activity:sourced(text(ICP_LIMITS.activity)),
 sites:z.array(sourced(Site)).max(ICP_LIMITS.sites),
 interventionZones:z.array(sourced(departmentCode)).max(ICP_LIMITS.zones),
 coverage:sourced(z.enum(COVERAGE_LEVELS)).optional(),
}).strict();

export const OfferBlock=z.object({
 services:z.array(sourced(text(ICP_LIMITS.service))).max(ICP_LIMITS.services),
 promises:z.array(sourced(Promise_)).max(ICP_LIMITS.promises),
 differentiators:z.array(sourced(text(ICP_LIMITS.differentiator))).max(ICP_LIMITS.differentiators),
 proofs:z.array(sourced(text(ICP_LIMITS.proof))).max(ICP_LIMITS.proofs),
}).strict();

// The value of every leaf, by field — what the extraction normaliser (normalize.ts) checks a leaf against, one by one.
export const VALUE={
 name:text(ICP_LIMITS.name),activity:text(ICP_LIMITS.activity),site:Site,zone:departmentCode,coverage:z.enum(COVERAGE_LEVELS),
 service:text(ICP_LIMITS.service),promise:Promise_,differentiator:text(ICP_LIMITS.differentiator),proof:text(ICP_LIMITS.proof),
 segmentLabel:text(ICP_LIMITS.segmentLabel),apeCode:z.string().regex(APE_CODE),sizeRange:z.array(sizeBand).min(1).max(ICP_LIMITS.sizeBands),
 priority:z.union([z.literal(1),z.literal(2),z.literal(3)]),estimatedValue:z.enum(VALUE_LEVELS),salesCycle:text(ICP_LIMITS.salesCycle),
 role:text(ICP_LIMITS.role),painPoint:text(ICP_LIMITS.painPoint),messageAngle:text(ICP_LIMITS.messageAngle),
 signalType:z.enum(SIGNAL_TYPES),exclusionLabel:text(ICP_LIMITS.exclusionLabel),exclusionReason:text(ICP_LIMITS.exclusionReason),
} as const;
export const SEGMENT_KEY=SegmentKey;
export const ROOT_KEYS=['version','company','offer','segments','personas','signals','exclusions'] as const;

// key: a structural identifier (not extracted, never shown as a fact) that signals[].segmentRefs point to.
export const Segment=z.object({
 key:SegmentKey,
 label:sourced(text(ICP_LIMITS.segmentLabel)),
 apeCodes:z.array(sourced(z.string().regex(APE_CODE))).max(ICP_LIMITS.apeCodes),
 sizeRange:sourced(z.array(sizeBand).min(1).max(ICP_LIMITS.sizeBands)),
 priority:sourced(z.union([z.literal(1),z.literal(2),z.literal(3)])),
 estimatedValue:sourced(z.enum(VALUE_LEVELS)),
 salesCycle:sourced(text(ICP_LIMITS.salesCycle)),
}).strict();

export const Persona=z.object({
 role:sourced(text(ICP_LIMITS.role)),
 painPoints:z.array(sourced(text(ICP_LIMITS.painPoint))).max(ICP_LIMITS.painPoints),
 messageAngle:sourced(text(ICP_LIMITS.messageAngle)),
}).strict();

export const Signal=z.object({type:sourced(z.enum(SIGNAL_TYPES)),segmentRefs:z.array(SegmentKey).max(ICP_LIMITS.segmentRefs)}).strict();
export const Exclusion=z.object({label:sourced(text(ICP_LIMITS.exclusionLabel)),reason:sourced(text(ICP_LIMITS.exclusionReason))}).strict();

export const IcpProfile=z.object({
 version:z.literal(ICP_PROFILE_VERSION),
 company:CompanyBlock,
 offer:OfferBlock,
 segments:z.array(Segment).max(ICP_LIMITS.segments),
 personas:z.array(Persona).max(ICP_LIMITS.personas),
 signals:z.array(Signal).max(ICP_LIMITS.signals),
 exclusions:z.array(Exclusion).max(ICP_LIMITS.exclusions),
}).strict().superRefine((p,ctx)=>{
 const keys=p.segments.map(s=>s.key);
 if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',message:'Segment keys must be unique',path:['segments']});
 p.signals.forEach((s,i)=>s.segmentRefs.forEach((r,j)=>{if(!keys.includes(r))ctx.addIssue({code:'custom',message:'Unknown segment',path:['signals',i,'segmentRefs',j]})}));
});
export type IcpProfile=z.infer<typeof IcpProfile>;

// The one entry point for anything that is not typed by this code: an AI answer, a stored row, a request body.
// Never repaired, never partially accepted: valid as a whole, or an explicit error.
// On a refusal: the first 20 issues as text, plus the real number of issues and, for every issue, its path and kind
// (zod's code — never the value) so a caller can count them.
export function parseIcpProfile(raw:unknown):{ok:true;profile:IcpProfile}|{ok:false;issues:string[];total:number;kinds:{path:string;code:string}[]}{
 const r=IcpProfile.safeParse(raw);
 if(r.success)return {ok:true,profile:r.data};
 return {ok:false,issues:r.error.issues.slice(0,20).map(i=>`${i.path.join('.')||'(root)'}: ${i.message}`),total:r.error.issues.length,
  kinds:r.error.issues.map(i=>({path:i.path.join('.')||'(root)',code:i.code}))};
}

const empty=<T>():Sourced<T>=>({value:null,source:null,confidence:0});
// The starting point of a manual entry, and what an import fills in.
export function emptyIcpProfile():IcpProfile{
 return {version:ICP_PROFILE_VERSION,company:{name:empty(),activity:empty(),sites:[],interventionZones:[]},
  offer:{services:[],promises:[],differentiators:[],proofs:[]},segments:[],personas:[],signals:[],exclusions:[]};
}
