import {parseSimEvent,simLogLine,SIM_EVENT_MAX_BYTES} from '../../../../src/simulator/events.ts';
// Public simulator V1 — funnel analytics, log only. The body must be one event of the closed schema (no free text, no
// personal data); it is written as ONE structured log line. No database client, no external call, no visitor
// identifier read from the request. Anything else is refused and never logged.
export const dynamic='force-dynamic';
const headers={'cache-control':'no-store'};
export async function POST(request:Request){
 const declared=Number(request.headers.get('content-length')??0);
 if(declared>SIM_EVENT_MAX_BYTES)return new Response(null,{status:413,headers});
 const text=await request.text();
 if(new TextEncoder().encode(text).length>SIM_EVENT_MAX_BYTES)return new Response(null,{status:413,headers});
 let raw:unknown;try{raw=JSON.parse(text)}catch{return new Response(null,{status:400,headers})}
 const event=parseSimEvent(raw);
 if(!event)return new Response(null,{status:400,headers});
 console.info(simLogLine(event,new Date()));
 return new Response(null,{status:204,headers});
}
export async function GET(){return new Response(null,{status:405,headers:{...headers,allow:'POST'}})}
