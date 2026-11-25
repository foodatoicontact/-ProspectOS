// Collecte nationale (migration 045, src/collect): the BODACC of a day for all of France, legal persons only, mapped to
// four kinds; the company record once per SIREN, a sole trader's name never kept; the nightly job behind its flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {exportUrl,parseBodacc} from '../src/collect/bodacc.ts';
import {parseCompany} from '../src/collect/enrich.ts';
import {runCollection,enrichCompanies,ENRICH_PRIORITY} from '../src/collect/run.ts';
import {collectConfigFrom,enrichConfigFrom,enrichDepartments,publicEventsEnabled} from '../src/collect/config.ts';
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
// Fictitious announcements, shaped like the BODACC open-data export.
const pm=(denomination:string,siren:string)=>JSON.stringify({personne:{typePersonne:'pm',denomination,numeroImmatriculation:{numeroIdentification:siren.replace(/(\d{3})(\d{3})(\d{3})/,'$1 $2 $3')}}});
const row=(o:Record<string,unknown>)=>({id:'A1',dateparution:'2026-11-06',registre:['900000001','900 000 001'],commercant:'EXEMPLE SAS',ville:'Meaux',cp:'77100',numerodepartement:'77',
 url_complete:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A1',listepersonnes:pm('EXEMPLE SAS','900000001'),...o});

test('BODACC export: one request per family and day, transfers filtered at the source',()=>{
 const u=new URL(exportUrl('2026-11-06','modification'));
 assert.equal(u.origin+u.pathname,'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/exports/json');
 assert.equal(u.searchParams.get('where'),`familleavis="modification" and dateparution=date'2026-11-06' and (search("transfert du siège") or search("nouveau siège") or search("adresse du siège"))`);
 assert.doesNotMatch(new URL(exportUrl('2026-11-06','creation')).searchParams.get('where')!,/search/);
 assert.throws(()=>exportUrl('06/11/2026','creation'));
});
test('BODACC parsing: legal persons only (a natural person is dropped and counted), four kinds, SIREN from the register',()=>{
 const r=parseBodacc([
  row({}),
  row({id:'A2',registre:'900 000 002',listepersonnes:pm('ENTREPOT EXEMPLE','900000002'),listeetablissements:JSON.stringify({etablissement:{qualiteEtablissement:'établissement secondaire',activite:'Entreposage  et   stockage'}})}),
  row({id:'A3',listepersonnes:JSON.stringify({personne:{typePersonne:'pp',nom:'DUPONT',prenom:'Jean'}})}),
  row({id:'A4',registre:'pas de numéro'}),
 ],'creation');
 assert.equal(r.skippedPersons,1);
 assert.deepEqual(r.events.map(e=>[e.source_id,e.kind,e.siren]),[['A1','CREATION','900000001'],['A2','ETABLISSEMENT','900000002']]);
 assert.equal(r.events[1]!.activity,'Entreposage et stockage');
 assert.equal(r.events[0]!.name,'EXEMPLE SAS');assert.equal(r.events[0]!.department,'77');assert.equal(r.events[0]!.postal_code,'77100');
 assert.ok(!JSON.stringify(r.events).includes('DUPONT'),'no natural person is kept');
 const t=parseBodacc([row({modificationsgenerales:JSON.stringify({descriptif:'Modification survenue sur l’activité, transfert du siège social.'})}),
  row({id:'A9',modificationsgenerales:JSON.stringify({descriptif:'Modification du capital.'})})],'modification');
 assert.deepEqual(t.events.map(e=>e.kind),['TRANSFERT_SIEGE'],'only stated transfers');
 // Owner decision (25 nov. 2026): only a purchase by the shared rule (src/domain/bodacc-purchase.ts) is a VENTE_FONDS.
 const buy=row({acte:JSON.stringify({vente:{categorieVente:"Achat d'un fonds par une personne morale (insertion provisoire)"}})});
 const merger=row({id:'A5',acte:JSON.stringify({vente:{categorieVente:"Autre achat, apport, attribution (immatriculation d'une personne morale, uniquement)"}}),listeetablissements:JSON.stringify({etablissement:{origineFonds:'Apport fusion'}})});
 const v=parseBodacc([buy,merger,row({id:'A6'})],'vente');
 assert.deepEqual(v.events.map(e=>[e.source_id,e.kind]),[['A1','VENTE_FONDS']]);assert.equal(v.skippedNotPurchase,2);
 // Migration 054: each vente batch carries how many notices each rule decided — ids and counts only.
 assert.deepEqual(v.saleRules,{category_purchase:1,origin_merger:1,no_rule:1});
 assert.deepEqual(parseBodacc([row({})],'creation').saleRules,{},'other families count no sale rule');
});
test('company record: activity, size, legal form, active, objection; a sole trader keeps no name',()=>{
 const body=(o:Record<string,unknown>)=>({results:[{siren:'900000001',nom_complet:'EXEMPLE SAS',nom_raison_sociale:'EXEMPLE SAS',nature_juridique:'5710',activite_principale:'52.10B',
  tranche_effectif_salarie:'12',etat_administratif:'A',opposition_diffusion_commerciale:false,complements:{est_entrepreneur_individuel:false},
  siege:{departement:'77',libelle_commune:'MEAUX'},dirigeants:[{nom:'DUPONT'}],...o}]});
 assert.deepEqual(parseCompany('900000001',body({})),{siren:'900000001',name:'EXEMPLE SAS',naf:'52.10B',legal_form:'5710',employee_band:'12',active:true,individual:false,
  opposition:false,department:'77',commune:'MEAUX'});
 const ei=parseCompany('900000001',body({nature_juridique:'1000',nom_complet:'Jean DUPONT',complements:{est_entrepreneur_individuel:true}}))!;
 assert.deepEqual([ei.individual,ei.name],[true,null]);
 assert.equal(parseCompany('900000001',body({opposition_diffusion_commerciale:true}))!.opposition,true);
 assert.equal(parseCompany('900000001',body({etat_administratif:'C'}))!.active,false);
 assert.equal(parseCompany('900000009',body({})),null,'another SIREN is never taken');
 assert.ok(!JSON.stringify(parseCompany('900000001',body({}))).includes('DUPONT'),'no executive');
});
test('nightly job: two days × three families, then the records asked, within the time budget; a failure is reported, not fatal',async()=>{
 const calls:[string,Record<string,unknown>][]=[];let t=0;
 const rpc=async(name:string,args:Record<string,unknown>)=>{calls.push([name,args]);return name==='ingest_public_events'?{inserted:(args.p_events as unknown[]).length}:name==='sirens_to_enrich'?['900000001','900000002']:2};
 const fetchJson=async(url:string)=>{t+=100;if(url.includes('recherche-entreprises'))return {results:[{siren:new URL(url).searchParams.get('q'),etat_administratif:'A',nature_juridique:'5710'}]};
  if(url.includes('%22vente%22')&&url.includes('2026-11-14'))throw Error('HTTP_503');return [row({})]};
 const r=await runCollection(rpc,fetchJson,{days:['2026-11-14','2026-11-13'],enrich:{departments:['77'],kinds:['CREATION'],since:'2026-10-15',limit:400},deadline:1e9,now:()=>t,sleep:async()=>{}});
 assert.equal(r.days.length,6);assert.equal(r.days.find(d=>d.error)!.error,'HTTP_503');
 assert.equal(calls.filter(c=>c[0]==='ingest_public_events').length,5);
 assert.deepEqual([r.enriched,r.enrichFailed],[2,0]);
 assert.equal(calls.filter(c=>c[0]==='upsert_company_cache').length,1);
 // Past the deadline nothing more is fetched.
 const late=await runCollection(rpc,fetchJson,{days:['2026-11-14'],enrich:null,deadline:0,now:()=>1000,sleep:async()=>{}});
 assert.deepEqual(late.days,[]);
});
test('enrichment: several requests at once, never more than 7 starts in any second (API limit), stops before the deadline',async()=>{
 // Real timers, time scaled ×20: each answer takes 700 ms, the budget is 55 s (≈ 2.8 s of test). 400 SIRENs to enrich.
 const K=20;const t0=performance.now();const now=()=>(performance.now()-t0)*K;const starts:number[]=[];let upserted=0;
 const sirens=Array.from({length:400},(_,i)=>String(900000000+i));
 const rpc=async(name:string,args:Record<string,unknown>)=>{if(name==='sirens_to_enrich')return sirens;if(name==='upsert_company_cache')upserted+=(args.p_rows as unknown[]).length;return 0};
 const fetchJson=async(url:string)=>{starts.push(now());await new Promise(r=>setTimeout(r,700/K));
  return {results:[{siren:new URL(url).searchParams.get('q'),etat_administratif:'A',nature_juridique:'5710'}]}};
 const r=await runCollection(rpc,fetchJson,{days:[],enrich:{departments:['75'],kinds:['CREATION'],since:'2026-10-15',limit:400},deadline:55000,now,
  sleep:ms=>new Promise(res=>setTimeout(res,ms/K))});
 const s=[...starts].sort((a,b)=>a-b);
 for(let i=7;i<s.length;i++)assert.ok(s[i]-s[i-7]>=1000,`8 starts within ${Math.round(s[i]-s[i-7])} ms`);
 assert.ok(r.enriched>200,`only ${r.enriched} enriched (one at a time gave ~70)`);
 assert.ok(s[s.length-1]<=55000,'nothing starts after the deadline');
 assert.equal(upserted,r.enriched,'every record fetched is stored');
});
test('configuration and wiring: off by default; the two previous Paris days; enrichment only for the departments listed',()=>{
 assert.equal(publicEventsEnabled({}),false);assert.equal(publicEventsEnabled({PUBLIC_EVENTS_COLLECT_ENABLED:'true'}),true);
 assert.deepEqual(enrichDepartments({PUBLIC_EVENTS_ENRICH_DEPARTMENTS:' 75,77 ,2a,999x,75'}),['75','77','2A']);
 const c=collectConfigFrom({},new Date('2026-11-15T02:13:00Z'),{deadline:0,now:()=>0,sleep:async()=>{}});
 assert.deepEqual(c.days,['2026-11-14','2026-11-13']);assert.equal(c.enrich,null);
 const route=read('app/api/cron/collect/route.ts');
 assert.match(route,/if\(!publicEventsEnabled\(process\.env\)\)return json\(\{skipped:'PUBLIC_EVENTS_COLLECT_DISABLED'\}\)/);
 assert.match(route,/cronAuthorized\(request\.headers\.get\('authorization'\),process\.env\.CRON_SECRET\)/);
 assert.match(route,/redirect:'error'/);
 assert.equal(JSON.parse(read('vercel.json')).crons.filter((x:{path:string})=>x.path==='/api/cron/collect').length,1);
});

test('enrichment order: business sales, then head-office moves, then establishments, then creations — the limit applies to the whole',async()=>{
 const asked:unknown[][]=[];const fetched:string[]=[];
 const byKind:Record<string,string[]>={VENTE_FONDS:['900000001','900000002'],TRANSFERT_SIEGE:['900000002','900000003'],ETABLISSEMENT:[],CREATION:['900000004','900000005','900000006']};
 const rpc=async(name:string,args:Record<string,unknown>)=>{if(name==='sirens_to_enrich'){asked.push([args.p_kinds,args.p_limit]);return byKind[(args.p_kinds as string[])[0]!]!.slice(0,args.p_limit as number)}return 0};
 const fetchJson=async(url:string)=>{const q=new URL(url).searchParams.get('q')!;fetched.push(q);return {results:[{siren:q,etat_administratif:'A',nature_juridique:'5710'}]}};
 const report={enriched:0,enrichFailed:0};
 await enrichCompanies(rpc,fetchJson,{enrich:{departments:['75'],kinds:['CREATION','ETABLISSEMENT','TRANSFERT_SIEGE','VENTE_FONDS'],since:'2026-10-18',limit:4},deadline:1e12,now:()=>0,sleep:async()=>{}},report);
 assert.deepEqual(ENRICH_PRIORITY,['VENTE_FONDS','TRANSFERT_SIEGE','ETABLISSEMENT','CREATION']);
 assert.deepEqual(asked,[[['VENTE_FONDS'],4],[['TRANSFERT_SIEGE'],2],[['ETABLISSEMENT'],1],[['CREATION'],1]]);
 assert.deepEqual(fetched.sort(),['900000001','900000002','900000003','900000004'],'a SIREN seen twice is fetched once; the limit is shared');
 assert.equal(report.enriched,4);
});
test('enrichment job: off unless the collection is on and departments are listed; three daily runs after the collection',()=>{
 const rt={deadline:0,now:()=>0,sleep:async()=>{}};
 assert.equal(enrichConfigFrom({PUBLIC_EVENTS_ENRICH_DEPARTMENTS:'75'},new Date('2026-11-18T04:07:00Z'),rt),null);
 assert.equal(enrichConfigFrom({PUBLIC_EVENTS_COLLECT_ENABLED:'true'},new Date('2026-11-18T04:07:00Z'),rt),null);
 const c=enrichConfigFrom({PUBLIC_EVENTS_COLLECT_ENABLED:'true',PUBLIC_EVENTS_ENRICH_DEPARTMENTS:'75,93'},new Date('2026-11-18T04:07:00Z'),rt)!;
 assert.deepEqual([c.enrich.departments,c.enrich.since,c.enrich.limit],[['75','93'],'2026-10-19',400]);
 const crons=JSON.parse(read('vercel.json')).crons.filter((x:{path:string})=>x.path.startsWith('/api/cron/enrich/'));
 assert.deepEqual(crons,[{path:'/api/cron/enrich/1',schedule:'7 4 * * *'},{path:'/api/cron/enrich/2',schedule:'7 5 * * *'},{path:'/api/cron/enrich/3',schedule:'7 6 * * *'}]);
 const route=read('app/api/cron/enrich/[slot]/route.ts');
 assert.match(route,/cronAuthorized\(request\.headers\.get\('authorization'\),process\.env\.CRON_SECRET\)/);
 assert.match(route,/new Set\(\['1','2','3'\]\)/);
 assert.match(route,/deadline:started\+55000/);
 assert.doesNotMatch(route,/export async function (POST|PUT|PATCH|DELETE)|request\.(json|text)\(/);
});

test('head-office moves: the three wordings of the registries are read; other changes are not moves',async()=>{
 const {parseBodacc}=await import('../src/collect/bodacc.ts');
 const mk=(d:string,id:string)=>({id,dateparution:'2026-11-17',registre:['910928480'],url_complete:`https://www.bodacc.fr/x/${id}`,numerodepartement:'69',ville:'Limas',cp:'69400',
  listepersonnes:JSON.stringify({personne:{typePersonne:'pm',denomination:'EXEMPLE SAS'}}),modificationsgenerales:JSON.stringify({descriptif:d})});
 const r=parseBodacc([mk('Nouveau siège.','a'),mk('modification survenue sur l\'adresse du siège et l\'adresse de l\'établissement','b'),mk('Modification survenue sur l\'activité, transfert du siège social.','c'),
  mk('Modification de l\'activité.','d'),mk('modification survenue sur l\'adresse de l\'établissement','e')] as any,'modification');
 assert.deepEqual(r.events.map(e=>[e.source_id,e.kind]),[['a','TRANSFERT_SIEGE'],['b','TRANSFERT_SIEGE'],['c','TRANSFERT_SIEGE']]);
});

test('signals of a followed company: « Nouveau siège » and a head-office address change are moves too',async()=>{
 const {classifyAnnouncement}=await import('../src/signals/providers/bodacc.ts');
 for(const d of ['Nouveau siège.','modification survenue sur l\'adresse du siège','Modification survenue sur l\'activité, transfert du siège social.'])
  assert.equal((classifyAnnouncement({familleavis:'modification',familleavis_lib:'Modifications diverses',modificationsgenerales:JSON.stringify({descriptif:d})} as any) as any).type,'new_site',d);
});
