// Signaux SIRENE — request pacing for one source. Requests go out one after another, at least `minIntervalMs` apart
// (API Recherche d'entreprises: about 7 per second, so 150 ms by default). A 429 is sent again after an exponential
// backoff (base × 2^attempt, capped), or after the source's Retry-After when it asks for longer; after `maxRetries`
// the 429 is returned as is — the caller reports it, never hides it. Time is injectable for tests.
export type LimiterOptions={minIntervalMs:number;maxRetries:number;backoffBaseMs:number;backoffMaxMs:number;
 wait?:(ms:number)=>Promise<void>;now?:()=>number};
export type SendStats={sent:number;retried:number};

// Retry-After in seconds or as an HTTP date; null when missing or unreadable.
export function retryAfterMs(header:string|null,now:number):number|null{
 const v=header?.trim()??'';if(!v)return null;
 if(/^\d+$/.test(v))return Number(v)*1000;
 const at=Date.parse(v);return Number.isFinite(at)?Math.max(0,at-now):null;
}
export function backoffDelay(attempt:number,o:Pick<LimiterOptions,'backoffBaseMs'|'backoffMaxMs'>,retryAfter:number|null):number{
 const exp=Math.min(o.backoffMaxMs,o.backoffBaseMs*2**attempt);
 return Math.min(o.backoffMaxMs,Math.max(exp,retryAfter??0));
}

export class RateLimiter{
 readonly stats:SendStats={sent:0,retried:0};
 private last=-Infinity;private queue:Promise<unknown>=Promise.resolve();
 private readonly o:LimiterOptions;private readonly wait:(ms:number)=>Promise<void>;private readonly now:()=>number;
 constructor(o:LimiterOptions){this.o=o;this.wait=o.wait??(ms=>new Promise(r=>setTimeout(r,ms)));this.now=o.now??Date.now}
 // One request (built afresh for each attempt), paced and retried on 429. Calls are serialised.
 send(request:()=>Promise<Response>):Promise<Response>{
  const run=this.queue.then(()=>this.attempts(request));this.queue=run.catch(()=>undefined);return run;
 }
 private async paced(request:()=>Promise<Response>):Promise<Response>{
  const gap=this.last+this.o.minIntervalMs-this.now();if(gap>0)await this.wait(gap);
  this.last=this.now();this.stats.sent++;return request();
 }
 private async attempts(request:()=>Promise<Response>):Promise<Response>{
  for(let attempt=0;;attempt++){
   const res=await this.paced(request);
   if(res.status!==429||attempt>=this.o.maxRetries)return res;
   const delay=backoffDelay(attempt,this.o,retryAfterMs(res.headers.get('retry-after'),this.now()));
   await res.body?.cancel().catch(()=>{});this.stats.retried++;await this.wait(delay);
  }
 }
}
