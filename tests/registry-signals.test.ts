// Signaux SIRENE (src/registry-signals): creation-date filter and register exclusions, Google matching, the rate
// limiter and backoff, the Places lookup, the signal format (sources and confidence per field) and the stored form.
// Every source is mocked: no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fold,nameTokens,addressParts} from '../src/registry-signals/normalize.ts';
import {matchPlace,namesMatch,type PlaceCandidate} from '../src/registry-signals/match.ts';
import {RateLimiter,backoffDelay,retryAfterMs} from '../src/registry-signals/limiter.ts';
import {MemoryCache} from '../src/registry-signals/cache.ts';
import {isRecent,looksDomiciled,recentEstablishments,searchRecentEstablishments,sireneUrl,type SireneCompany,type Exclusion} from '../src/registry-signals/sirene.ts';
import {lookupPlace,placesQuery,PLACES_SEARCH_ENDPOINT} from '../src/registry-signals/places.ts';
import {buildSignal,toStoredSignal,probableTrade} from '../src/registry-signals/signal.ts';
import {runRegistrySignals,runAndStoreRegistrySignals} from '../src/registry-signals/service.ts';
import {CANDIDATE_ROW_FIELDS,type CandidateRow} from '../src/registry-signals/row.ts';
import type {Preset} from '../src/registry-signals/presets.ts';

const NOW=new Date('2026-10-30T09:00:00Z');
const PRESET:Preset={key:'commerce_ouverture',label:'Ouverture de commerce',max_age_days:92,naf_codes:['56.10A','56.10C','47.24Z','96.02A'],name_keywords:[],ambiguities:[]};
const site=(o:Record<string,unknown>={})=>({siret:'12345678900011',activite_principale:'56.10A',etat_administratif:'A',statut_diffusion_etablissement:'O',
 date_creation:'2026-09-15',date_fermeture:null,adresse:'12 AVENUE DE MAGUDAS 33185 LE HAILLAN',code_postal:'33185',libelle_commune:'LE HAILLAN',
 liste_enseignes:['LA TABLE DU HAILLAN'],nom_commercial:null,est_siege:true,...o});
const company=(o:Partial<SireneCompany>={},s:Record<string,unknown>={}):SireneCompany=>({siren:'123456789',nom_complet:'SAS GOURMET 33',nom_raison_sociale:'SAS GOURMET 33',
 statut_diffusion:'O',etat_administratif:'A',activite_principale:'56.10A',date_creation:'2026-09-01',siege:null,matching_etablissements:[site(s)],...o});
const place=(o:Partial<PlaceCandidate>={}):PlaceCandidate=>({id:'ChIJ_table',name:'La Table du Haillan',formattedAddress:'12 Av. de Magudas, 33185 Le Haillan, France',
 postalCode:'33185',streetNumber:'12',route:'Avenue de Magudas',businessStatus:'OPERATIONAL',...o});
const REG={names:['SAS GOURMET 33','LA TABLE DU HAILLAN'],address:'12 AVENUE DE MAGUDAS 33185 LE HAILLAN',postalCode:'33185',commune:'LE HAILLAN'};
const json=(body:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const fakeClock=()=>{let t=0;const waits:number[]=[];return {now:()=>t,wait:async(ms:number)=>{waits.push(ms);t+=ms},waits}};
const limiter=(o:Partial<ConstructorParameters<typeof RateLimiter>[0]>={})=>{const c=fakeClock();return {c,l:new RateLimiter({minIntervalMs:150,maxRetries:3,backoffBaseMs:500,backoffMaxMs:8000,wait:c.wait,now:c.now,...o})}};

// ── Normalisation (French) ────────────────────────────────────────────────────────────────────────────────────────────
test('normalise — accents, case, apostrophes and legal forms never decide a match',()=>{
 assert.equal(fold('Crêperie de l’Écluse & Cie'),'creperie de l ecluse et cie');
 assert.deepEqual(nameTokens('SARL Les Délices d’Aïcha'),['delices','aicha']);
 assert.deepEqual(addressParts('12 B AV DE MAGUDAS 33185 LE HAILLAN'),{number:'12',street:['avenue','magudas'],postalCode:'33185'});
 assert.deepEqual(addressParts('12 Av. de Magudas, 33185 Le Haillan, France'),{number:'12',street:['avenue','magudas'],postalCode:'33185'});
});

// ── Creation-date filter and register exclusions ──────────────────────────────────────────────────────────────────────
test('date filter — within max_age_days, today included; never a future or malformed date',()=>{
 assert.equal(isRecent('2026-10-30',92,NOW),true);
 assert.equal(isRecent('2026-07-30',92,NOW),true);// 92 days ago exactly
 assert.equal(isRecent('2026-07-29',92,NOW),false);
 assert.equal(isRecent('2026-10-31',92,NOW),false,'future');
 assert.equal(isRecent('2026-13-01',92,NOW),false);assert.equal(isRecent('30/10/2026',92,NOW),false);assert.equal(isRecent(null,92,NOW),false);
});
test('register — closed, non-diffusible, other postal code or activity, old and domiciled establishments are excluded and counted',()=>{
 const counts:Partial<Record<Exclusion,number>>={};const count=(e:Exclusion)=>{counts[e]=(counts[e]??0)+1};
 const keep=recentEstablishments(company(),PRESET,'33185',NOW,count);
 assert.equal(keep.length,1);assert.deepEqual(keep[0]!.signs,['LA TABLE DU HAILLAN']);assert.equal(keep[0]!.date_creation,'2026-09-15');
 assert.equal(keep[0]!.source_url,'https://annuaire-entreprises.data.gouv.fr/etablissement/12345678900011');
 const cases:Array<[SireneCompany,Exclusion]>=[
  [company({},{etat_administratif:'F'}),'ESTABLISHMENT_CLOSED'],[company({},{date_fermeture:'2026-10-01'}),'ESTABLISHMENT_CLOSED'],
  [company({statut_diffusion:'P'}),'NOT_PUBLICLY_DIFFUSIBLE'],[company({},{statut_diffusion_etablissement:'P'}),'NOT_PUBLICLY_DIFFUSIBLE'],
  [company({etat_administratif:'C'}),'COMPANY_NOT_ACTIVE'],[company({},{code_postal:'33700'}),'OTHER_POSTAL_CODE'],
  [company({},{activite_principale:'47.91A'}),'OTHER_ACTIVITY'],[company({},{date_creation:'2025-01-10'}),'TOO_OLD'],
  [company({},{complement_adresse:'C/O DOMICILIATION SERVICES'}),'DOMICILIATION_SUSPECTED'],[company({activite_principale:'82.11Z'}),'DOMICILIATION_SUSPECTED'],
 ];
 for(const [c,reason] of cases){const n:Partial<Record<Exclusion,number>>={};assert.equal(recentEstablishments(c,PRESET,'33185',NOW,e=>{n[e]=(n[e]??0)+1}).length,0,reason);assert.equal(n[reason],1,reason)}
 assert.equal(looksDomiciled(company(),site()),false,'an ordinary address is not a domiciliation');
});
test('register request — postal code, NAF list, active only, and never the officers (minimal + include)',()=>{
 const u=sireneUrl(PRESET,'33185',2);
 assert.equal(u.origin+u.pathname,'https://recherche-entreprises.api.gouv.fr/search');
 for(const [k,v] of Object.entries({code_postal:'33185',activite_principale:'56.10A,56.10C,47.24Z,96.02A',etat_administratif:'A',minimal:'true',include:'siege,matching_etablissements',per_page:'25',page:'2'}))assert.equal(u.searchParams.get(k),v,k);
 assert.doesNotMatch(u.toString(),/dirigeants/);
});
test('register search — reads every page, filters the date here, de-duplicates by SIRET, caches pages',async()=>{
 const pages=[{results:[company(),company({siren:'987654321'},{siret:'98765432100015',date_creation:'2024-02-02'})],total_pages:2,total_results:3},
  {results:[company()],total_pages:2,total_results:3}];
 const urls:string[]=[];const fetchMock=(async(url:URL)=>{urls.push(String(url));return json(pages[Number(url.searchParams.get('page'))-1])}) as unknown as typeof fetch;
 const cache=new MemoryCache(()=>0);const {l}=limiter();
 const deps={limiter:l,cache,ttlSeconds:3600,fetch:fetchMock};
 const first=await searchRecentEstablishments({...PRESET},'33185',NOW,deps);
 assert.equal(urls.length,2);assert.equal(first.establishments.length,1,'the 2024 one is too old, the repeated one counted once');
 assert.equal(first.report.excluded.TOO_OLD,1);assert.equal(first.report.pages,2);assert.equal(first.report.examined,3);
 const again=await searchRecentEstablishments({...PRESET},'33185',NOW,deps);
 assert.equal(urls.length,2,'second search served by the cache');assert.equal(again.report.cache_hits,2);
});
test('register search — a failure is explicit: no page read throws, a later failing page keeps what was read',async()=>{
 const {l}=limiter({maxRetries:0});
 await assert.rejects(searchRecentEstablishments(PRESET,'33185',NOW,{limiter:l,cache:new MemoryCache(),ttlSeconds:0,fetch:(async()=>json({},500)) as unknown as typeof fetch}),/SIRENE_HTTP_500/);
 let n=0;const r=await searchRecentEstablishments(PRESET,'33185',NOW,{limiter:limiter({maxRetries:0}).l,cache:new MemoryCache(),ttlSeconds:0,
  fetch:(async()=>++n===1?json({results:[company()],total_pages:3}):json({},503)) as unknown as typeof fetch});
 assert.equal(r.establishments.length,1);assert.equal(r.report.failure,'SIRENE_HTTP_503');
 await assert.rejects(searchRecentEstablishments(PRESET,'3318',NOW,{limiter:l,cache:new MemoryCache(),ttlSeconds:0}),/INVALID_POSTAL_CODE/);
});

// ── Rate limiter ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('limiter — requests at least minIntervalMs apart, one after another',async()=>{
 const {c,l}=limiter();const at:number[]=[];
 await Promise.all([1,2,3].map(()=>l.send(async()=>{at.push(c.now());return json({})})));
 assert.deepEqual(at,[0,150,300]);assert.equal(l.stats.sent,3);
});
test('limiter — exponential backoff on 429 (or Retry-After when longer), capped, then the 429 is returned',async()=>{
 assert.deepEqual([0,1,2,3,4,5].map(a=>backoffDelay(a,{backoffBaseMs:500,backoffMaxMs:8000},null)),[500,1000,2000,4000,8000,8000]);
 assert.equal(backoffDelay(0,{backoffBaseMs:500,backoffMaxMs:8000},3000),3000);assert.equal(backoffDelay(0,{backoffBaseMs:500,backoffMaxMs:8000},60000),8000);
 assert.equal(retryAfterMs('2',0),2000);assert.equal(retryAfterMs('',0),null);assert.equal(retryAfterMs('soon',0),null);
 {const {c,l}=limiter();let n=0;
  const res=await l.send(async()=>++n<3?json({},429):json({ok:true}));
  assert.equal(res.status,200);assert.equal(n,3);assert.equal(l.stats.retried,2);assert.deepEqual(c.waits,[500,1000],'backoff only (the backoff exceeds the pacing)')}
 {const {c,l}=limiter();let n=0;await l.send(async()=>++n<2?json({},429,{'retry-after':'3'}):json({}));assert.deepEqual(c.waits,[3000])}
 {const {l}=limiter({maxRetries:2});let n=0;const res=await l.send(async()=>{n++;return json({},429)});assert.equal(res.status,429);assert.equal(n,3,'1 + 2 retries')}
});

// ── Google matching (prudent) ─────────────────────────────────────────────────────────────────────────────────────────
test('match — confirmed only when the name AND the address match clearly',()=>{
 assert.deepEqual(matchPlace(REG,[place()]).status,'confirme');
 assert.equal(matchPlace(REG,[place({name:'LA TABLE DU HAILLAN — Restaurant'})]).status,'confirme','accents and suffixes ignored');
 assert.equal(matchPlace(REG,[]).status,'absent');
 assert.deepEqual(matchPlace(REG,[place({name:'Le Bistrot du Coin'})]),{status:'non_confirme',reason:'NAME_MISMATCH',place:null});
 assert.deepEqual(matchPlace(REG,[place({streetNumber:'14',formattedAddress:'14 Av. de Magudas, 33185 Le Haillan'})]),{status:'non_confirme',reason:'ADDRESS_MISMATCH',place:null});
 assert.equal(matchPlace(REG,[place({postalCode:'33700',formattedAddress:'12 Av. de Magudas, 33700 Mérignac'})]).reason,'ADDRESS_MISMATCH');
 assert.equal(matchPlace(REG,[place(),place({id:'ChIJ_other'})]).reason,'AMBIGUOUS','two places fit: no choice is made');
 assert.equal(matchPlace(REG,[place(),place()]).status,'confirme','the same place twice is one place');
 assert.equal(matchPlace(REG,[place({businessStatus:'CLOSED_PERMANENTLY'})]).reason,'PLACE_CLOSED');
});
test('match — generic activity words and the commune never make two names the same',()=>{
 assert.equal(namesMatch(['PIZZA DU CENTRE'],'Pizza Napoli'),false);
 assert.equal(namesMatch(['COIFFURE DU HAILLAN'],'Coiffure Haillan Style','LE HAILLAN'),false,'only generic and commune words shared');
 assert.equal(namesMatch(['DUPONT JEAN'],'Boulangerie Dupont'),false,'a person name half found is not a match');
 assert.equal(namesMatch(['LES DELICES D AICHA'],'Les Délices d’Aïcha'),true);
 // Without a house number in the register, the whole street must agree.
 const noNumber={...REG,address:'CENTRE COMMERCIAL LE HAILLAN 33185 LE HAILLAN'};
 assert.equal(matchPlace(noNumber,[place({formattedAddress:'Centre Commercial, 33185 Le Haillan',streetNumber:null,route:null})]).status,'non_confirme');
});

// ── Places lookup ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('places — sign first then legal name, key in the header only, field mask, cache',async()=>{
 const calls:Array<{url:string;init:RequestInit}>=[];
 const fetchMock=(async(url:string,init:RequestInit)=>{calls.push({url,init});const q=JSON.parse(String(init.body)).textQuery as string;
  return json({places:q.startsWith('LA TABLE')?[{id:'ChIJ_table',displayName:{text:'La Table du Haillan'},formattedAddress:'12 Av. de Magudas, 33185 Le Haillan, France',
   addressComponents:[{longText:'12',types:['street_number']},{longText:'Avenue de Magudas',types:['route']},{longText:'33185',types:['postal_code']}],
   rating:4.6,userRatingCount:38,websiteUri:'https://latable.example',regularOpeningHours:{weekdayDescriptions:['lundi: Fermé']},googleMapsUri:'https://maps.google.com/?cid=1',businessStatus:'OPERATIONAL'}]:[]})}) as unknown as typeof fetch;
 const deps={apiKey:'SECRET-KEY-123',limiter:limiter().l,cache:new MemoryCache(()=>0),ttlSeconds:3600,fetch:fetchMock};
 const r=await lookupPlace(REG,['LA TABLE DU HAILLAN','SAS GOURMET 33'],deps);
 assert.equal(r.status,'confirme');assert.equal(r.place?.rating,4.6);assert.equal(calls.length,1,'confirmed on the sign: the legal name is not queried');
 assert.equal(calls[0]!.url,PLACES_SEARCH_ENDPOINT);assert.doesNotMatch(calls[0]!.url,/SECRET/);
 const h=calls[0]!.init.headers as Record<string,string>;assert.equal(h['x-goog-api-key'],'SECRET-KEY-123');assert.match(h['x-goog-fieldmask']!,/places\.id/);
 assert.deepEqual(JSON.parse(String(calls[0]!.init.body)),{textQuery:placesQuery('LA TABLE DU HAILLAN',REG.address),languageCode:'fr',regionCode:'FR',pageSize:5});
 await lookupPlace(REG,['LA TABLE DU HAILLAN'],deps);assert.equal(calls.length,1,'cached');
 const miss=await lookupPlace(REG,['INCONNU SARL','SAS GOURMET 33'],{...deps,cache:new MemoryCache()});
 assert.equal(miss.status,'absent');assert.equal(miss.queries.length,2);
 await assert.rejects(lookupPlace(REG,['X'],{...deps,apiKey:''}),/PLACES_NOT_CONFIGURED/);
 const refused=await lookupPlace(REG,['X'],{...deps,cache:new MemoryCache(),fetch:(async()=>json({error:{}},403)) as unknown as typeof fetch});
 assert.equal(refused.failure,'PLACES_HTTP_403');assert.equal(refused.place,null);
});

// ── Signal format ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('signal — every field has its source URL(s) and a per-field confidence; Google values only for a confirmed place',()=>{
 const [e]=recentEstablishments(company(),PRESET,'33185',NOW,()=>{});
 const p={id:'ChIJ_table',name:'La Table du Haillan',formattedAddress:null,postalCode:'33185',streetNumber:'12',route:'Avenue de Magudas',businessStatus:'OPERATIONAL',
  rating:4.6,ratingCount:38,website:'https://latable.example',openingHours:['lundi: Fermé'],mapsUrl:'https://maps.google.com/?cid=1'};
 const s=buildSignal(e!,{status:'confirme',reason:'NAME_AND_ADDRESS_MATCH',place:p,queries:[],failure:null},[],NOW);
 for(const f of ['siren','siret','denomination','activite_principale','date_creation','adresse','code_postal'])
  {assert.equal(s.confiance[f],'verifie',f);assert.ok(s.sources[f]!.every(u=>u.startsWith('https://annuaire-entreprises.data.gouv.fr/')),f)}
 assert.equal(s.confiance['google.statut_match'],'estime','a match is a rule, never a certainty');
 assert.deepEqual([s.google.place_id,s.google.note,s.google.nb_avis,s.google.site],['ChIJ_table',4.6,38,'https://latable.example']);
 assert.deepEqual(s.sources['google.note'],['https://maps.google.com/?cid=1']);assert.equal(s.detecte_le,NOW.toISOString());
 assert.equal(Object.keys(s).includes('score'),false,'never a global score');
 const doubt=buildSignal(e!,{status:'non_confirme',reason:'ADDRESS_MISMATCH',place:null,queries:[],failure:null},[],NOW);
 assert.deepEqual([doubt.google.place_id,doubt.google.note,doubt.google.statut_match],[null,null,'non_confirme']);
 assert.equal(doubt.sources['google.note'],undefined);
 const stored=toStoredSignal(s);
 assert.deepEqual([stored.google.note,stored.google.nb_avis,stored.google.site,stored.google.horaires],[null,null,null,[]],'Google content is never stored');
 assert.equal(stored.google.place_id,'ChIJ_table');assert.equal(stored.google.fiche,'https://www.google.com/maps/place/?q=place_id:ChIJ_table');
 assert.deepEqual(Object.keys(stored.sources).filter(k=>k.startsWith('google.')).sort(),['google.place_id','google.statut_match']);
 assert.equal(probableTrade(['CABINET D OSTEOPATHIE MARTIN'],['osteopathie','psychologue']),'osteopathie');
 assert.equal(probableTrade(['MARTIN CLAIRE'],['osteopathie']),null);
});

// ── One run ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test('run — most recent first, at most maxResults looked up; a refused Google key stops the lookups and keeps register data',async()=>{
 const results=[company(),company({siren:'222222222',nom_raison_sociale:'BOULANGERIE NOUVELLE',nom_complet:'BOULANGERIE NOUVELLE'},{siret:'22222222200019',date_creation:'2026-10-20',activite_principale:'47.24Z',liste_enseignes:[]}),
  company({siren:'333333333',nom_raison_sociale:'COIFF ET VOUS',nom_complet:'COIFF ET VOUS'},{siret:'33333333300017',date_creation:'2026-08-05',activite_principale:'96.02A',liste_enseignes:[]})];
 const sirene={limiter:limiter().l,cache:new MemoryCache(),ttlSeconds:0,fetch:(async()=>json({results,total_pages:1})) as unknown as typeof fetch};
 let googleCalls=0;
 const out=await runRegistrySignals({preset:PRESET,postalCode:'33185',maxResults:2,now:NOW},
  {sirene,places:{apiKey:'k',limiter:limiter().l,cache:new MemoryCache(),ttlSeconds:0,fetch:(async()=>{googleCalls++;return json({},403)}) as unknown as typeof fetch}});
 assert.deepEqual(out.signals.map(s=>s.date_creation),['2026-10-20','2026-09-15']);assert.equal(out.report.found,3);assert.equal(out.report.returned,2);
 assert.equal(googleCalls,1,'stopped after the refusal');assert.equal(out.report.places?.failures.PLACES_HTTP_403,1);
 assert.equal(out.signals[1]!.google.raison_match,'PLACES_NOT_QUERIED');
 await assert.rejects(runRegistrySignals({preset:PRESET,postalCode:'33185',maxResults:0,now:NOW},{sirene,places:null}),/INVALID_MAX_RESULTS/);
});

// ── A stored run (API path) ───────────────────────────────────────────────────────────────────────────────────────────
const fakeRepo=(o:{failSave?:boolean;failClose?:boolean}={})=>{const calls:string[]=[];const saved:CandidateRow[]=[];let released=false;
 return {calls,saved,get released(){return released},repo:{
  start:async()=>{calls.push('start');return {id:'run-1',organization_id:'org',project_id:'prj'}},
  saveCandidates:async(_:string,rows:CandidateRow[])=>{calls.push('save');if(o.failSave)throw Error('db down');saved.push(...rows);return {inserted:rows.length,duplicates:0}},
  complete:async(_:string,status:string)=>{calls.push(`complete:${status}`);if(o.failClose)throw Error('db down');return true},
  release:async()=>{calls.push('release');released=true;return true}}}};
const googleOk=(async()=>json({places:[{id:'ChIJ_table_haillan',displayName:{text:'La Table du Haillan'},formattedAddress:'12 Av. de Magudas, 33185 Le Haillan, France',
 addressComponents:[{longText:'12',types:['street_number']},{longText:'Avenue de Magudas',types:['route']},{longText:'33185',types:['postal_code']}],rating:4.6,userRatingCount:38,
 websiteUri:'https://latable.example',businessStatus:'OPERATIONAL'}]})) as unknown as typeof fetch;
const storedDeps=(sireneFetch:typeof fetch,repo:ReturnType<typeof fakeRepo>['repo'])=>({repo,sirene:{limiter:limiter().l,cache:new MemoryCache(),ttlSeconds:0,fetch:sireneFetch},
 places:{apiKey:'k',limiter:limiter().l,cache:new MemoryCache(),ttlSeconds:0,fetch:googleOk}});
test('stored run — NEW candidates in their stored form: register data with sources, place ID and match only',async()=>{
 const f=fakeRepo();
 const r=await runAndStoreRegistrySignals({preset:PRESET,postalCode:'33185',maxResults:20,now:NOW,projectId:'prj'},storedDeps((async()=>json({results:[company()],total_pages:1})) as unknown as typeof fetch,f.repo));
 assert.equal(r.status,'completed');assert.deepEqual(f.calls,['start','save','complete:completed']);assert.equal(r.metrics.saved,1);assert.equal(r.refunded,false);
 const row=f.saved[0]!;assert.deepEqual(Object.keys(row).sort(),[...CANDIDATE_ROW_FIELDS].sort(),'strict field list (migration 038)');
 assert.equal(row.google_place_id,'ChIJ_table_haillan');assert.equal(row.google_match_status,'confirme');
 assert.doesNotMatch(JSON.stringify(row),/4\.6|latable\.example|"38"|note|nb_avis|horaires/,'no Google content stored');
 assert.equal(r.signals[0]!.google.note,4.6,'the person launching the run sees it live');
});
test('stored run — refund only when the register answered nothing; a save or close failure is never "completed"',async()=>{
 {const f=fakeRepo();const r=await runAndStoreRegistrySignals({preset:PRESET,postalCode:'33185',maxResults:20,now:NOW,projectId:'prj'},
   storedDeps((async()=>json({},503)) as unknown as typeof fetch,f.repo));
  assert.equal(r.status,'failed');assert.equal(r.error_code,'SIRENE_HTTP_503');assert.equal(r.refunded,true);assert.deepEqual(f.calls,['start','complete:failed','release'])}
 {const f=fakeRepo({failSave:true});const r=await runAndStoreRegistrySignals({preset:PRESET,postalCode:'33185',maxResults:20,now:NOW,projectId:'prj'},
   storedDeps((async()=>json({results:[company()],total_pages:1})) as unknown as typeof fetch,f.repo));
  assert.equal(r.error_code,'PERSISTENCE_FAILED');assert.equal(r.refunded,false,'the register answered: the unit is spent');assert.deepEqual(r.signals,[])}
 {const f=fakeRepo({failClose:true});const r=await runAndStoreRegistrySignals({preset:PRESET,postalCode:'33185',maxResults:20,now:NOW,projectId:'prj'},
   storedDeps((async()=>json({results:[company()],total_pages:1})) as unknown as typeof fetch,f.repo));
  assert.equal(r.status,'failed');assert.equal(r.error_code,'RUN_CLOSE_FAILED')}
});
