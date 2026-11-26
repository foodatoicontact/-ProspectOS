// Les cédants dans les reprises (owner decision, 26 nov. 2026): the shared rule src/domain/bodacc-seller.ts measured on 50
// real BODACC « Ventes et cessions » notices of Île-de-France and Auvergne-Rhône-Alpes (28 Aug.–26 Nov. 2026), annotated by
// hand: every company seller checked against the company register (its name and legal form), every notice without a
// structured seller read for a SIREN near « ancien / précédent propriétaire » (none). In the fixture, the natural persons are
// masked (name, first name, number), the company names are masked too (the rule never reads them), and the two « companies »
// the register knows as sole traders carry synthetic numbers. Then the collection, the search and the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sellerOf,sellerFromText,sirenValid,SELLER_PP_LABEL} from '../src/domain/bodacc-seller.ts';
import {parseBodacc} from '../src/collect/bodacc.ts';
import {BodaccSalesProvider,readSalesNotice,readSellerRow,salesUrl,type SellerRow} from '../src/discovery/providers/bodacc-sales.ts';
import {providerSpecificFilters} from '../src/discovery/providers/index.ts';
import {setSaleSearch,DEFAULT_SALE_SEARCH} from '../src/discovery/sale-search.ts';
import {DiscoveryInputSchema} from '../src/discovery/types.ts';
const read=(f:string)=>readFileSync(new URL(`../${f}`,import.meta.url),'utf8');
type Sample={id:string;acte:unknown;listeetablissements:unknown;listeprecedentproprietaire:unknown;expected:{kind:'PM'|'PP'|'UNKNOWN';siren?:string;register?:string}};
const SAMPLE:Sample[]=JSON.parse(read('tests/fixtures/bodacc-sellers-sample50.json'));

test('sample of 50 annotated notices — the seller’s SIREN is extracted correctly in 50/50; no natural person is exposed',()=>{
 assert.equal(SAMPLE.length,50);
 let correct=0;const wrong:string[]=[];
 for(const s of SAMPLE){
  const r=sellerOf(s.listeprecedentproprietaire,s.acte,s.listeetablissements);
  const ok=r.kind===s.expected.kind&&(r.kind!=='PM'||r.siren===s.expected.siren);
  if(ok)correct++;else wrong.push(`${s.id}: ${JSON.stringify(r)} ≠ ${JSON.stringify(s.expected)}`);
 }
 console.log(`  extraction du SIREN cédant : ${correct}/50 (${(correct*2)}%)`);
 assert.deepEqual(wrong,[]);
 const pp=SAMPLE.filter(s=>s.expected.kind==='PP');assert.equal(pp.length,12);
 for(const s of pp){
  const r=sellerOf(s.listeprecedentproprietaire,s.acte,s.listeetablissements);
  assert.deepEqual(r,{kind:'PP'},'a natural person is only « PP »');
  assert.doesNotMatch(JSON.stringify(r),/MASQUE|masque|123456782|\d{9}/,'never its name or its number');
 }
 for(const s of SAMPLE.filter(s=>s.expected.kind==='UNKNOWN'))
  assert.doesNotMatch(JSON.stringify(sellerOf(s.listeprecedentproprietaire,s.acte,s.listeetablissements)),/rue|Paris|\d{5}/,'an address in the text is never taken');
 // Two « companies » of the notices are sole traders in the register: their SIREN is extracted, and the register then keeps
 // them from ever being shown (company_cache.individual → public.sale_sellers excludes them: tests/bodacc-sale-sellers-db.mjs).
 assert.equal(SAMPLE.filter(s=>s.expected.register==='individual').length,2);
});

test('the text, read in memory: a company named next to « ancien propriétaire » with its RCS number; never a person',()=>{
 assert.deepEqual(sellerFromText('Précédent propriétaire : la société LE BON GOÛT, SARL au capital de 1 000 €, RCS Lyon 552 100 554.'),{siren:'552100554'});
 assert.deepEqual(sellerOf(null,{descriptif:'Ancien propriétaire : SAS PIZZA NAPOLI, immatriculée au RCS de Paris sous le n° 732 829 320.'}),{kind:'PM',siren:'732829320',source:'text'});
 assert.equal(sellerFromText('Vendeur : Monsieur Jean Exemple, RCS Paris 552 100 554, demeurant 1 rue X.'),null,'a person with an RCS number (a sole trader): never');
 assert.equal(sellerFromText("Adresse de l'ancien propriétaire : 1 rue Exemple 75000 Paris"),null);
 assert.equal(sellerFromText('Précédent propriétaire : SARL X, RCS Paris 552 100 555.'),null,'a number with a wrong key');
 assert.equal(sirenValid('552100554'),true);assert.equal(sirenValid('356000000'),true);assert.equal(sirenValid('123'),false);
 assert.deepEqual(sellerOf(JSON.stringify({personne:[{typePersonne:'pp',nom:'X'},{typePersonne:'pm',numeroImmatriculation:{numeroIdentification:'552 100 554'}}]})),{kind:'PM',siren:'552100554',source:'structured'},'co-sellers: the company');
 assert.deepEqual(sellerOf(JSON.stringify({personne:{typePersonne:'pm',numeroImmatriculation:{numeroIdentification:'552 100 555'}}})),{kind:'UNKNOWN'},'a company number with a wrong key is not a SIREN');
 assert.equal(SELLER_PP_LABEL,'Cédant : personne physique, non affiché');
 const src=read('src/domain/bodacc-seller.ts');
 assert.doesNotMatch(src.replace(/\/\/.*$/gm,''),/\.nom\b|\.prenom\b|nomUsage|adresse|console\.|log\(/,'the rule never reads a name or an address, never logs');
});

const notice=(seller:unknown,o:{id?:string}={})=>({id:o.id??'A20260208360',dateparution:'2026-10-29',typeavis:'annonce',familleavis:'vente',registre:['106463037','106 463 037'],
 url_complete:`https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:${o.id??'A20260208360'}`,numerodepartement:'31',ville:'Toulouse',cp:'31000',
 acte:JSON.stringify({vente:{categorieVente:'Achat d\'un fonds par une personne morale'}}),
 listeetablissements:JSON.stringify({etablissement:{origineFonds:'Achat au prix stipulé de 70000,00 euros.',activite:'Restaurant',adresse:{codePostal:'31000',ville:'Toulouse'}}}),
 listepersonnes:JSON.stringify({personne:{typePersonne:'pm',numeroImmatriculation:{numeroIdentification:'106 463 037'},denomination:'NB2M'}}),
 listeprecedentproprietaire:seller===undefined?undefined:JSON.stringify(seller)});
test('collection — the nightly sale carries its seller: a company’s SIREN, a natural person as « PP » alone',()=>{
 assert.match(read('src/collect/bodacc.ts'),/listepersonnes,listeprecedentproprietaire';/);
 const r=parseBodacc([notice({personne:{typePersonne:'pm',numeroImmatriculation:{numeroIdentification:'552 100 554'},denomination:'X'}}),
  notice({personne:{typePersonne:'pp',nom:'NOM',prenom:'P',numeroImmatriculation:{numeroIdentification:'552 100 554'}}},{id:'A2'}),notice(undefined,{id:'A3'})] as never,'vente');
 assert.deepEqual(r.events.map(e=>[e.seller_kind,e.seller_siren??null]),[['PM','552100554'],['PP',null],['UNKNOWN',null]]);
 assert.doesNotMatch(JSON.stringify(r.events),/"NOM"|"P"|prenom/);
 assert.match(read('src/collect/sales-backfill.ts'),/rpc\('mark_sale_backfill_day',\{p_day:day,p_fetched:rows\.length\}\)/);
});

test('search — buyers carry their seller; « Entreprises ayant cédé un fonds » reads the base with NAF codes, zone and period',async()=>{
 const b=readSalesNotice(notice({personne:{typePersonne:'pp',nom:'NOM',prenom:'P'}}));
 assert.ok('notice' in b);assert.deepEqual(b.notice.seller,{kind:'PP'});
 assert.match(salesUrl({kind:'department',code:'31',label:'x'},new Date('2026-11-26T12:00:00Z'),1,30).searchParams.get('where')!,/dateparution>=date'2026-10-27'/,'the period chosen');
 const calls:Record<string,unknown>[]=[];
 const row={siren:'552100554',name:'LE BON GOÛT',naf:'56.10A',department:'69',commune:'Lyon',active:true,
  sale:{notice_id:'A1',published:'2026-11-20',url:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A1',activity:'Restaurant',department:'69',commune:'Lyon'}};
 const p=new BodaccSalesProvider({sellers:async a=>{calls.push(a);return [row,{...row,siren:'bad'}]},now:()=>new Date('2026-11-26T12:00:00Z')});
 const input=DiscoveryInputSchema.parse({project_id:'p',query:'restaurateurs',location:'Rhône (69)',categories:[],max_results:20,
  optional_filters:{provider:'bodacc_sales',sale_party:'seller',naf_prefixes:['56'],period_days:90}});
 const out=await p.searchCompanies(input);
 assert.deepEqual(calls,[{p_departments:['69'],p_since:'2026-08-28',p_naf_prefixes:['56'],p_limit:20}]);
 assert.equal(out.length,1,'a malformed row is dropped');
 const c=p.normalizeResult(out[0]);
 assert.equal(c.name,'LE BON GOÛT');assert.equal(c.deduplication_key,'siren:552100554');
 assert.match(c.source_title,/^A cédé un fonds, annonce publiée au BODACC le 20 novembre 2026 : Restaurant$/);
 assert.equal((c.raw_metadata.bodacc_sale as {role:string}).role,'seller');
 assert.equal(readSellerRow({...row,sale:{...row.sale,url:'https://evil.example/x'}}),null);
 await assert.rejects(new BodaccSalesProvider({sellers:async()=>{throw Error('x')}}).searchCompanies(input),/BODACC_UNAVAILABLE/,'its Discovery unit is given back');
 assert.throws(()=>DiscoveryInputSchema.parse({project_id:'p',query:'xx',location:'Rhône',categories:[],optional_filters:{naf_prefixes:['DROP']}}));
 assert.throws(()=>DiscoveryInputSchema.parse({project_id:'p',query:'xx',location:'Rhône',categories:[],optional_filters:{period_days:7}}));
 setSaleSearch({party:'seller',naf:['56'],periodDays:180});
 assert.deepEqual(providerSpecificFilters('bodacc_sales',null),{sale_party:'seller',period_days:180,naf_prefixes:['56']});
 assert.deepEqual(providerSpecificFilters('registry',{min:1,max:5}),{employee_range:{min:1,max:5}});
 setSaleSearch(DEFAULT_SALE_SEARCH);
 assert.deepEqual(providerSpecificFilters('bodacc_sales',null),{sale_party:'buyer',period_days:90});
});

test('screen — the options of the BODACC source and the seller line; « personne physique, non affiché »',()=>{
 const v=read('src/ui/v2/search/SaleOptions.tsx');
 assert.match(v,/sellers:'Entreprises ayant cédé un fonds'/);
 assert.match(v,/s\.kind==='PM'&&typeof s\.siren==='string'&&\/\^\\d\{9\}\$\/\.test\(s\.siren\)\?t\.sellerPm\(s\.siren\):s\.kind==='PP'\?t\.sellerPp:t\.sellerUnknown/);
 const nat=read('src/ui/v2/search/SearchNative.tsx');
 assert.match(nat,/\{f\.provider==='bodacc_sales'&&<SaleOptions locale=\{m\.locale\}\/>\}/);
 assert.match(nat,/<SellerLine meta=\{f\.meta as Record<string,unknown>\} locale=\{locale\}\/>/);
});

test('bundle — the privileged client never reaches the browser: the provider (also bundled for the browser) does not import it',()=>{
 const provider=read('src/discovery/providers/bodacc-sales.ts');
 assert.doesNotMatch(provider,/admin-client|createAdminClient|SUPABASE_SERVICE_ROLE_KEY/,'the server registers the reader');
 assert.match(read('src/discovery/sellers-reader.server.ts'),/registerSellersReader\(async args=>\{/);
 assert.match(read('app/api/v1/[...path]/route.ts'),/import '\.\.\/\.\.\/\.\.\/\.\.\/src\/discovery\/sellers-reader\.server';/);
});
