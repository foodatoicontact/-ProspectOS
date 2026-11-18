// Collecte nationale — configuration (server side). OFF unless PUBLIC_EVENTS_COLLECT_ENABLED is "true"/"1".
//   PUBLIC_EVENTS_ENRICH_DEPARTMENTS  departments whose companies get their record (e.g. "75,77,78,91,92,93,94,95"); empty =
//                                     no enrichment. Temporary: the clients' own profiles will decide (next step).
import {parisDate,addDays} from '../dedicated/model.ts';
import type {EventKind} from './bodacc.ts';
import type {CollectConfig,EnrichConfig} from './run.ts';
export type Env=Record<string,string|undefined>;
const on=(v:string|undefined)=>{const x=(v??'').trim().toLowerCase();return x==='true'||x==='1'};
export const publicEventsEnabled=(env:Env)=>on(env.PUBLIC_EVENTS_COLLECT_ENABLED);
export function enrichDepartments(env:Env):string[]{
 return [...new Set((env.PUBLIC_EVENTS_ENRICH_DEPARTMENTS??'').split(',').map(s=>s.trim().toUpperCase()).filter(s=>/^(\d{2,3}|2[AB])$/.test(s)))];
}
export const ENRICH_KINDS:EventKind[]=['CREATION','ETABLISSEMENT','TRANSFERT_SIEGE','VENTE_FONDS'];
// The two days before today (Paris): the BODACC of a day is complete the day after; replaying a day stores nothing twice.
export function collectConfigFrom(env:Env,at:Date,rt:Pick<CollectConfig,'deadline'|'now'|'sleep'>):CollectConfig{
 const today=parisDate(at);
 const departments=enrichDepartments(env);
 return {days:[addDays(today,-1),addDays(today,-2)],enrich:departments.length?{departments,kinds:ENRICH_KINDS,since:addDays(today,-30),limit:400}:null,...rt};
}
// The enrichment job alone (app/api/cron/enrich/[slot]): the same departments, kinds and 30-day horizon, a full minute
// per run. Null when the collection is off or no department is listed.
export function enrichConfigFrom(env:Env,at:Date,rt:Pick<CollectConfig,'deadline'|'now'|'sleep'>):EnrichConfig|null{
 const departments=enrichDepartments(env);
 if(!publicEventsEnabled(env)||!departments.length)return null;
 return {enrich:{departments,kinds:ENRICH_KINDS,since:addDays(parisDate(at),-30),limit:400},...rt};
}
