// Discovery provider 'bodacc_sales' (src/discovery/providers/bodacc-sales.ts, migration 039): companies that have just
// bought a business, from the BODACC « Ventes et cessions » notices. Only real purchases, only a legal-entity buyer
// identified by its RCS number, never the seller nor the act's free text; fixed host, bounded, an explicit failure when
// the BODACC never answers; a candidate to review, never evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BODACC_RECORDS,BodaccSalesProvider,SALES_WINDOW_DAYS,activityStems,matchesActivity,readSalesNotice,salesUrl,salesZoneClause} from '../src/discovery/providers/bodacc-sales.ts';
import {createDiscoveryProvider} from '../src/discovery/providers/index.ts';
import {reviewPriority} from '../src/discovery/review-priority.ts';
import {sirenOf} from '../src/signals/providers/bodacc.ts';
import {replayFields} from '../src/discovery/run-history.ts';
import {DiscoveryInputSchema} from '../src/discovery/types.ts';

const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const NOW=new Date('2026-11-01T08:00:00Z');
const PURCHASE="Achat d'un fonds par une personne morale (insertion provisoire)";
// A notice as the BODACC API returns it (shape read on the live API, 1 nov. 2026); the act's text names the seller.
function notice(o:{id?:string;category?:string;type?:string;siren?:string;registre?:string[];name?:string;activity?:string;enseigne?:string;url?:string;date?:string;people?:unknown}={}){
 const siren=o.siren??'106463037';
 return {id:o.id??'A20260208360',dateparution:o.date??'2026-10-29',url_complete:o.url??`https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:${o.id??'A20260208360'}`,
  registre:o.registre??[siren,siren.replace(/(\d{3})(\d{3})(\d{3})/,'$1 $2 $3'),'832478069'],
  acte:JSON.stringify({descriptif:'Suivant acte… Monsieur Jean VENDEUR, demeurant 1 rue X, a cédé à NB2M…',vente:{categorieVente:o.category??PURCHASE}}),
  listeetablissements:JSON.stringify({etablissement:{origineFonds:'Achat au prix stipulé de 70000,00 euros.',qualiteEtablissement:'Etablissement principal',activite:o.activity??"Exploitation d'un commerce de détail d'alimentation générale.",enseigne:o.enseigne??'VIVAL',adresse:{codePostal:'31230',ville:"L'Isle-en-Dodon"}}}),
  listepersonnes:o.people!==undefined?o.people:JSON.stringify({personne:{typePersonne:o.type??'pm',numeroImmatriculation:{numeroIdentification:siren.replace(/(\d{3})(\d{3})(\d{3})/,'$1 $2 $3')},denomination:o.name??'NB2M'}})};
}
const input=(o:Partial<{query:string;location:string;categories:string[];max:number}>={})=>DiscoveryInputSchema.parse({project_id:'p',query:o.query??'reprises',location:o.location??'Haute-Garonne (31)',categories:o.categories??[],max_results:o.max??20,optional_filters:{provider:'bodacc_sales'}});

test('notice reading — a purchase by a legal entity is kept with its official URL; nothing from the seller or the act text',()=>{
 const r=readSalesNotice(notice());
 assert.ok('notice' in r);
 assert.deepEqual(r.notice,{id:'A20260208360',published:'2026-10-29',url:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A20260208360',category:PURCHASE,
  siren:'106463037',buyer:'NB2M',activity:"Exploitation d'un commerce de détail d'alimentation générale.",tradeName:'VIVAL',establishment:'Etablissement principal',city:"L'Isle-en-Dodon",postalCode:'31230'});
 assert.doesNotMatch(JSON.stringify(r.notice),/VENDEUR|demeurant|70000/,'the seller, an address and the price are never kept');
});

test('notice reading — what is not a purchase, a sole trader, or an unproven identity is rejected with its reason',()=>{
 for(const c of ["Autre achat, apport, attribution (immatriculation d'une personne morale, uniquement)","Mise en activité d'une société suite à achat","Apport d'un établissement principal (immatriculation d'une personne morale, uniquement)"])
  assert.deepEqual(readSalesNotice(notice({category:c})),{reject:'NOT_A_PURCHASE'},c);
 assert.deepEqual(readSalesNotice(notice({type:'pp',category:"Achat d'un fonds par une personne physique (insertion provisoire)"})),{reject:'NOT_A_LEGAL_ENTITY'},'a person is never a candidate');
 assert.deepEqual(readSalesNotice(notice({registre:['999999999']})),{reject:'NO_BUYER_IDENTITY'},'the buyer RCS number must be one of the notice');
 assert.deepEqual(readSalesNotice(notice({people:null})),{reject:'NO_BUYER_IDENTITY'});
 assert.deepEqual(readSalesNotice(notice({name:'  '})),{reject:'NO_BUYER_IDENTITY'});
 assert.deepEqual(readSalesNotice(notice({url:'https://evil.example/x'})),{reject:'INVALID_NOTICE'},'only the official notice page');
 assert.deepEqual(readSalesNotice(notice({date:'hier'})),{reject:'INVALID_NOTICE'});
 assert.deepEqual(readSalesNotice({acte:'{oops'}),{reject:'NOT_A_PURCHASE'});
 assert.deepEqual(readSalesNotice(null),{reject:'INVALID_NOTICE'});
});

test('query — fixed host, validated zone, 90-day window, newest first, no trader name requested',()=>{
 const u=salesUrl({kind:'department',code:'31',label:'Haute-Garonne'},NOW,2);
 assert.equal(u.origin+u.pathname,BODACC_RECORDS);
 assert.equal(SALES_WINDOW_DAYS,90);
 assert.equal(u.searchParams.get('where'),`familleavis="vente" and typeavis="annonce" and numerodepartement="31" and dateparution>=date'2026-08-03'`);
 assert.doesNotMatch(u.searchParams.get('select')!,/commercant/);
 assert.equal(u.searchParams.get('order_by'),'dateparution desc');
 assert.equal(u.searchParams.get('offset'),'100');
 assert.equal(salesZoneClause({kind:'region',code:'76',label:'Occitanie'}),'region_code=76');
 assert.equal(salesZoneClause({kind:'region',code:'04',label:'La Réunion'}),'region_code=4');
 assert.throws(()=>salesZoneClause({kind:'department',code:'31" or "1"="1',label:'x'}));
});

test('activity — generic takeover words filter nothing; a trade is matched on the activity or trade name',()=>{
 assert.deepEqual(activityStems(['reprises','commerces','entreprises']),[]);
 assert.deepEqual(activityStems(['Restaurants','boulangerie']),['restau','boulan']);
 const n={activity:'Restauration traditionnelle',tradeName:null};
 assert.equal(matchesActivity(n,[]),true);
 assert.equal(matchesActivity(n,activityStems(['restaurant'])),true);
 assert.equal(matchesActivity(n,activityStems(['avocat'])),false);
 assert.equal(matchesActivity({activity:null,tradeName:'Boulangerie du Port'},activityStems(['boulangerie'])),true);
});

// A fake BODACC: pages of results, every call recorded.
function bodacc(pages:unknown[][]|'down'|number){
 const calls:{url:string;init?:RequestInit}[]=[];
 const fetchImpl=(async(u:string|URL|Request,init?:RequestInit)=>{
  calls.push({url:String(u),init});
  if(pages==='down')throw new TypeError('fetch failed');
  if(typeof pages==='number')return new Response('{}',{status:pages});
  const page=Number(new URL(String(u)).searchParams.get('offset'))/100;
  return new Response(JSON.stringify({results:pages[page]??[]}),{status:200});
 }) as typeof fetch;
 return {fetchImpl,calls};
}

test('search — keeps purchases of the zone, one candidate per company (its latest notice), reports what it rejected',async()=>{
 const page=[notice({id:'A1',siren:'106463037'}),notice({id:'A2',siren:'106463037',date:'2026-10-01'}),notice({id:'A3',siren:'529417271',name:'AUDITIA GESTION',activity:"co-courtage d'assurance",enseigne:''}),
  notice({id:'A4',category:'Mise en activité d\'une société suite à achat'}),notice({id:'A5',type:'pp'})];
 const {fetchImpl,calls}=bodacc([page]);
 const p=new BodaccSalesProvider({fetch:fetchImpl,now:()=>NOW});
 const out=await p.searchCompanies(input());
 assert.deepEqual(out.map(n=>[n.id,n.siren]),[['A1','106463037'],['A3','529417271']]);
 assert.equal(p.lastSales!.duplicates,1);
 assert.deepEqual(p.lastSales!.rejected,{NOT_A_PURCHASE:1,NOT_A_LEGAL_ENTITY:1});
 assert.equal(p.lastSearch!.requests_answered,1);
 assert.equal(calls.length,1,'a short page is the last one');
 for(const c of calls){assert.equal(c.init?.redirect,'error');assert.ok(c.init?.signal)}
 const insurance=await new BodaccSalesProvider({fetch:bodacc([page]).fetchImpl,now:()=>NOW}).searchCompanies(input({query:'assurance'}));
 assert.deepEqual(insurance.map(n=>n.id),['A3'],'the brief activity filters the businesses bought');
});

test('search — an unknown zone sends nothing; a BODACC that never answers is an explicit failure (unit given back)',async()=>{
 const none=bodacc([[]]);const p=new BodaccSalesProvider({fetch:none.fetchImpl,now:()=>NOW});
 assert.deepEqual(await p.searchCompanies(input({location:'quelque part'})),[]);
 assert.equal(none.calls.length,0);assert.deepEqual(p.lastSearch!.failure_codes,['BODACC_ZONE_UNMAPPED']);
 await assert.rejects(new BodaccSalesProvider({fetch:bodacc('down').fetchImpl,now:()=>NOW}).searchCompanies(input()),/BODACC_UNAVAILABLE/);
 const http=new BodaccSalesProvider({fetch:bodacc(503).fetchImpl,now:()=>NOW});
 await assert.rejects(http.searchCompanies(input()),/BODACC_UNAVAILABLE/);
 assert.deepEqual(http.lastSearch!.failure_codes,['HTTP_503']);
});

test('candidate — the buyer, its SIREN and the notice as source; a reviewable candidate, never evidence',()=>{
 const p=new BodaccSalesProvider();
 const n=readSalesNotice(notice());assert.ok('notice' in n);
 const c=p.normalizeResult(n.notice);
 assert.equal(c.name,'NB2M');assert.equal(c.discovered_source,'bodacc_sales');
 assert.equal(c.source_url,'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A20260208360');
 assert.equal(c.source_title,"Reprise publiée au BODACC le 29 octobre 2026 : Exploitation d'un commerce de détail d'alimentation générale., enseigne VIVAL");
 assert.equal(c.address,null);assert.equal(c.website,null);assert.equal(c.deduplication_key,'siren:106463037');
 const meta=c.raw_metadata as Record<string,unknown>;
 assert.equal(meta.source_type,'legal_announcement');assert.equal(meta.siren,'106463037');
 assert.doesNotMatch(JSON.stringify(c),/VENDEUR|descriptif|70000|evidence|VERIFIED/);
 assert.deepEqual(reviewPriority(meta as never),{level:'MEDIUM',reasons:['public_registry']});
 assert.throws(()=>p.normalizeResult({...n.notice,url:'https://evil.example/'}),/BODACC_SALES_RESULT_INVALID/);
});

test('wiring — explicit factory, schema, replay, and the SIREN read by the BODACC signals monitor',()=>{
 assert.ok(createDiscoveryProvider('bodacc_sales',{}) instanceof BodaccSalesProvider);
 assert.equal(input().optional_filters.provider,'bodacc_sales');
 const run={id:'r',query:'reprises',location:'Haute-Garonne (31)',categories:[],provider:'bodacc_sales' as const,status:'completed',started_at:'',completed_at:null,result_count:1,max_results:20,accepted_count:0,ignored_count:0,search_mode:'all' as const};
 assert.equal(replayFields(run as never,false,true).provider,'bodacc_sales');
 assert.equal(replayFields(run as never,false,false).provider,'fixture','a demo replay never preselects a real source');
 assert.equal(sirenOf([{provider:'bodacc_sales',raw_payload:{siren:'106463037'}}]),'106463037');
 assert.equal(sirenOf([{provider:'brave',raw_payload:{siren:'106463037'}}]),null,'never a number read on a web page');
 const m=read('db/migrations/039_discovery_bodacc_sales_provider.sql');
 assert.match(m,/check \(provider in \('fixture','brave','registry','bodacc_sales'\)\)/);
 assert.match(m,/p_provider not in \('fixture','bodacc_sales'\)/,'a reprise search is never served from an old run');
});
