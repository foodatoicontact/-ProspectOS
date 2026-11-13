// Rate limit of the public demo page: a fixed window per client address, kept in this server instance's memory.
// It bounds what one address can ask of one instance (guessing tokens, hammering the page) without writing anything:
// loading the page must change nothing but the view counter. Tokens carry 256 random bits, so guessing is not the
// threat; load is. Several instances each keep their own count — a platform-level rule is the complement (audit lot 2).
export type RateLimiter={hit(key:string,now?:number):{allowed:boolean;retryAfterSeconds:number}};
export function createRateLimiter(o:{limit:number;windowMs:number;maxKeys?:number}):RateLimiter{
 const seen=new Map<string,{start:number;count:number}>();const maxKeys=o.maxKeys??5000;
 return {hit(key,now=Date.now()){
  const cur=seen.get(key);
  if(!cur||now-cur.start>=o.windowMs){
   if(seen.size>=maxKeys){for(const [k,v] of seen)if(now-v.start>=o.windowMs)seen.delete(k);if(seen.size>=maxKeys)seen.delete(seen.keys().next().value as string)}
   seen.delete(key);seen.set(key,{start:now,count:1});return {allowed:true,retryAfterSeconds:0};
  }
  cur.count++;
  return cur.count<=o.limit?{allowed:true,retryAfterSeconds:0}:{allowed:false,retryAfterSeconds:Math.max(1,Math.ceil((cur.start+o.windowMs-now)/1000))};
 }};
}
// The client address as the platform reports it (Vercel sets both headers); never trusted for anything but this count.
export function clientKey(headers:{get(name:string):string|null}):string{
 const real=(headers.get('x-real-ip')??'').trim();if(real)return real.slice(0,64);
 const first=(headers.get('x-forwarded-for')??'').split(',')[0]!.trim();
 return (first||'unknown').slice(0,64);
}
