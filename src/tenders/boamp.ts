// Open public tenders from the BOAMP (Bulletin officiel des annonces des marchés publics, DILA), read through its
// Opendatasoft API (open data). A tender is an OPPORTUNITY a person may answer, not a company: it is listed with its
// official notice and its deadline, never saved, never scored, never answered automatically.
//
// What is asked, and only this:
//  - notices of nature APPEL_OFFRE (« Avis de marché ») whose response deadline is still ahead;
//  - whose subject (objet) contains one of the person's keywords, in the departments they chose;
//  - only the public fields of the notice (no contact block: the raw `donnees`/`gestion` fields can hold a buyer's
//    contact person, they are never requested).
// Fixed host, bounded size and time, redirects refused; keywords and department codes are validated here before
// they enter the query, so nothing the person types can change its structure.
export const BOAMP_RECORDS='https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records';
export const BOAMP_PROVENANCE={source:'BOAMP — Bulletin officiel des annonces des marchés publics (DILA)',licence:'Données ouvertes DILA'};
export const TENDERS_LIMIT=50;
export const TENDERS_TIMEOUT_MS=15000;
export const MAX_KEYWORDS=5;
export const MAX_DEPARTMENTS=13;
const MAX_RESPONSE_BYTES=2_000_000;
const FIELDS='idweb,objet,code_departement,dateparution,datelimitereponse,nomacheteur,nature,type_marche,descripteur_libelle,procedure_libelle,url_avis';
const DEPT=/^(?:0[1-9]|[1-8]\d|9[0-5]|2[AB]|97[1-6])$/;
// Letters (accents included), digits, spaces, apostrophes and hyphens; 2 to 60 characters.
const KEYWORD=/^[\p{L}\p{N}][\p{L}\p{N} '’-]{1,59}$/u;
const NOTICE_URL=/^https:\/\/www\.boamp\.fr\/pages\/avis\/\?q=idweb:\d{2}-\d{1,8}$/;
const IDWEB=/^\d{2}-\d{1,8}$/;

export type TenderQuery={keywords:string[];departments:string[]};
export type Tender={id:string;subject:string;buyer:string;departments:string[];publishedOn:string;deadline:string;
 contractTypes:string[];descriptors:string[];procedure:string|null;url:string};
export class TendersError extends Error{}

const clip=(s:string,n:number)=>s.length>n?`${s.slice(0,n-1)}…`:s;
const strings=(v:unknown)=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'&&x.trim()!=='').map(x=>clip(x.trim(),80)).slice(0,10):[];

// The person's words, cleaned: trimmed, spaces collapsed, deduplicated without case; refused when not plain text.
export function parseTenderQuery(rawKeywords:string,rawDepartments:string):TenderQuery{
 const keywords:string[]=[];
 for(const k of rawKeywords.split(',').map(k=>k.trim().replace(/\s+/g,' ')).filter(Boolean))
  if(!keywords.some(x=>x.toLowerCase()===k.toLowerCase()))keywords.push(k); // the first spelling wins
 if(!keywords.length)throw new TendersError('KEYWORDS_REQUIRED');
 if(keywords.length>MAX_KEYWORDS)throw new TendersError('TOO_MANY_KEYWORDS');
 if(keywords.some(k=>!KEYWORD.test(k)))throw new TendersError('KEYWORD_INVALID');
 const departments=[...new Set(rawDepartments.split(',').map(d=>d.trim().toUpperCase()).filter(Boolean))];
 if(!departments.length)throw new TendersError('DEPARTMENTS_REQUIRED');
 if(departments.length>MAX_DEPARTMENTS)throw new TendersError('TOO_MANY_DEPARTMENTS');
 if(departments.some(d=>!DEPT.test(d)))throw new TendersError('DEPARTMENT_INVALID');
 return {keywords,departments};
}

export function tendersUrl(q:TenderQuery,now:Date):URL{
 // Validated again here: this is the only place where values enter the query text.
 for(const k of q.keywords)if(!KEYWORD.test(k))throw new TendersError('KEYWORD_INVALID');
 for(const d of q.departments)if(!DEPT.test(d))throw new TendersError('DEPARTMENT_INVALID');
 const u=new URL(BOAMP_RECORDS);
 const words=q.keywords.map(k=>`search(objet,"${k.replace(/’/g,"'")}")`).join(' or ');
 const depts=q.departments.map(d=>`code_departement="${d}"`).join(' or ');
 u.searchParams.set('select',FIELDS);
 u.searchParams.set('where',`nature="APPEL_OFFRE" and datelimitereponse>date'${now.toISOString().slice(0,10)}' and (${words}) and (${depts})`);
 u.searchParams.set('order_by','datelimitereponse asc');
 u.searchParams.set('limit',String(TENDERS_LIMIT));
 return u;
}

// One notice, or null when anything needed is missing or not what the official BOAMP publishes.
export function toTender(r:unknown,now:Date):Tender|null{
 if(!r||typeof r!=='object')return null;
 const x=r as Record<string,unknown>;
 if(x.nature!=='APPEL_OFFRE')return null;
 const id=typeof x.idweb==='string'?x.idweb:'';
 const url=typeof x.url_avis==='string'?x.url_avis:'';
 if(!IDWEB.test(id)||!NOTICE_URL.test(url)||!url.endsWith(`idweb:${id}`))return null;
 const subject=typeof x.objet==='string'?x.objet.replace(/\s+/g,' ').trim():'';
 const buyer=typeof x.nomacheteur==='string'?x.nomacheteur.replace(/\s+/g,' ').trim():'';
 if(!subject||!buyer)return null;
 const deadline=typeof x.datelimitereponse==='string'?new Date(x.datelimitereponse):null;
 const published=typeof x.dateparution==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x.dateparution)?x.dateparution:null;
 if(!deadline||!Number.isFinite(deadline.getTime())||deadline.getTime()<=now.getTime()||!published)return null;
 return {id,subject:clip(subject,400),buyer:clip(buyer,200),departments:strings(x.code_departement).filter(d=>DEPT.test(d)),
  publishedOn:published,deadline:deadline.toISOString(),contractTypes:strings(x.type_marche),descriptors:strings(x.descripteur_libelle),
  procedure:typeof x.procedure_libelle==='string'?clip(x.procedure_libelle.trim(),120):null,url};
}

async function readBounded(res:Response):Promise<unknown>{
 const reader=res.body?.getReader();if(!reader)throw new TendersError('TENDERS_UNAVAILABLE');
 let total=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_RESPONSE_BYTES)throw new TendersError('TENDERS_UNAVAILABLE');chunks.push(value)}}
 finally{await reader.cancel().catch(()=>{})}
 const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw new TendersError('TENDERS_UNAVAILABLE')}
}

export async function searchOpenTenders(q:TenderQuery,{fetch:fetchImpl=fetch,now=new Date()}:{fetch?:typeof fetch;now?:Date}={}):Promise<{tenders:Tender[];total:number}>{
 const url=tendersUrl(q,now);
 let res:Response;
 try{res=await fetchImpl(url.href,{redirect:'error',signal:AbortSignal.timeout(TENDERS_TIMEOUT_MS),headers:{accept:'application/json'}})}
 catch{throw new TendersError('TENDERS_UNAVAILABLE')}
 if(!res.ok){await res.body?.cancel().catch(()=>{});throw new TendersError('TENDERS_UNAVAILABLE')}
 const data=await readBounded(res) as {total_count?:unknown;results?:unknown};
 if(!Array.isArray(data?.results))throw new TendersError('TENDERS_UNAVAILABLE');
 const seen=new Set<string>();const tenders:Tender[]=[];
 for(const r of data.results){const t=toTender(r,now);if(t&&!seen.has(t.id)){seen.add(t.id);tenders.push(t)}}
 tenders.sort((a,b)=>a.deadline.localeCompare(b.deadline));
 return {tenders,total:typeof data.total_count==='number'?data.total_count:tenders.length};
}
