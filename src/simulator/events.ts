// Public simulator V1 — funnel analytics, a closed schema. Five kinds; every value is an enum, a bounded number, a boolean
// or the tab's random id. Never the offer text, the target text, a matched word, personal data or generated content.
// The endpoint only writes one structured log line (V1: no table, no migration, no database client).
import {z} from 'zod';
import {SCENARIO_IDS,REGION_CODES,SIM_MAX_PROSPECTS} from './types.ts';

export const SIM_EVENT_KINDS=['simulator.viewed','simulator.started','simulator.completed','simulator.prospect_opened','simulator.signup_clicked'] as const;
export const SIM_EVENT_ENDPOINT='/api/public/simulator-event';
export const SIM_EVENT_MAX_BYTES=1024;

const sid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const scenario_id=z.enum(SCENARIO_IDS);
const slot=z.number().int().min(1).max(SIM_MAX_PROSPECTS);
export const SimEventSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('simulator.viewed'),sid}),
 z.strictObject({kind:z.literal('simulator.started'),sid,region:z.enum(REGION_CODES as [string,...string[]])}),
 z.strictObject({kind:z.literal('simulator.completed'),sid,scenario_id,fallback:z.boolean(),prospects:z.number().int().min(0).max(SIM_MAX_PROSPECTS)}),
 z.strictObject({kind:z.literal('simulator.prospect_opened'),sid,scenario_id,slot}),
 z.strictObject({kind:z.literal('simulator.signup_clicked'),sid,scenario_id,slot:slot.optional()}),
]);
export type SimEvent=z.infer<typeof SimEventSchema>;
export function parseSimEvent(raw:unknown):SimEvent|null{const r=SimEventSchema.safeParse(raw);return r.success?r.data:null}
export function simLogLine(e:SimEvent,at:Date):string{return JSON.stringify({type:'simulator_event',at:at.toISOString(),...e})}

// Browser side — the tab's random id (sessionStorage only), and a best-effort beacon that never blocks the visitor.
const SID_KEY='prospectos.simulator.sid';
export function tabSid():string{
 try{const kept=sessionStorage.getItem(SID_KEY);if(kept&&sid.safeParse(kept).success)return kept;const id=crypto.randomUUID();sessionStorage.setItem(SID_KEY,id);return id}
 catch{return crypto.randomUUID()}
}
export function sendSimEvent(e:SimEvent):void{
 const event=parseSimEvent(e);if(!event)return;
 const body=JSON.stringify(event);
 try{if(navigator.sendBeacon(SIM_EVENT_ENDPOINT,new Blob([body],{type:'application/json'})))return}catch{/* fall through */}
 try{void fetch(SIM_EVENT_ENDPOINT,{method:'POST',keepalive:true,headers:{'content-type':'application/json'},body}).catch(()=>{})}catch{/* best effort */}
}
