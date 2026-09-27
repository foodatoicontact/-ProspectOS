// V2 P0-C — Novelty matching (see novelty.ts for the statuses, counters and display order).
// Identity, strongest first: the prospect link, the organization's own domain, a phone, then the canonical
// name WITH a compatible location. Never a weak name similarity alone, never a name when both sides have
// different websites, never a directory's domain (only a resolved organization's own site counts).
import {normalize,normalizeDomain,normalizePhone} from './deduplication.ts';
import {canonicalOrganizationName,entityCore,sameCanonicalOrganization} from './admissibility.ts';
import type {Novelty,NoveltyBasis,NoveltySubject,ProjectMemory,ProspectMemory,ResultMemory} from './novelty.ts';

type Identity={domain:string|null;phone:string|null;name:string|null;location:string|null;url:string|null};
// Canonical page URL: scheme and host lowercased, no fragment, no trailing slash.
function canonicalUrl(u:string|null|undefined){if(!u)return null;try{const x=new URL(u);x.hash='';return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/,'')}${x.search}`}catch{return null}}
// The name and the domain count as the organization's own only when resolution said so (Brave: the gate
// admitted a resolved organization / its own site). Rows without that metadata (fixture, legacy) have a
// structured name and website of their own.
function subjectIdentity(s:NoveltySubject,runLocation:string|null):Identity{
 const m=s.raw_metadata??{};const cls=m.source_class;
 const company=cls===undefined||cls===null||cls==='COMPANY_CANDIDATE';
 const nameOk=company&&(m.company_name_status===undefined||m.company_name_status==='RESOLVED');
 const domainOk=company&&(m.company_domain_status===undefined||m.company_domain_status==='RESOLVED');
 return {domain:domainOk?normalizeDomain(s.website):null,phone:normalizePhone(s.phone),name:nameOk?s.name:null,location:s.city??runLocation,url:canonicalUrl(s.source_url)};
}
function resultIdentity(r:ResultMemory,runLocation:string|null):Identity{
 const company=r.source_class===undefined||r.source_class===null||r.source_class==='COMPANY_CANDIDATE';
 const nameOk=company&&(r.name_status==null||r.name_status==='RESOLVED');
 const domainOk=company&&(r.domain_status==null||r.domain_status==='RESOLVED');
 return {domain:domainOk?normalizeDomain(r.website):null,phone:normalizePhone(r.phone),name:nameOk?r.company_name:null,location:r.city??runLocation,url:canonicalUrl(r.source_url)};
}
const prospectIdentity=(p:ProspectMemory):Identity=>({domain:normalizeDomain(p.website),phone:normalizePhone(p.phone),name:p.name,location:p.city??null,url:null});

// "Ville" and "Ville et communes limitrophes" are compatible; two different towns are not; an unknown
// location is never compatible (a name alone never identifies an actor).
export function compatibleLocation(a:string|null|undefined,b:string|null|undefined){
 const x=normalize(a),y=normalize(b);if(!x||!y)return false;if(x===y)return true;
 const words=(s:string)=>` ${s} `;return words(y).includes(words(x))||words(x).includes(words(y));
}
// Two identities are the same actor, and on which basis (strongest first).
function sameActor(a:Identity,b:Identity):NoveltyBasis|null{
 if(a.domain&&b.domain&&a.domain===b.domain){
  // A domain shared by two different places is not proof (a chain's site): only when locations agree or one is unknown.
  if(!a.location||!b.location||compatibleLocation(a.location,b.location))return 'domain';
 }
 if(a.phone&&b.phone&&a.phone===b.phone)return 'phone';
 // Name + location only when the websites do not contradict it (same name, two websites = two actors).
 if(a.name&&b.name&&!(a.domain&&b.domain&&a.domain!==b.domain)&&sameCanonicalOrganization(a.name,b.name)&&compatibleLocation(a.location,b.location))return 'name_location';
 if(a.url&&b.url&&a.url===b.url)return 'source_url';
 return null;
}

// Stable key of an actor for this project, for the future "search until N new" loop (B8).
export function entityKey(s:NoveltySubject,runLocation:string|null=null):string{
 const id=subjectIdentity(s,runLocation);
 return id.domain?`domain:${id.domain}`:id.phone?`phone:${id.phone}`:id.name?`name:${normalize(canonicalOrganizationName(id.name))}|${normalize(id.location)}`:`url:${id.url??normalize(s.source_url)}`;
}

export class ProjectNovelty {
 private prospects:Array<{p:ProspectMemory;id:Identity}>;
 private results:Array<{r:ResultMemory;id:Identity}>;
 private byDomain=new Map<string,number[]>();private byPhone=new Map<string,number[]>();private byUrl=new Map<string,number[]>();private byName=new Map<string,number[]>();
 private current:Array<Identity>=[];
 private runLocation:string|null;
 constructor(memory:ProjectMemory,runLocation:string|null=null){
  const locations=new Map(memory.runs.map(r=>[r.id,r.location]));this.runLocation=runLocation;
  this.prospects=memory.prospects.map(p=>({p,id:prospectIdentity(p)}));
  this.results=memory.results.map(r=>({r,id:resultIdentity(r,locations.get(r.discovery_run_id)??null)}));
  // Indexes for the exact keys; names are compared only within the (small) set of candidates they return
  // or by a linear pass bounded by the memory size — in memory, never a query.
  // Names are indexed by the same canonical core sameCanonicalOrganization compares (admissibility.ts).
  this.results.forEach(({id},i)=>{for(const [map,key] of [[this.byDomain,id.domain],[this.byPhone,id.phone],[this.byUrl,id.url],[this.byName,id.name?entityCore(id.name):null]] as const)if(key)map.set(key,[...(map.get(key)??[]),i])});
 }
 // Classifies one result of the current run; call in the run's order (a later occurrence of the same
 // actor in the same run is a CURRENT_RUN_DUPLICATE).
 classify(subject:NoveltySubject,opts:{duplicateOf?:string|null}={}):Novelty{
  const id=subjectIdentity(subject,this.runLocation);
  if(this.current.some(c=>sameActor(id,c)))return {status:'CURRENT_RUN_DUPLICATE',basis:null,prospect_id:null,run_id:null,result_id:null};
  this.current.push(id);
  const prospectIds=new Set(this.prospects.map(x=>x.p.id));
  // 1. Same prospect: the project's own dedup already linked this result to an existing prospect.
  if(opts.duplicateOf&&prospectIds.has(opts.duplicateOf))return {status:'ADDED',basis:'prospect_id',prospect_id:opts.duplicateOf,run_id:null,result_id:null};
  for(const {p,id:pid} of this.prospects){const basis=sameActor(id,pid);if(basis&&basis!=='source_url')return {status:'ADDED',basis,prospect_id:p.id,run_id:null,result_id:null}}
  const hits=new Map<number,NoveltyBasis>();
  const add=(list:number[]|undefined)=>{for(const i of list??[]){const b=sameActor(id,this.results[i]!.id);if(b&&!hits.has(i))hits.set(i,b)}};
  add(id.domain?this.byDomain.get(id.domain):undefined);add(id.phone?this.byPhone.get(id.phone):undefined);add(id.url?this.byUrl.get(id.url):undefined);
  if(id.name)add(this.byName.get(entityCore(id.name)));
  const matched=[...hits].sort((a,b)=>a[0]-b[0]).map(([i,basis])=>({r:this.results[i]!.r,basis}));
  // An earlier result added as a prospect that still exists: same prospect_id, already added.
  const added=matched.find(m=>m.r.status==='accepted'&&m.r.prospect_id&&prospectIds.has(m.r.prospect_id));
  if(added)return {status:'ADDED',basis:'prospect_id',prospect_id:added.r.prospect_id,run_id:added.r.discovery_run_id,result_id:added.r.id};
  const ignored=matched.find(m=>m.r.status==='ignored');
  if(ignored)return {status:'IGNORED',basis:ignored.basis,prospect_id:null,run_id:ignored.r.discovery_run_id,result_id:ignored.r.id};
  // Memory is newest first: the first match is the latest run where this actor was seen.
  const seen=matched[0];
  if(seen)return {status:'SEEN',basis:seen.basis,prospect_id:null,run_id:seen.r.discovery_run_id,result_id:seen.r.id};
  return {status:'NEW',basis:null,prospect_id:null,run_id:null,result_id:null};
 }
}


// Duplicate protection at "Ajouter" (B14): the project's prospect this result already is, on the strong
// bases only (own domain, phone) — a name alone never blocks an addition.
export function strongProspectMatch(subject:NoveltySubject,prospects:ProspectMemory[]):string|null{
 const id=subjectIdentity(subject,null);
 for(const p of prospects){const basis=sameActor(id,prospectIdentity(p));if(basis==='domain'||basis==='phone')return p.id}
 return null;
}

// Current project status of a run's results, when the run is read (display only). One pass over the
// project's prospects, already read once: an actor that IS a prospect of the project now (same own domain or
// phone — the strong bases of strongProspectMatch — or the snapshot's own prospect, still there) is ADDED.
// Rows already accepted from this run carry their own state and are left alone.
export type ResultIdentityRow={id:string;status:string;company_name:string;website:string|null;phone?:string|null;city:string|null;source_url:string;source_class?:string|null;normalized_payload?:{raw_metadata?:Record<string,unknown>}|null};
export function currentProjectStatuses(rows:ResultIdentityRow[],prospects:ProspectMemory[]):Map<string,{status:'ADDED';prospect_id:string}|null>{
 const ids=new Set(prospects.map(p=>p.id));const out=new Map<string,{status:'ADDED';prospect_id:string}|null>();
 for(const r of rows){
  if(r.status==='accepted')continue;
  const snapshot=r.normalized_payload?.raw_metadata?.novelty as {status?:string;prospect_id?:string|null}|undefined;
  const now=strongProspectMatch({name:r.company_name,website:r.website,phone:r.phone??null,city:r.city,source_url:r.source_url,raw_metadata:{source_class:r.source_class??null}},prospects)
   ??(snapshot?.status==='ADDED'&&snapshot.prospect_id&&ids.has(snapshot.prospect_id)?snapshot.prospect_id:null);
  out.set(r.id,now?{status:'ADDED',prospect_id:now}:null);
 }
 return out;
}
// "Ajouter" duplicate protection (B14), as a decision: the prospect this result already is, when the accept
// RPC would otherwise CREATE a second one — not when it links to the dedup match (duplicate_candidate), not
// when it would reuse that prospect's own dedupe key.
export type AcceptIdentity={dedupe_status:string;dedupe_key:string;company_name:string;website:string|null;phone:string|null;city:string|null;source_url:string};
export function alreadyAddedProspect(row:AcceptIdentity,sourceClass:string|null,prospects:Array<ProspectMemory&{discovery_dedupe_key?:string|null}>,forceSeparate:boolean):string|null{
 if(row.dedupe_status==='duplicate_candidate')return null;
 const same=strongProspectMatch({name:row.company_name,website:row.website,phone:row.phone,city:row.city,source_url:row.source_url,raw_metadata:{source_class:sourceClass}},prospects);
 if(!same)return null;
 const reused=!forceSeparate&&prospects.find(p=>p.id===same)?.discovery_dedupe_key===row.dedupe_key;
 return reused?null:same;
}
