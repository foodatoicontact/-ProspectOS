// Signaux SIRENE — one real search printed as JSON (no database, nothing saved, nothing sent): what the API would
// return to the person launching it. Needs network access to recherche-entreprises.api.gouv.fr and places.googleapis.com.
//   GOOGLE_PLACES_API_KEY=… node --experimental-strip-types scripts/registry-signals-run.ts 33185 commerce_ouverture 20 > out.json
// The summary (counts by match status, exclusions) goes to stderr; the signals to stdout.
import {loadPresets} from '../src/registry-signals/presets.ts';
import {registrySignalsConfig} from '../src/registry-signals/config.ts';
import {RateLimiter} from '../src/registry-signals/limiter.ts';
import {MemoryCache} from '../src/registry-signals/cache.ts';
import {runRegistrySignals} from '../src/registry-signals/service.ts';

const [postalCode='33185',presetKey='commerce_ouverture',max='20']=process.argv.slice(2);
const c=registrySignalsConfig(process.env);const preset=loadPresets(process.env)[presetKey];
if(!preset){console.error(`Preset inconnu : ${presetKey}`);process.exit(2)}
if(!c.placesApiKey)console.error('GOOGLE_PLACES_API_KEY absente : les signaux sortent sans vérification Google.');
const lim=(ms:number)=>new RateLimiter({minIntervalMs:ms,maxRetries:c.maxRetries,backoffBaseMs:c.backoffBaseMs,backoffMaxMs:c.backoffMaxMs});
const {signals,report}=await runRegistrySignals({preset,postalCode,maxResults:Number(max),now:new Date()},{
 sirene:{limiter:lim(c.sireneMinIntervalMs),cache:new MemoryCache(),ttlSeconds:c.sireneCacheTtlS},
 places:c.placesApiKey?{apiKey:c.placesApiKey,limiter:lim(c.placesMinIntervalMs),cache:new MemoryCache(),ttlSeconds:c.placesCacheTtlS}:null,
 log:line=>console.error(JSON.stringify(line))});
console.error(JSON.stringify({postal_code:postalCode,preset:presetKey,found:report.found,returned:report.returned,places:report.places,sirene:report.sirene},null,1));
console.log(JSON.stringify(signals,null,1));
