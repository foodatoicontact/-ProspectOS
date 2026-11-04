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
export const SOURCE_MAX=200;
export const CRITICAL_CONFIDENCE=0.6;

export const DEPARTMENT_CODES=DEPARTMENTS.map(d=>d.code) as readonly string[];
// INSEE headcount bands (tranches d'effectif salarié), as the register codes them.
export const SIZE_BANDS=Object.keys(EMPLOYEE_BANDS) as readonly string[];
// NAF rév. 2 sub-class, as written by INSEE: 2 digits, dot, 2 digits, a capital letter (e.g. 80.20Z).
export const APE_CODE=/^\d{2}\.\d{2}[A-Z]$/;

export const SITE_ROLES=['HQ','AGENCY','PARTNER'] as const;
export const SIGNAL_TYPES=['CREATION','TRANSFER','OPENING','WORKS','HIRING','ACQUISITION','CONTRACT_RENEWAL'] as const;
export const VALUE_LEVELS=['LOW','MEDIUM','HIGH'] as const;

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

const Site=z.object({city:text(120),department:departmentCode.nullable(),role:z.enum(SITE_ROLES)}).strict();
const Promise_=z.object({text:text(300),value:z.number().finite().nullable(),unit:text(40).nullable()}).strict();
const SegmentKey=z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);

export const CompanyBlock=z.object({
 name:sourced(text(200)),
 activity:sourced(text(500)),
 sites:z.array(sourced(Site)).max(30),
 interventionZones:z.array(sourced(departmentCode)).max(101),
}).strict();

export const OfferBlock=z.object({
 services:z.array(sourced(text(200))).max(30),
 promises:z.array(sourced(Promise_)).max(20),
 differentiators:z.array(sourced(text(300))).max(20),
 proofs:z.array(sourced(text(300))).max(20),
}).strict();

// key: a structural identifier (not extracted, never shown as a fact) that signals[].segmentRefs point to.
export const Segment=z.object({
 key:SegmentKey,
 label:sourced(text(120)),
 apeCodes:z.array(sourced(z.string().regex(APE_CODE))).max(20),
 sizeRange:sourced(z.array(sizeBand).min(1).max(15)),
 priority:sourced(z.union([z.literal(1),z.literal(2),z.literal(3)])),
 estimatedValue:sourced(z.enum(VALUE_LEVELS)),
 salesCycle:sourced(text(120)),
}).strict();

export const Persona=z.object({
 role:sourced(text(120)),
 painPoints:z.array(sourced(text(300))).max(10),
 messageAngle:sourced(text(300)),
}).strict();

export const Signal=z.object({type:sourced(z.enum(SIGNAL_TYPES)),segmentRefs:z.array(SegmentKey).max(10)}).strict();
export const Exclusion=z.object({label:sourced(text(120)),reason:sourced(text(300))}).strict();

export const IcpProfile=z.object({
 version:z.literal(ICP_PROFILE_VERSION),
 company:CompanyBlock,
 offer:OfferBlock,
 segments:z.array(Segment).max(10),
 personas:z.array(Persona).max(10),
 signals:z.array(Signal).max(10),
 exclusions:z.array(Exclusion).max(20),
}).strict().superRefine((p,ctx)=>{
 const keys=p.segments.map(s=>s.key);
 if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',message:'Segment keys must be unique',path:['segments']});
 p.signals.forEach((s,i)=>s.segmentRefs.forEach((r,j)=>{if(!keys.includes(r))ctx.addIssue({code:'custom',message:'Unknown segment',path:['signals',i,'segmentRefs',j]})}));
});
export type IcpProfile=z.infer<typeof IcpProfile>;

// The one entry point for anything that is not typed by this code: an AI answer, a stored row, a request body.
// Never repaired, never partially accepted: valid as a whole, or an explicit error.
export function parseIcpProfile(raw:unknown):{ok:true;profile:IcpProfile}|{ok:false;issues:string[]}{
 const r=IcpProfile.safeParse(raw);
 return r.success?{ok:true,profile:r.data}:{ok:false,issues:r.error.issues.slice(0,20).map(i=>`${i.path.join('.')||'(root)'}: ${i.message}`)};
}

const empty=<T>():Sourced<T>=>({value:null,source:null,confidence:0});
// The starting point of a manual entry, and what an import fills in.
export function emptyIcpProfile():IcpProfile{
 return {version:ICP_PROFILE_VERSION,company:{name:empty(),activity:empty(),sites:[],interventionZones:[]},
  offer:{services:[],promises:[],differentiators:[],proofs:[]},segments:[],personas:[],signals:[],exclusions:[]};
}
