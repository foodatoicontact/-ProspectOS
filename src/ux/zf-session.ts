// Zero-Friction ZF1 — one measurement session per page load. Interactions = TRUSTED user clicks and form submits only
// (event.isTrusted): renders, data loads, polling and automatic recomputations never count. Each ZF event is sent once
// per session with the elapsed time and the interaction count at that moment.
import type {ZfKind} from '../server/ux-events.ts';
export type ZfSender=(kind:ZfKind,elapsedMs:number,interactions:number,sessionId:string)=>void;
const INTERACTIVE='button,a,[role="button"],select,summary,input[type="checkbox"],input[type="radio"]';
export class ZfSession{
 readonly id:string;private start:number;private count=0;private sent=new Set<ZfKind>();private send:ZfSender;private clock:()=>number;
 // startAt: the moment the app was opened (performance.now() origin in the browser), so times run from OPEN APP.
 constructor(send:ZfSender,id:string,clock:()=>number=()=>Date.now(),startAt?:number){this.send=send;this.id=id;this.clock=clock;this.start=startAt??clock()}
 get interactions(){return this.count}
 // Counts one interaction for a trusted event on an interactive element (or a form submit).
 observe(e:{isTrusted:boolean;type:string;target:unknown}):boolean{
  if(!e.isTrusted)return false;
  const t=e.target as {closest?:(s:string)=>unknown}|null;
  if(e.type==='submit'||(e.type==='click'&&typeof t?.closest==='function'&&t.closest(INTERACTIVE))){this.count++;return true}
  return false;
 }
 emit(kind:ZfKind):boolean{
  if(this.sent.has(kind))return false;
  this.sent.add(kind);
  this.send(kind,Math.max(0,Math.round(this.clock()-this.start)),this.count,this.id);
  return true;
 }
 has(kind:ZfKind){return this.sent.has(kind)}
}
// The exact request the browser sends for one ZF event (POST /api/v1/zf-events, body checked by ZfEventBody on the
// server). No project yet → nothing is sent (a session before any project has nothing to attach the event to).
export function zfEventRequest(kind:ZfKind,elapsedMs:number,interactions:number,sessionId:string,projectId:string):{path:'zf-events';method:'POST';body:Record<string,unknown>}|null{
 if(!projectId)return null;
 return {path:'zf-events',method:'POST',body:{kind,project_id:projectId,session_id:sessionId,elapsed_ms:elapsedMs,interactions}};
}
