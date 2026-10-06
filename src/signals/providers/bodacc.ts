import {z} from 'zod';
import type {SignalProvider,SignalSearchInput,RawSignal,SignalTarget} from '../provider.ts';
import type {SignalType} from '../types.ts';
import {fold} from '../extract.ts';
// Signal Engine S10 — legal announcements (provider bodacc): the BODACC published by the DILA, read through its public
// open-data API (Opendatasoft, dataset "annonces-commerciales", Licence Ouverte / Etalab). Searched by SIREN only, and
// every announcement is checked to carry that exact SIREN: no homonym is possible. The publication date is official.
//
// What counts: a change of executive (modification), a new establishment or registration (création), a sale or
// transfer of a business (vente), a capital increase, a head-office transfer. What never counts as a reason to call:
// collective proceedings (safeguard, receivership, liquidation, conciliation) — counted apart so the user is warned —
// struck-off notices, filed accounts, corrections and cancellations.
//
// Field names follow the dataset's published schema; they could not be checked from the development environment
// (network policy) and are validated on Preview. Unknown or missing fields only mean fewer signals, never a wrong one.
const API='https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records';
const MAX_AGE_DAYS=365;
const Record_=z.object({
 id:z.string().optional(),
 dateparution:z.string().optional(),
 parution:z.union([z.string(),z.number()]).optional(),
 typeavis:z.string().optional(),typeavis_lib:z.string().optional(),
 familleavis:z.string().optional(),familleavis_lib:z.string().optional(),
 commercant:z.string().optional(),ville:z.string().optional(),
 registre:z.union([z.array(z.string()),z.string()]).optional(),
 modificationsgenerales:z.unknown().optional(),listeetablissements:z.unknown().optional(),acte:z.unknown().optional(),
 url_complete:z.string().optional(),
}).passthrough();
type Rec=z.infer<typeof Record_>;
export const bodaccEnabled=(env:Record<string,string|undefined>)=>env.SIGNALS_BODACC_ENABLED!=='false';
const digits=(s:string)=>s.replace(/\D/g,'');
const json=(v:unknown):unknown=>{if(typeof v!=='string')return v;try{return JSON.parse(v)}catch{return v}};
// Every string found in a (possibly JSON-encoded) field, in order: the announcement's own words, never reworded.
function texts(v:unknown,out:string[]=[]):string[]{
 const x=json(v);
 if(typeof x==='string'){const t=x.replace(/\s+/g,' ').trim();if(t)out.push(t)}
 else if(Array.isArray(x))x.forEach(i=>texts(i,out));
 else if(x&&typeof x==='object')for(const [k,val] of Object.entries(x))if(!/^(numero|siren|rcs|code|type|cp)/i.test(k))texts(val,out);
 return out;
}
export function sirenMatches(rec:Rec,siren:string):boolean{
 const list=Array.isArray(rec.registre)?rec.registre:rec.registre?[rec.registre]:[];
 return list.some(r=>digits(r)===siren);
}
const COLLECTIVE=/proc[eé]dures? collectives?|redressement|liquidation|sauvegarde|conciliation|r[eé]tablissement professionnel/i;
// The family of the announcement → a signal type, or why it is not one.
export function classifyAnnouncement(rec:Rec):{type:SignalType;detail:string}|{reject:'COLLECTIVE_PROCEDURE'|'NOT_A_SIGNAL'|'CORRECTION'}{
 const kind=fold(`${rec.typeavis??''} ${rec.typeavis_lib??''}`);
 if(/rectificatif|annulation/.test(kind))return {reject:'CORRECTION'};
 const family=fold(`${rec.familleavis??''} ${rec.familleavis_lib??''}`);
 if(COLLECTIVE.test(family)||/\b(collective|conciliation|retablissement)\b/.test(family))return {reject:'COLLECTIVE_PROCEDURE'};
 if(/radiation|depot|dpc|comptes/.test(family))return {reject:'NOT_A_SIGNAL'};
 const detail=texts(rec.modificationsgenerales).concat(texts(rec.listeetablissements),texts(rec.acte)).join(' — ');
 const d=fold(detail);
 if(/vente|cession/.test(family))return {type:'acquisition',detail};
 if(/creation|immatriculation/.test(family))return {type:'new_site',detail};
 if(/modification/.test(family)){
  if(/\b(dirigeant|gerant|gerance|president|directeur general|administrateur|nomination|representant legal)/.test(d))return {type:'leadership_change',detail};
  if(/transfert (du|de) siege|nouvelle adresse du siege|siege social transfere/.test(d))return {type:'new_site',detail};
  if(/augmentation (du|de) capital/.test(d))return {type:'funding',detail};
 }
 return {reject:'NOT_A_SIGNAL'};
}

export class BodaccSignalProvider implements SignalProvider{
 id='bodacc' as const;mode='live' as const;
 lastReport={requests_sent:0,collective_procedures:0};
 private rejected:Record<string,number>={};
 private request:typeof fetch;
 constructor(request:typeof fetch=fetch){this.request=request}
 supports(target:SignalTarget){return !!target.siren&&/^\d{9}$/.test(target.siren)}
 takeRejections(){const r=this.rejected;this.rejected={};return r}
 private reject(code:string){this.rejected[code]=(this.rejected[code]??0)+1}
 async searchSignals({target,now}:SignalSearchInput):Promise<RawSignal[]>{
  const siren=target.siren!;
  const since=new Date(now.getTime()-MAX_AGE_DAYS*86400000).toISOString().slice(0,10);
  const url=new URL(API);
  url.searchParams.set('where',`registre="${siren}" and dateparution>=date'${since}'`);
  url.searchParams.set('order_by','dateparution desc');url.searchParams.set('limit','20');
  this.lastReport.requests_sent++;
  const response=await this.request(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!response.ok)throw Error(`BODACC_HTTP_${response.status}`);
  const body=await response.text();if(body.length>2000000)throw Error('BODACC_RESPONSE_TOO_LARGE');
  const parsed=z.object({results:z.array(z.unknown()).default([])}).passthrough().parse(JSON.parse(body));
  const out:RawSignal[]=[];
  for(const raw of parsed.results){
   const r=Record_.safeParse(raw);if(!r.success){this.reject('INVALID_SIGNAL');continue}
   const rec=r.data;
   if(!sirenMatches(rec,siren)){this.reject('SIREN_MISMATCH');continue}
   const c=classifyAnnouncement(rec);
   if('reject' in c){if(c.reject==='COLLECTIVE_PROCEDURE')this.lastReport.collective_procedures++;this.reject(c.reject);continue}
   const day=/^\d{4}-\d{2}-\d{2}/.test(rec.dateparution??'')?rec.dateparution!.slice(0,10):null;
   if(!day){this.reject('INVALID_SIGNAL');continue}
   const label=(rec.familleavis_lib??rec.familleavis??'Annonce BODACC').trim();
   const who=(rec.commercant??target.name).trim();
   const excerpt=(c.detail?`${label} — ${c.detail}`:`${label} — ${who}${rec.ville?` (${rec.ville.trim()})`:''}`).slice(0,500);
   const official=rec.url_complete&&/^https:\/\/www\.bodacc\.fr\//.test(rec.url_complete)?rec.url_complete:rec.id?`https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:${encodeURIComponent(rec.id)}`:null;
   if(!official){this.reject('INVALID_SIGNAL');continue}
   out.push({signal_type:c.type,title:`${label} — ${who}`.slice(0,300),excerpt,source_url:official,source_type:'legal_announcement',
    published_at:`${day}T00:00:00.000Z`,event_date:null,metadata:{bodacc_id:rec.id??null,parution:rec.parution??null,famille:rec.familleavis??null}});
  }
  return out;
 }
}

// The SIREN ProspectOS itself read in the public register when the prospect was accepted (server-written discovery
// results, migration 014): never a number typed by a member.
export function sirenOf(accepted:Array<{provider:string;raw_payload:unknown}>):string|null{
 for(const r of accepted){
  if(r.provider!=='registry')continue;
  const p=r.raw_payload as {siren?:unknown;registry?:{siren?:unknown}}|null;
  const s=typeof p?.siren==='string'?p.siren:typeof p?.registry?.siren==='string'?p.registry.siren:null;
  if(s&&/^\d{9}$/.test(s))return s;
 }
 return null;
}
