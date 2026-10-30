// Signaux SIRENE — server settings, from the environment, each with a safe default. No secret is ever logged: the
// Google key is only checked for presence here.
export type RegistrySignalsConfig={enabled:boolean;placesApiKey:string;sireneCacheTtlS:number;placesCacheTtlS:number;sireneMinIntervalMs:number;
 placesMinIntervalMs:number;maxRetries:number;backoffBaseMs:number;backoffMaxMs:number};

const int=(v:string|undefined,fallback:number,min:number,max:number)=>{const n=Number(v);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback};

export function registrySignalsConfig(env:Record<string,string|undefined>=process.env):RegistrySignalsConfig{
 const flag=(env.REGISTRY_SIGNALS_ENABLED??'').trim().toLowerCase();
 return {
  enabled:flag==='true'||flag==='1',
  placesApiKey:(env.GOOGLE_PLACES_API_KEY??'').trim(),
  // Register pages change slowly: one day by default. Google content: one hour, in memory only (see cache.ts).
  sireneCacheTtlS:int(env.REGISTRY_SIGNALS_SIRENE_CACHE_TTL_S,86_400,0,30*86_400),
  placesCacheTtlS:int(env.REGISTRY_SIGNALS_PLACES_CACHE_TTL_S,3_600,0,86_400),
  // About 7 requests per second for the register API (shared egress IPs: 429s handled by the backoff).
  sireneMinIntervalMs:int(env.REGISTRY_SIGNALS_SIRENE_MIN_INTERVAL_MS,150,100,5_000),
  placesMinIntervalMs:int(env.REGISTRY_SIGNALS_PLACES_MIN_INTERVAL_MS,100,0,5_000),
  maxRetries:int(env.REGISTRY_SIGNALS_MAX_RETRIES,4,0,8),
  backoffBaseMs:int(env.REGISTRY_SIGNALS_BACKOFF_BASE_MS,500,50,10_000),
  backoffMaxMs:int(env.REGISTRY_SIGNALS_BACKOFF_MAX_MS,8_000,100,60_000),
 };
}
