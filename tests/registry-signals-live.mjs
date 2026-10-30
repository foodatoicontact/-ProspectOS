// Signaux SIRENE — OPTIONAL integration test on a real postal code, against the real API Recherche d'entreprises and
// Google Places. Disabled by default: it runs only with REGISTRY_SIGNALS_LIVE=1 (and GOOGLE_PLACES_API_KEY for the
// Google part). It checks invariants on real data, not a count of companies (which changes every day):
//   every signal is recent, in the postal code, in the preset's activities, every field has its source(s) and its
//   confidence, a place ID only for a confirmed match, no global score.
//   REGISTRY_SIGNALS_LIVE=1 GOOGLE_PLACES_API_KEY=… npm run test:registry-signals-live [-- 33185 commerce_ouverture 20]
import {strict as assert} from 'node:assert';
import {loadPresets} from '../src/registry-signals/presets.ts';
import {registrySignalsConfig} from '../src/registry-signals/config.ts';
import {RateLimiter} from '../src/registry-signals/limiter.ts';
import {MemoryCache} from '../src/registry-signals/cache.ts';
import {runRegistrySignals} from '../src/registry-signals/service.ts';
import {isRecent} from '../src/registry-signals/sirene.ts';

if(process.env.REGISTRY_SIGNALS_LIVE!=='1'){console.log('SKIP registry-signals-live (set REGISTRY_SIGNALS_LIVE=1 to run it on the real APIs)');process.exit(0)}
const [postalCode='33185',presetKey='commerce_ouverture',max='20']=process.argv.slice(2);
const c=registrySignalsConfig(process.env);const preset=loadPresets(process.env)[presetKey];assert.ok(preset,`unknown preset ${presetKey}`);
const lim=ms=>new RateLimiter({minIntervalMs:ms,maxRetries:c.maxRetries,backoffBaseMs:c.backoffBaseMs,backoffMaxMs:c.backoffMaxMs});
const now=new Date();
const {signals,report}=await runRegistrySignals({preset,postalCode,maxResults:Number(max),now},{
 sirene:{limiter:lim(c.sireneMinIntervalMs),cache:new MemoryCache(),ttlSeconds:c.sireneCacheTtlS},
 places:c.placesApiKey?{apiKey:c.placesApiKey,limiter:lim(c.placesMinIntervalMs),cache:new MemoryCache(),ttlSeconds:c.placesCacheTtlS}:null,
 log:line=>console.error(JSON.stringify(line))});
for(const s of signals){
 assert.ok(isRecent(s.date_creation,preset.max_age_days,now),`${s.siret} recent`);
 assert.equal(s.code_postal,postalCode);assert.ok(preset.naf_codes.includes(s.activite_principale),`${s.siret} activity`);
 for(const f of ['siren','siret','denomination','activite_principale','date_creation','adresse','code_postal']){
  assert.ok(s.sources[f]?.length&&s.sources[f].every(u=>u.startsWith('https://')),`${s.siret} ${f} source`);assert.equal(s.confiance[f],'verifie');
 }
 assert.equal(s.confiance['google.statut_match'],'estime');
 assert.equal(s.google.place_id!==null,s.google.statut_match==='confirme',`${s.siret} place ID only when confirmed`);
 assert.equal('score' in s,false);
}
const p=report.places;
console.log(JSON.stringify({postal_code:postalCode,preset:presetKey,found:report.found,returned:report.returned,
 confirme:p?.confirme??null,non_confirme:p?.non_confirme??null,absent:p?.absent??null,places_failures:p?.failures??null,sirene:report.sirene},null,1));
console.log(`PASS registry-signals-live: ${signals.length} signals checked`);
