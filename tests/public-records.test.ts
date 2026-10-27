// Public registers of a prospect (src/discovery/public-records.ts): company register (INSEE Sirene / RNE through the
// API Recherche d'entreprises) and public procurement awards (DECP on data.gouv.fr). Pure tests: a fake fetch serves
// recorded shapes of both APIs (La Garonne, the end-to-end test of 2026-10-24); no network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveCompany,fetchAwards,registryObservations,enrichFromPublicRecords,registryCity,knownSirenOf,comparableName,PublicRecordsError,
 DECP_RESOURCE_DEFAULT,SIRENE_PAGE,type SireneCompany,type DecpRow,type PublicRecordsRepository} from '../src/discovery/public-records.ts';
import {ObservationSchema,type Observation} from '../src/discovery/types.ts';
import {EvidenceProposalService} from '../src/discovery/observations.ts';

const NOW=new Date('2026-10-24T12:00:00Z');
const ICP=[
 {key:'target_fit',label:'Entreprise française du BTP structurée, environ 10 à 100 salariés, priorité Auvergne-Rhône-Alpes',weight:30},
 {key:'need_fit',label:'Répond régulièrement aux marchés publics, appels d’offres ou DCE',weight:35},
 {key:'commercial_signal',label:'Références avec collectivités, bailleurs sociaux ou établissements publics',weight:25},
 {key:'contactability',label:'Contact professionnel décisionnaire documenté',weight:10},
];
const GARONNE:SireneCompany={siren:'560800583',nom_complet:'SOC LA GARONNE',nom_raison_sociale:'SOC LA GARONNE',statut_diffusion:'O',etat_administratif:'A',
 activite_principale:'42.21Z',date_creation:'1956-01-01',tranche_effectif_salarie:'12',annee_tranche_effectif_salarie:'2024',
 dirigeants:[
  {type_dirigeant:'personne physique',nom:'PASCUAL (HU)',prenoms:'YANG',qualite:'Administrateur',...{date_de_naissance:'1980-02'}},
  {type_dirigeant:'personne physique',nom:'PASCUAL',prenoms:'NICOLAS',qualite:'Président du conseil d’administration',...{date_de_naissance:'1981-09',annee_de_naissance:'1981'}},
  {type_dirigeant:'personne morale',nom:null,prenoms:null,qualite:'Commissaire aux comptes titulaire'},
 ] as SireneCompany['dirigeants'],
 siege:{siret:'56080058300034',adresse:'63 CHEMIN DE GUILHERMY 31100 TOULOUSE',libelle_commune:'TOULOUSE',departement:'31',liste_enseignes:null,nom_commercial:null}};
const row=(o:Partial<DecpRow>):DecpRow=>({uid:'u1',titulaire_id:'56080058300034',titulaire_typeIdentifiant:'SIRET',titulaire_nom:'SOC LA GARONNE',acheteur_nom:'TOULOUSE METROPOLE (SERVICE EAU POTABLE)',
 objet:'TVX CONSTRUCTION D’UN RESERVOIR AEP DE 5000 M²',procedure:'Procédure avec négociation',dateNotification:'2026-08-14',donneesActuelles:true,...o});
const AWARDS=[
 row({}),
 row({uid:'u1',dateNotification:'2026-04-20',donneesActuelles:false}),// an earlier version of the same contract
 row({uid:'u2',acheteur_nom:'COMMUNE DE MURET (ASSAINISSEMENT)',objet:'Rehabilitation sans tranchée des réseaux EU/EP de la ville de MURET',procedure:'Procédure adaptée',dateNotification:'2026-07-03'}),
 row({uid:'u3',acheteur_nom:'COMMUNE DE MURET (MAIRIE)',objet:'Rehabilitation sans tranchée des réseaux EU/EP de la ville de MURET',procedure:'Procédure adaptée',dateNotification:'2026-04-20'}),// same object, other entity
 row({uid:'u4',acheteur_nom:'COMMUNAUTE D\'AGGLOMERATION DU SICOVAL',objet:'Réseaux d’assainissement du Sicoval',dateNotification:'2024-11-12'}),
 row({uid:'u5',titulaire_id:'99956080058300',titulaire_nom:'AUTRE SOCIETE'}),// SIREN digits elsewhere in another SIRET
 row({uid:'u6',dateNotification:'2019-01-10',objet:'Ancien marché'}),// older than the window
 row({uid:'u7',objet:null}),// incomplete row
];
type Route=(url:URL)=>{status?:number;body?:unknown};
function fakeFetch(route:Route){
 const calls:string[]=[];
 const f=(async(input:string|URL)=>{const url=new URL(String(input));calls.push(url.href);const r=route(url);
  return new Response(r.body===undefined?'':JSON.stringify(r.body),{status:r.status??200,headers:{'content-type':'application/json'}})}) as typeof fetch;
 return {fetch:f,calls};
}
const registry=(results:SireneCompany[]):Route=>url=>url.hostname==='recherche-entreprises.api.gouv.fr'?{body:{results}}:url.hostname==='tabular-api.data.gouv.fr'?{body:{data:AWARDS}}:{status:500};
const observationsFor=(c=GARONNE,rows=AWARDS)=>registryObservations(c,{rows,url:'https://tabular-api.data.gouv.fr/x'},ICP,NOW);

// ——— identity ———
test('identity — a SIREN given by the person is looked up as such (no name matching)', async () => {
 const f=fakeFetch(registry([GARONNE]));
 assert.equal((await resolveCompany({name:'Nom différent',city:null,siren:'560800583'},f.fetch)).siren,'560800583');
 assert.equal(new URL(f.calls[0]).searchParams.get('q'),'560800583');
 await assert.rejects(resolveCompany({name:'x',city:null,siren:'12345'},f.fetch),/INVALID_SIREN/);
 await assert.rejects(resolveCompany({name:'x',city:null,siren:'123456789'},fakeFetch(registry([GARONNE])).fetch),/COMPANY_NOT_FOUND/);
 await assert.rejects(resolveCompany({name:'x',city:null,siren:'560800583'},fakeFetch(()=>({body:{error:'maintenance'}})).fetch),/PUBLIC_RECORDS_UNAVAILABLE/,'a shapeless answer is not "not found"');
 await assert.rejects(resolveCompany({name:'x',city:null},fakeFetch(()=>({status:429})).fetch),/PUBLIC_RECORDS_UNAVAILABLE/);
});
test('identity — an exact name (legal form aside) in the same city resolves; anything else returns candidates, never a guess', async () => {
 assert.equal(comparableName('SA La Garonne'),comparableName('SOC LA GARONNE'));
 assert.equal((await resolveCompany({name:'SA La Garonne',city:'Toulouse'},fakeFetch(registry([GARONNE])).fetch)).siren,'560800583');
 const other={...GARONNE,siren:'111111111',siege:{...GARONNE.siege,libelle_commune:'AGEN'}};
 assert.equal((await resolveCompany({name:'La Garonne',city:'Toulouse'},fakeFetch(registry([other,GARONNE])).fetch)).siren,'560800583','the city decides between namesakes');
 const e=await resolveCompany({name:'La Garonne',city:null},fakeFetch(registry([other,GARONNE])).fetch).catch(x=>x);
 assert.ok(e instanceof PublicRecordsError);assert.equal(e.message,'REGISTRY_IDENTITY_REQUIRED');assert.deepEqual(e.candidates.map((c:{siren:string})=>c.siren),['111111111','560800583']);
 const near=await resolveCompany({name:'Garonne TP',city:'Toulouse'},fakeFetch(registry([GARONNE])).fetch).catch(x=>x);
 assert.equal(near.message,'REGISTRY_IDENTITY_REQUIRED','a similar name is a candidate, not a match');assert.equal(near.candidates[0].siren,'560800583');
});
test('identity — the SIREN of an earlier identification is read back from its own source URL', () => {
 assert.equal(knownSirenOf([{observation_type:'REGISTRY_IDENTITY',source_url:SIRENE_PAGE('560800583')}]),'560800583');
 assert.equal(knownSirenOf([{observation_type:'REGISTRY_IDENTITY',source_url:'https://evil.example/entreprise/560800583'}]),null);
 assert.equal(knownSirenOf([{observation_type:'OTHER',source_url:SIRENE_PAGE('560800583')}]),null);
 assert.equal(knownSirenOf([{observation_type:'REGISTRY_IDENTITY',source_url:SIRENE_PAGE('560800583')},{observation_type:'REGISTRY_IDENTITY',source_url:SIRENE_PAGE('111111111')}]),null,'two identities: ask again');
 assert.equal(knownSirenOf([{observation_type:'REGISTRY_IDENTITY',source_url:SIRENE_PAGE('560800583')},{observation_type:'REGISTRY_IDENTITY',source_url:SIRENE_PAGE('560800583')}]),'560800583');
});

// ——— procurement ———
test('awards — only this company\'s SIRET, one row per contract and per object, newest first, within 5 years', async () => {
 const f=fakeFetch(registry([]));
 const a=await fetchAwards('560800583','56080058300034',f.fetch,NOW);
 assert.deepEqual(a.rows.map(r=>r.uid),['u1','u2','u4']);
 assert.equal(a.rows[0].donneesActuelles,true,'the current version of a contract is kept');
 const q=new URL(f.calls[0]);assert.equal(q.searchParams.get('titulaire_id__exact'),'56080058300034');assert.ok(q.pathname.includes(DECP_RESOURCE_DEFAULT));
 await assert.rejects(fetchAwards('560800583','99999999900000',f.fetch,NOW),/PUBLIC_RECORDS_UNAVAILABLE/,'a SIRET of another company is refused');
});
test('awards — a re-published resource is looked up again from the dataset; any other failure is "unavailable"', async () => {
 const NEW='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
 const f=fakeFetch(url=>url.hostname==='www.data.gouv.fr'?{body:{resources:[{id:NEW,title:'decp.csv',format:'csv'}]}}:url.pathname.includes(NEW)?{body:{data:AWARDS}}:{status:404});
 const a=await fetchAwards('560800583','56080058300034',f.fetch,NOW);
 assert.equal(a.rows.length,3);assert.ok(a.url.includes(NEW),'the source URL is the one that answered');
 await assert.rejects(fetchAwards('560800583','56080058300034',fakeFetch(()=>({status:504})).fetch,NOW),/PUBLIC_RECORDS_UNAVAILABLE/);
 await assert.rejects(fetchAwards('560800583','56080058300034',fakeFetch(()=>({body:'not json'})).fetch,NOW),/PUBLIC_RECORDS_UNAVAILABLE/);
});

// ——— observations ———
test('observations — each fact under the criterion whose intent names it, or as context; all valid, none verified', async () => {
 const rows=(await fetchAwards('560800583','56080058300034',fakeFetch(registry([])).fetch,NOW)).rows;
 const obs=observationsFor(GARONNE,rows);
 for(const o of obs){ObservationSchema.parse(o);assert.ok(o.observation_type.length<=60);assert.equal(o.source_type,'public_directory');assert.equal(o.status,'OBSERVED')}
 const by=(c:string|null)=>obs.filter(o=>o.criterion===c);
 assert.deepEqual(by('target_fit').map(o=>[o.value,o.source_excerpt]),[[true,'Tranche d\'effectif salarié (INSEE, 2024) : 20 à 49 salariés']]);
 assert.deepEqual(by('contactability').map(o=>o.source_excerpt),['Président du conseil d’administration : NICOLAS PASCUAL'],'a management office only — never a board member or an auditor');
 assert.equal(by('need_fit').length,3);assert.ok(by('need_fit').every(o=>o.value===true&&o.source_excerpt.startsWith('Marché public notifié le ')));
 assert.equal(by('commercial_signal').length,3,'one reference per distinct buyer');
 assert.deepEqual(by(null).map(o=>o.observation_type),['REGISTRY_IDENTITY','REGISTRY_HEADQUARTERS','DECP_SUMMARY']);
 assert.match(by(null)[1].source_excerpt,/\(Haute-Garonne, Occitanie\)$/);
 assert.equal(by('need_fit')[0].source_url,'https://tabular-api.data.gouv.fr/x');assert.equal(by('target_fit')[0].source_url,SIRENE_PAGE('560800583'));
 const evidence=new EvidenceProposalService().propose(obs,ICP);
 assert.ok(evidence.length>0&&evidence.every(e=>e.status==='NOT_VERIFIED'&&e.verified_by===null),'every proposal waits for a human');
});
test('observations — never an amount, never a date of birth; a non-diffusible company yields neither executives nor address', () => {
 const text=JSON.stringify(observationsFor());
 assert.doesNotMatch(text,/1981|1980|naissance|montant|€|3636000/);
 const hidden=observationsFor({...GARONNE,statut_diffusion:'P'},[]);
 assert.ok(!hidden.some(o=>o.observation_type.startsWith('REGISTRY_EXECUTIVE')||o.observation_type==='REGISTRY_HEADQUARTERS'));
 assert.ok(!JSON.stringify(hidden).includes('PASCUAL')&&!JSON.stringify(hidden).includes('GUILHERMY'));
});
test('observations — the headcount band is compared whole to the criterion range: inside met, outside not met, straddling context', () => {
 const band=(code:string)=>observationsFor({...GARONNE,tranche_effectif_salarie:code},[]).filter(o=>o.observation_type.startsWith('REGISTRY_HEADCOUNT'));
 assert.deepEqual(band('21').map(o=>[o.criterion,o.value]),[['target_fit',true]],'50–99 inside "environ 10 à 100"');
 assert.deepEqual(band('32').map(o=>[o.criterion,o.value]),[['target_fit',false]],'250–499 outside');
 assert.deepEqual(band('22').map(o=>[o.criterion,o.value]),[[null,null]],'100–199 straddles 10–120: context only');
 assert.deepEqual(band('NN'),[],'no band, no claim');
});
test('observations — an ICP with no matching intent keeps the facts as context only (no criterion invented)', () => {
 const obs=registryObservations(GARONNE,{rows:AWARDS.slice(0,1),url:'https://tabular-api.data.gouv.fr/x'},[{key:'menu',label:'Carte du restaurant en ligne',weight:100}],NOW);
 assert.ok(obs.every(o=>o.criterion===null&&o.value===null));
});

// ——— service ———
function fakeRepo(stored:Array<{observation_type:string;source_url:string}>=[]){
 const log:string[]=[];let saved:Observation[]=[];
 const repo:PublicRecordsRepository={
  prospectIdentity:async()=>({id:'p1',project_id:'pr1',name:'SA La Garonne',city:'Toulouse'}),
  storedObservations:async()=>stored,projectCriteria:async()=>ICP,
  consumeAnalysis:async()=>{log.push('consume')},saveObservations:async(_id,o)=>{log.push('save');saved=o;return o}};
 return {repo,log,saved:()=>saved};
}
test('service — an unidentified company consumes nothing and saves nothing; an identified one consumes once, then saves', async () => {
 const r=fakeRepo();
 await assert.rejects(enrichFromPublicRecords({repo:r.repo,prospectId:'p1',fetch:fakeFetch(registry([])).fetch,now:NOW}),/REGISTRY_IDENTITY_REQUIRED/);
 assert.deepEqual(r.log,[]);
 const ok=fakeRepo();
 const res=await enrichFromPublicRecords({repo:ok.repo,prospectId:'p1',fetch:fakeFetch(registry([GARONNE])).fetch,now:NOW});
 assert.deepEqual(ok.log,['consume','save']);assert.equal(res.company.siren,'560800583');assert.equal(res.awards,3);assert.equal(res.procurement,'ok');
});
test('service — procurement data unavailable: the register facts are still saved, and said so', async () => {
 const r=fakeRepo([{observation_type:'REGISTRY_IDENTITY',source_url:SIRENE_PAGE('560800583')}]);
 const f=fakeFetch(url=>url.hostname==='recherche-entreprises.api.gouv.fr'?{body:{results:[GARONNE]}}:{status:503});
 const res=await enrichFromPublicRecords({repo:r.repo,prospectId:'p1',fetch:f.fetch,now:NOW});
 assert.equal(res.procurement,'unavailable');assert.equal(res.awards,0);
 assert.ok(r.saved().some(o=>o.observation_type==='REGISTRY_IDENTITY')&&!r.saved().some(o=>o.observation_type.startsWith('DECP')));
 assert.equal(new URL(f.calls[0]).searchParams.get('q'),'560800583','the earlier identification is reused, no name search');
});

// ——— wiring ———
test('wiring — its own route module (discovery/api.ts untouched): gated, metered, released on failure, candidates are an answer', () => {
 const api=readFileSync(new URL('../src/discovery/public-records-api.ts',import.meta.url),'utf8');
 assert.match(api,/if\(resource!=='prospects'\|\|action!=='registry'\|\|request\.method!=='POST'\)return null;/);
 assert.ok(api.indexOf('await deps.requireEntitlement();')<api.indexOf('enrichFromPublicRecords({'),'the entitlement is checked before any register is read');
 assert.match(api,/releaseOnFailure\(\(\)=>enrichFromPublicRecords\(\{repo:records,prospectId:id,siren:parsed\.data\.siren\?\?null/);
 assert.match(api,/if\(e\.message==='REGISTRY_IDENTITY_REQUIRED'\)return json\(\{identity_required:true,candidates:e\.candidates\}\);/);
 assert.match(api,/z\.object\(\{siren:z\.string\(\)\.regex\(SIREN\)\.optional\(\)\}\)\.strict\(\)/);
 const router=readFileSync(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.match(router,/handlePublicRecords\(request,path,body,db,json,\{requireEntitlement:\(\)=>requireActiveEntitlement\(db,user\.id\),\n  release:\(\)=>releaseCommercialUse\(createAdminClient\(\),user\.id,'analysis'\)/);
 const ui=readFileSync(new URL('../src/components/ObservationsReview.tsx',import.meta.url),'utf8');
 assert.match(ui,/\{mode==='live'&&<PublicRecordsControl prospectId=\{prospect\.id\}/);
});

// ——— city from the register ———
test('city — an empty "Localisation à confirmer" is filled from the identified company’s headquarters, never overwritten', async () => {
 const filled:string[]=[];
 const base=fakeRepo();
 const empty:PublicRecordsRepository={...base.repo,prospectIdentity:async()=>({id:'p1',project_id:'pr1',name:'SA La Garonne',city:null}),fillProspectCity:async(_id,c)=>{filled.push(c)}};
 await enrichFromPublicRecords({repo:empty,prospectId:'p1',siren:'560800583',fetch:fakeFetch(registry([GARONNE])).fetch,now:NOW});
 assert.equal(filled.length,1);
 assert.equal(filled[0],registryCity(GARONNE));
 assert.match(filled[0],/\(Haute-Garonne\)$/);
 // A card that already has a city is left as it is.
 const kept:string[]=[];
 const withCity:PublicRecordsRepository={...base.repo,fillProspectCity:async(_id,c)=>{kept.push(c)}};
 await enrichFromPublicRecords({repo:withCity,prospectId:'p1',fetch:fakeFetch(registry([GARONNE])).fetch,now:NOW});
 assert.deepEqual(kept,[]);
});
test('city — a non-diffusible company never gives its address to the card (GDPR)', () => {
 assert.equal(registryCity({...GARONNE,statut_diffusion:'P'}),null);
 assert.equal(registryCity({...GARONNE,siege:{...GARONNE.siege,libelle_commune:null}}),null);
});
test('city — wiring: the route passes the repository’s empty-only fill', () => {
 const api=readFileSync(new URL('../src/discovery/public-records-api.ts',import.meta.url),'utf8');
 assert.match(api,/fillProspectCity:\(pid,city\)=>repo\.fillProspectCity\(pid,city\)/);
 const repoSrc=readFileSync(new URL('../src/discovery/repository.ts',import.meta.url),'utf8');
 assert.match(repoSrc,/fillProspectCity\(id:string,city:string\)\{await checked\(this\.db\.from\('prospects'\)\.update\(\{city:city\.slice\(0,120\)\}\)\.eq\('id',id\)\.or\('city\.is\.null,city\.eq\.'\)\)\}/);
});
