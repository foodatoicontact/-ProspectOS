import {createHash} from 'node:crypto';
import {SignalCandidateSchema,SIGNAL_TYPES,type SignalCandidate,type SignalType} from './types.ts';
import type {SignalProvider,SignalTarget} from './provider.ts';
// Signal Engine S2 — one scan: for each company and each provider that supports it, one provider call within a request
// and time budget; every raw item goes through the strict schema; rejected items are counted by reason, never saved;
// duplicates (same excerpt, or the same event from two sources) are dropped; the rest goes to save_signals, which
// computes confidence and keeps PENDING_REVIEW. Nothing here grants a status, a score, or evidence.
export interface SignalRepository{
 saveSignals(prospectId:string,runId:string|null,signals:SignalCandidate[]):Promise<{inserted:number;duplicates:number}>;
}
export type ScanReport={targets:number;requests_sent:number;requests_failed:number;candidates:number;rejected:Record<string,number>;inserted:number;duplicates:number;out_of_time:boolean};
export type ScanInput={targets:SignalTarget[];providers:SignalProvider[];profile:{types:Partial<Record<SignalType,number>>;terms:string[]}|null;
 budget:{maxRequests:number;deadlineMs:number};now:Date;runId:string|null;repo:SignalRepository;clock?:()=>number};

const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
// Same text, same hash: case, accents and spaces aside.
export const contentHash=(excerpt:string):string=>createHash('sha256').update(fold(excerpt)).digest('hex');
// The same event seen on several sources: same type, same day, same title (normalized). Bounded to 200 characters.
export function eventKey(type:SignalType,day:string|null,title:string):string{
 return `${type}:${day??'nodate'}:${createHash('sha256').update(fold(title)).digest('hex').slice(0,24)}`;
}
const FUTURE_TOLERANCE_MS=86400000;

export async function runSignalScan(input:ScanInput):Promise<{report:ScanReport}>{
 const clock=input.clock??(()=>Date.now());const started=clock();
 const tracked=(t:SignalType)=>input.profile?(input.profile.types[t]??0)>0:true;
 const types=SIGNAL_TYPES.filter(tracked);
 const terms=(input.profile?.terms??[]).map(t=>t.trim()).filter(Boolean);
 const report:ScanReport={targets:input.targets.length,requests_sent:0,requests_failed:0,candidates:0,rejected:{},inserted:0,duplicates:0,out_of_time:false};
 const reject=(code:string)=>{report.rejected[code]=(report.rejected[code]??0)+1};
 for(const target of input.targets){
  const list:SignalCandidate[]=[];const hashes=new Set<string>();const keys=new Set<string>();
  for(const provider of input.providers){
   if(!provider.supports(target))continue;
   if(report.requests_sent>=input.budget.maxRequests)break;
   if(clock()-started>=input.budget.deadlineMs){report.out_of_time=true;break}
   report.requests_sent++;
   let items;
   try{items=await provider.searchSignals({target,types,now:input.now})}catch{report.requests_failed++;continue}
   for(const item of items){
    const text=fold(`${item.title} ${item.excerpt}`);
    const parsed=SignalCandidateSchema.safeParse({
     provider:provider.id,signal_type:item.signal_type,title:item.title,excerpt:item.excerpt,source_url:item.source_url,source_type:item.source_type,
     event_date:item.event_date,published_at:item.published_at,observed_at:input.now.toISOString(),
     matched_terms:terms.filter(t=>text.includes(fold(t))),content_hash:contentHash(item.excerpt??''),
     event_key:eventKey(item.signal_type,(item.event_date??item.published_at??input.now.toISOString()).slice(0,10),item.title??''),
     raw_metadata:item.metadata??{},
    });
    if(!parsed.success){reject('INVALID_SIGNAL');continue}
    const c=parsed.data;
    const when=c.event_date?`${c.event_date}T00:00:00Z`:c.published_at;
    if(when&&new Date(when).getTime()>input.now.getTime()+FUTURE_TOLERANCE_MS){reject('FUTURE_DATE');continue}
    if(!tracked(c.signal_type)){reject('TYPE_NOT_TRACKED');continue}
    if(hashes.has(c.content_hash)||keys.has(c.event_key))continue;
    hashes.add(c.content_hash);keys.add(c.event_key);list.push(c);
   }
  }
  report.candidates+=list.length;
  if(list.length){const r=await input.repo.saveSignals(target.prospect_id,input.runId,list);report.inserted+=r.inserted;report.duplicates+=r.duplicates}
  if(report.out_of_time)break;
 }
 return {report};
}
