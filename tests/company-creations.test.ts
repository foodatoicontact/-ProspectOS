// Company-creation barometer (src/domain/company-creations.ts, src/components/CompanyCreations.tsx, app/creations-entreprises),
// for every French department and region:
// totals only, a fixed register host, bounded answers, an error rather than a page of zeros, and pages that never
// depend on the network at build time.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 BODACC_DATASET,CREATIONS_DEPARTMENTS,CREATIONS_HUB,CREATIONS_REGIONS,CreationsUnavailableError,EXPORT_FIELDS,MIN_COMMUNE_NOTICES,
 addMonths,aggregate,arrondissement,last12Months,classifyActivity,creationsPath,creationsSitemapEntries,departmentBySlug,fetchDepartmentCreations,fetchFranceCreations,fetchRegionCreations,
 creationsTitle,getBodaccJson,legalKind,monthExportUrl,monthlyCountsUrl,monthlySeries,noticeOf,percentChange,regionBySlug,regionOf,reportMonth,slugOf,zoneBySlug,zoneCountsUrl,
} from '../src/domain/company-creations.ts';

const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const NOW=new Date('2026-10-31T09:00:00Z');
const PERSON="Immatriculation d'une personne physique suite à création d'un établissement principal";
const COMPANY="Immatriculation d'une personne morale (B, C, D) suite à création d'un établissement principal";
const NO_ACTIVITY="Immatriculation d'une personne morale (B, D) sans activité";
const row=(category:string,activity:string|null,ville:string|null,extra:Record<string,unknown>={})=>({
 ville,acte:JSON.stringify({dateImmatriculation:'2026-09-10',creation:{categorieCreation:category}}),
 listeetablissements:activity===null?null:JSON.stringify({etablissement:{origineFonds:'Création',activite:activity,adresse:{nomVoie:'de Bayard',ville}}}),...extra});

test('zones — the 101 departments and the 13 regions of several departments, unique slugs, hand-written prepositions',()=>{
 assert.equal(CREATIONS_DEPARTMENTS.length,101);
 assert.equal(CREATIONS_REGIONS.length,13,'the five overseas regions have one department each: their department page is the page');
 const slugs=[...CREATIONS_DEPARTMENTS.map(d=>d.slug),...CREATIONS_REGIONS.map(r=>r.slug)];
 assert.equal(new Set(slugs).size,slugs.length,'a slug names one zone only');
 for(const d of CREATIONS_DEPARTMENTS){assert.match(d.slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);assert.match(d.in,/^(?:en |à |dans (?:le |la |les |l’))/,d.name);assert.doesNotMatch(d.in,/département/,`${d.name}: preposition written by hand`)}
 for(const r of CREATIONS_REGIONS)assert.match(r.in,/^(?:en |dans (?:le |les ))/,r.name);
 assert.equal(CREATIONS_REGIONS.reduce((s,r)=>s+r.departments.length,0),96,'every metropolitan department belongs to exactly one region page');
 assert.equal(departmentBySlug('haute-garonne')?.in,'en Haute-Garonne');
 assert.equal(departmentBySlug('gers')?.in,'dans le Gers');
 assert.equal(departmentBySlug('paris')?.in,'à Paris');
 assert.equal(departmentBySlug('cote-d-or')?.code,'21');
 assert.equal(departmentBySlug('la-reunion')?.code,'974');
 assert.equal(regionBySlug('ile-de-france')?.departments.length,8);
 assert.equal(regionBySlug('ile-de-france')?.in,'en Île-de-France');
 assert.equal(regionBySlug('la-reunion'),null);
 assert.equal(regionOf(departmentBySlug('paris')!)?.slug,'ile-de-france');
 assert.equal(regionOf(departmentBySlug('mayotte')!),null);
 assert.equal(zoneBySlug('occitanie')?.kind,'region');
 assert.equal(zoneBySlug('tarn')?.kind,'department');
 assert.equal(zoneBySlug('aller'),null);
 assert.equal(zoneBySlug('atlantide'),null,'a zone outside the list is a 404, never a guess');
 assert.equal(slugOf('Provence-Alpes-Côte d’Azur'),'provence-alpes-cote-d-azur');
 assert.equal(creationsPath(departmentBySlug('tarn')!),'creations-entreprises/tarn');
});

test('months — the reported month is the last complete one, across a year boundary',()=>{
 assert.equal(reportMonth(NOW),'2026-09');
 assert.equal(reportMonth(new Date('2026-01-01T00:30:00Z')),'2025-12');
 assert.equal(addMonths('2026-01',-1),'2025-12');
 assert.equal(addMonths('2025-12',1),'2026-01');
 assert.equal(addMonths('2026-09',-12),'2025-09');
 assert.equal(percentChange(120,100),20);
 assert.equal(percentChange(80,100),-20);
 assert.equal(percentChange(5,0),null,'no base, no percentage');
 assert.equal(percentChange(5,null),null);
});

test('12 months — the last 12 complete months of the series, never a partial year',()=>{
 const trend=Array.from({length:13},(_,i)=>({month:addMonths('2025-09',i),count:i+1}));
 assert.deepEqual(last12Months(trend),{total:90,from:'2025-10',to:'2026-09'},'2+3+…+13: the oldest month (sept. 2025) is left out');
 assert.equal(last12Months(trend.slice(2)),null,'11 months are not a year');
 const src=read('src/components/CompanyCreations.tsx');
 assert.match(src,/<dt>Sur les 12 derniers mois<\/dt>/,'a tile on every zone page');
 assert.match(src,/=>\/\^\[aeiouyàâéèêëîïôûüœ\]\/i\.test\(label\)\?`d’\$\{label\}`:`de \$\{label\}`/,'« d’octobre », never « de octobre »');
 assert.match(src,/Combien d’entreprises sont créées chaque année \$\{where\} \?/,'the yearly question people search');
 assert.match(src,/les bilans annuels de l’INSEE et de Bpifrance, qui incluent les micro-entrepreneurs non commerçants, les artisans et les professions libérales, sont plus élevés/,'never presented as the official yearly total');
});

test('activities — deterministic first match, real wordings of the register',()=>{
 const cases:[string,string][]=[
  ['Livraison de repas à domicile à vélo électrique','DELIVERY'],
  ['Coursier à vélo : livraison de repas à vélo.','DELIVERY'],
  ['Livreur non motorisé','DELIVERY'],
  ['Acquisition, gestion, location et administration de biens immobiliers propres.','REAL_ESTATE'],
  ["L'acquisition, la propriété, l'échange, l'administration ou la gestion de tout placement, tel que les valeurs mobilières",'HOLDING'],
  ['Restauration rapide sur place et à emporter','FOOD'],
  ['Traiteur (sans local)','FOOD'],
  ['Travaux de terrassement courant et travaux préparatoires','CONSTRUCTION'],
  ['Achat vente et reprise de véhicules d’occasions','TRANSPORT'],
  ['Création, impression et vente en ligne de posters et d’affiches décoratives.','ONLINE_RETAIL'],
  ["Création, développement, maintenance et amélioration de sites internet et d'applications Web.",'DIGITAL'],
  ['Salon de coiffure. Achat vente des accessoires de coiffure.','BEAUTY'],
  ["La profession de pharmacien d'officine",'HEALTH'],
  ['Le courtage et intermédiaire en assurances.','SERVICES'],
  ['Brocante','RETAIL'],
  ['Élevage de chevaux','OTHER'],
  ['','OTHER'],
 ];
 for(const [text,key] of cases)assert.equal(classifyActivity(text),key,text);
 assert.equal(classifyActivity(null),'OTHER');
});

test('notices — legal kind from the category, first establishment with an activity, malformed JSON tolerated',()=>{
 assert.equal(legalKind(PERSON),'INDIVIDUAL');
 assert.equal(legalKind(COMPANY),'COMPANY');
 assert.equal(legalKind(NO_ACTIVITY),'COMPANY_NO_ACTIVITY');
 assert.equal(legalKind('Autre chose'),'OTHER');
 assert.deepEqual(noticeOf(row(PERSON,'Livraison de repas à vélo','  Toulouse ')),{kind:'INDIVIDUAL',activity:'DELIVERY',commune:'Toulouse'});
 assert.deepEqual(noticeOf(row(NO_ACTIVITY,null,'Balma')),{kind:'COMPANY_NO_ACTIVITY',activity:'NO_ACTIVITY',commune:'Balma'});
 const two={ville:'Muret',acte:JSON.stringify({creation:{categorieCreation:COMPANY}}),listeetablissements:JSON.stringify({etablissement:[{activite:''},{activite:'Pizzeria'}]})};
 assert.equal(noticeOf(two).activity,'FOOD');
 assert.deepEqual(noticeOf({ville:42,acte:'{not json',listeetablissements:'['}),{kind:'OTHER',activity:'OTHER',commune:null});
});

test('arrondissements — Paris, Lyon, Marseille from the postal code of the notice, nothing guessed',()=>{
 assert.equal(arrondissement('Paris','75011'),'Paris 11e');
 assert.equal(arrondissement('Paris','75001'),'Paris 1er');
 assert.equal(arrondissement('Paris','75116'),'Paris 16e');
 assert.equal(arrondissement('Lyon','69003'),'Lyon 3e');
 assert.equal(arrondissement('Marseille','13008'),'Marseille 8e');
 assert.equal(arrondissement('Paris','75021'),null,'no 21st arrondissement');
 assert.equal(arrondissement('Paris',null),null);
 assert.equal(arrondissement('Toulouse','31000'),null);
 const withPostal=(ville:string,cp:string)=>({ville,acte:JSON.stringify({creation:{categorieCreation:COMPANY}}),listeetablissements:JSON.stringify({etablissement:{activite:'Conseil',adresse:{codePostal:cp}}})});
 assert.equal(noticeOf(withPostal('Paris','75018')).commune,'Paris 18e');
 assert.equal(noticeOf(withPostal('Paris','92100')).commune,'Paris','an unexpected postal code leaves the commune as written');
});

test('aggregation — totals only, small communes never shown, "other" always last',()=>{
 const notices=[
  ...Array.from({length:7},()=>noticeOf(row(PERSON,'Livraison de repas à vélo','Toulouse'))),
  ...Array.from({length:MIN_COMMUNE_NOTICES},()=>noticeOf(row(COMPANY,'Élevage','Muret'))),
  noticeOf(row(COMPANY,'Pizzeria','Saint-Lys')),
  noticeOf(row(NO_ACTIVITY,null,'Saint-Lys')),
  noticeOf(row(PERSON,'Coiffure','Le Fousseret')),
 ];
 const a=aggregate(notices);
 assert.equal(a.total,15);
 assert.deepEqual(a.kinds,{individual:8,company:6,companyNoActivity:1,other:0});
 assert.deepEqual(a.communes.map(c=>[c.label,c.count]),[['Toulouse',7],['Muret',MIN_COMMUNE_NOTICES]]);
 assert.equal(a.communesHidden,2,'Saint-Lys (2) and Le Fousseret (1) are counted, never listed');
 assert.deepEqual(a.activities.map(x=>x.key),['DELIVERY','BEAUTY','FOOD','OTHER','NO_ACTIVITY']);
 assert.equal(a.activities.reduce((s,x)=>s+x.count,0),15);
 assert.ok(!JSON.stringify(a).includes('Bayard'),'no address ever reaches the published figures');
 assert.deepEqual(aggregate([]),{total:0,kinds:{individual:0,company:0,companyNoActivity:0,other:0},activities:[],communes:[],communesHidden:0});
});

test('queries — one fixed host, creation notices only, never a name or a register number',()=>{
 for(const url of [monthlyCountsUrl('31','2025-09','2026-10'),zoneCountsUrl(['31','32'],'2026-08','2026-10'),zoneCountsUrl(null,'2026-08','2026-10'),monthExportUrl('31','2026-09')]){
  assert.ok(url.startsWith(`${BODACC_DATASET}/`),url);
  const where=new URL(url).searchParams.get('where')!;
  assert.match(where,/^familleavis="creation" and /);
 }
 const ex=new URL(monthExportUrl('31','2026-09'));
 assert.equal(ex.searchParams.get('select'),EXPORT_FIELDS);
 assert.doesNotMatch(EXPORT_FIELDS,/commercant|registre|listepersonnes/);
 assert.match(ex.searchParams.get('where')!,/numerodepartement="31" and dateparution>=date'2026-09-01' and dateparution<date'2026-10-01'$/);
 assert.equal(new URL(monthlyCountsUrl('2A','2026-01','2026-02')).searchParams.get('select'),'count(*) as n','group_by aliases are not redeclared');
 assert.match(new URL(zoneCountsUrl(['75','92'],'2026-08','2026-10')).searchParams.get('where')!,/^familleavis="creation" and \(numerodepartement="75" or numerodepartement="92"\) and /);
 assert.match(new URL(monthExportUrl('974','2026-09')).searchParams.get('where')!,/numerodepartement="974"/,'overseas codes are accepted');
 assert.throws(()=>zoneCountsUrl(['75','x'],'2026-08','2026-10'),CreationsUnavailableError);
 assert.throws(()=>monthExportUrl('31" or "1"="1','2026-09'),CreationsUnavailableError,'the department code is validated before entering the query');
});

// A fake register: answers by endpoint; records every call.
function register(o:{counts?:unknown;rows?:unknown;status?:number;region?:unknown}={}){
 const calls:{url:string;init:RequestInit|undefined}[]=[];
 const fetchImpl=(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=String(input);calls.push({url,init});
  if(o.status)return new Response('{}',{status:o.status});
  const body=url.includes('/exports/json')?o.rows:url.includes('dep%2C')||url.includes('dep,')?o.region:o.counts;
  return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
 }) as typeof fetch;
 return {fetchImpl,calls};
}
const trendRows=(last:number)=>[{mois:'2025-09',n:80},{mois:'2026-08',n:4},{mois:'2026-09',n:last}];
const hg=departmentBySlug('haute-garonne')!;

test('department figures — 13 months with zeros filled in, previous month and year over year',async()=>{
 const rows=[row(PERSON,'Livraison de repas à vélo','Toulouse'),row(PERSON,'Livraison à vélo','Toulouse'),row(COMPANY,'Pizzeria','Toulouse'),row(COMPANY,'Conseil','Toulouse'),row(COMPANY,'Brocante','Toulouse'),row(NO_ACTIVITY,null,'Muret')];
 const {fetchImpl,calls}=register({counts:{results:trendRows(6)},rows});
 const d=await fetchDepartmentCreations(hg,{fetchImpl,now:NOW});
 assert.equal(d.month,'2026-09');
 assert.equal(d.total,6);
 assert.equal(d.trend.length,13);
 assert.equal(d.trend[0]!.month,'2025-09');
 assert.equal(d.trend.filter(t=>t.count===0).length,10,'months without any row really had no notice');
 assert.deepEqual(d.previous,{month:'2026-08',count:4});
 assert.deepEqual(d.lastYear,{month:'2025-09',count:80});
 assert.deepEqual(d.communes.map(c=>c.label),['Toulouse']);
 assert.equal(calls.length,2);
 for(const c of calls){assert.equal(c.init?.redirect,'error');assert.ok(c.init?.signal,'bounded in time')}
});

test('department figures — an incomplete, failed or malformed answer is an error, never zeros',async()=>{
 const rows=[row(PERSON,'Livraison à vélo','Toulouse')];
 await assert.rejects(fetchDepartmentCreations(hg,{fetchImpl:register({counts:{results:trendRows(2)},rows}).fetchImpl,now:NOW}),/INCONSISTENT/);
 await assert.rejects(fetchDepartmentCreations(hg,{fetchImpl:register({status:503}).fetchImpl,now:NOW}),/HTTP_503/);
 await assert.rejects(fetchDepartmentCreations(hg,{fetchImpl:register({counts:{error:'x'},rows}).fetchImpl,now:NOW}),/MALFORMED/);
 await assert.rejects(fetchDepartmentCreations(hg,{fetchImpl:register({counts:{results:trendRows(1)},rows:{oops:1}}).fetchImpl,now:NOW}),/MALFORMED/);
 await assert.rejects(fetchDepartmentCreations(hg,{fetchImpl:register({counts:{results:[{mois:'2026-09',n:-1}]},rows}).fetchImpl,now:NOW}),/MALFORMED/);
 assert.throws(()=>monthlySeries([{mois:'septembre',n:1}],'2026-09','2026-10'),/MALFORMED/);
});

test('register client — fixed host, one retry on a network failure, bounded size',async()=>{
 await assert.rejects(getBodaccJson('https://example.org/x',fetch,{timeoutMs:1000,maxBytes:10}),/HOST_NOT_ALLOWED/);
 let attempts=0;
 const flaky=(async()=>{attempts++;if(attempts===1)throw new TypeError('fetch failed');return new Response('{"results":[]}')}) as typeof fetch;
 assert.deepEqual(await getBodaccJson(`${BODACC_DATASET}/records`,flaky,{timeoutMs:1000,maxBytes:1000}),{results:[]});
 assert.equal(attempts,2);
 const down=(async()=>{throw new TypeError('fetch failed')}) as typeof fetch;
 await assert.rejects(getBodaccJson(`${BODACC_DATASET}/records`,down,{timeoutMs:1000,maxBytes:1000}),/UNREACHABLE/);
 const big=(async()=>new Response('x'.repeat(5000))) as typeof fetch;
 await assert.rejects(getBodaccJson(`${BODACC_DATASET}/records`,big,{timeoutMs:1000,maxBytes:1000}),/TOO_LARGE/);
});

test('region and France figures — one grouped query, every department, 13-month trend, an empty month is an error',async()=>{
 const region={results:[{dep:'31',mois:'2026-09',n:1236},{dep:'31',mois:'2026-08',n:953},{dep:'31',mois:'2025-09',n:853},{dep:'32',mois:'2026-09',n:182},{dep:'34',mois:'2026-09',n:1054},{dep:'99',mois:'2026-09',n:7}]};
 const {fetchImpl,calls}=register({region});
 const r=await fetchRegionCreations(regionBySlug('occitanie')!,{fetchImpl,now:NOW});
 assert.equal(calls.length,1);
 assert.equal(r.month,'2026-09');
 assert.equal(r.total,2472,'a code outside the zone (99) never enters the total');
 assert.equal(r.rows.length,13);
 assert.deepEqual(r.rows.slice(0,3).map(x=>[x.department.code,x.count,x.previous,x.lastYear]),[['31',1236,953,853],['34',1054,0,0],['32',182,0,0]]);
 assert.equal(r.trend.length,13);
 assert.deepEqual(r.previous,{month:'2026-08',count:953});
 assert.deepEqual(r.lastYear,{month:'2025-09',count:853});
 const f=await fetchFranceCreations({fetchImpl:register({region}).fetchImpl,now:NOW});
 assert.equal(f.rows.length,101);
 assert.equal(f.total,2472);
 await assert.rejects(fetchRegionCreations(regionBySlug('occitanie')!,{fetchImpl:register({region:{results:[]}}).fetchImpl,now:NOW}),/EMPTY/);
 await assert.rejects(fetchFranceCreations({fetchImpl:register({region:{results:[{dep:3,mois:'2026-09',n:1}]}}).fetchImpl,now:NOW}),/MALFORMED/);
});

test('pages — titles, descriptions and wording stay within the SEO rules, no name ever printed',async()=>{
 // The component module is TSX: its pure page builders are checked through their source contract here, and the
 // rendered HTML is checked on the built site (tests/seo-html.mjs pattern) by the person on the Preview.
 const src=read('src/components/CompanyCreations.tsx');
 assert.match(src,/title:creationsTitle\(dep\.in,dep\.code,month\)/);
 assert.match(src,/title:creationsTitle\(place\.in,null,month\)/);
 assert.match(src,/La répartition par activité est indicative/);
 assert.match(src,/Ce n’est pas le code NAF officiel/);
 assert.match(src,/Aucune entreprise n’est nommée ici/);
 assert.doesNotMatch(src,/\.(?:commercant|registre|listepersonnes|siren|siret)\b/,'the pages never read a name, a register number or people');
 assert.doesNotMatch(src,/#[0-9a-f]{3,8}\b|rgba?\(/i,'design tokens only');
 // Longest department name + longest month: still a valid title.
 // Every zone, the longest French month name: always within 75 characters, the code dropped only when needed.
 for(const d of CREATIONS_DEPARTMENTS)assert.ok(creationsTitle(d.in,d.code,'septembre 2026').length<=75,d.name);
 for(const r of CREATIONS_REGIONS)assert.ok(creationsTitle(r.in,null,'septembre 2026').length<=75,r.name);
 assert.equal(creationsTitle('en Haute-Garonne','31','septembre 2026'),'Créations d’entreprises en Haute-Garonne (31)\u202f: septembre 2026 | ProspectOS');
 assert.equal(creationsTitle('dans les Alpes-de-Haute-Provence','04','septembre 2026'),'Créations d’entreprises dans les Alpes-de-Haute-Provence\u202f: septembre 2026');
 assert.equal(creationsTitle('en France',null,null),'Créations d’entreprises en France par département | ProspectOS');
});

test('routes — on-demand ISR, no register call at build for zones, a build-only fallback for France, a closed picker',()=>{
 const zone=read('app/creations-entreprises/[zone]/page.tsx');
 assert.match(zone,/export const revalidate=86400;/);
 assert.match(zone,/export async function generateStaticParams\(\)\{return \[\]\}/);
 assert.match(zone,/if\(!zone\)notFound\(\);/);
 assert.match(zone,/<PublicSeoPage page=\{z\.page\}>/);
 assert.doesNotMatch(zone,/catch/,'a zone page never renders a fallback of zeros');
 const hub=read('app/creations-entreprises/page.tsx');
 assert.match(hub,/export const revalidate=86400;/);
 assert.match(hub,/catch\(e\)\{if\(process\.env\.NEXT_PHASE!=='phase-production-build'\)throw e\}/,'at run time an error keeps the last good page');
 assert.match(hub,/<PublicSeoPage page=\{page\}>/);
 const go=read('app/creations-entreprises/aller/route.ts');
 assert.match(go,/const zone=zoneBySlug\(slug\);/,'only a slug of the closed list is followed');
 assert.match(go,/new URL\(path,request\.nextUrl\.origin\)/,'same-origin redirect');
 assert.match(read('src/components/CompanyCreations.tsx'),/action=\{`\/\$\{CREATIONS_HUB\}\/aller`\} method="get"/,'the picker works without JavaScript');
 assert.match(read('src/ui/v2/public/PublicSite.tsx'),/<li><Link href="\/creations-entreprises">Créations d’entreprises<\/Link><\/li>/,'linked from every public page');
 const shell=read('src/ui/v2/public/PublicSite.tsx');
 assert.match(shell,/const creations=<Link className="pos-public__navlink" href="\/creations-entreprises">/);
 assert.equal((shell.match(/\{creations\}/g)??[]).length,2,'in the header bar (desktop) and in the menu (phones)');
 assert.match(read('src/ui/v2/home/HomeV2.tsx'),/creations:locale==='en'\?'New businesses \(FR\)':'Créations d’entreprises'/,'the homepage header too, in its language');
 // The homepage hero says who it is for and links the public proof (the barometer) under its calls to action.
 const home=read('src/ui/v2/home/HomeV2.tsx');
 assert.match(home,/<p className="pos-home__lead">\{copy\.hero\.audience\}<\/p>/);
 assert.match(home,/<a className="pos-home__textlink pos-home__barometer" href="\/creations-entreprises">\{copy\.hero\.barometer\}/);
 assert.ok(home.indexOf('pos-home__barometer')>home.indexOf('data-testid="home-cta"'),'below the trial call to action, never above it');
});

test('app — the logged-in space links the barometer: "Aujourd’hui" empty state and the account menu, opened beside the app',()=>{
 const today=read('src/ui/v2/today/TodayV2.tsx');
 assert.match(today,/<a className="pos-empty__link" href="\/creations-entreprises" target="_blank" rel="noopener">\{t\.creations\}/);
 assert.match(today,/creations:'Voir les entreprises créées ce mois-ci dans votre département'/);
 const menu=read('src/ui/v2/shell/UserMenu.tsx');
 assert.match(menu,/<a className="pos-menu__item" href="\/creations-entreprises" target="_blank" rel="noopener" onClick=\{p\.onDone\}>/,'the menu closes, the app stays open');
 assert.match(menu,/creations:'Créations d’entreprises'/);
});

test('sitemap — France, 13 regions and 101 departments, dated by the month that closed, not by the build',()=>{
 const entries=creationsSitemapEntries('https://prospectos.fr',NOW);
 assert.equal(entries.length,115);
 assert.equal(entries[0]!.url,`https://prospectos.fr/${CREATIONS_HUB}`);
 assert.ok(entries.every(e=>e.lastModified==='2026-10-01'));
 assert.equal(new Set(entries.map(e=>e.url)).size,115);
 const sitemap=read('app/sitemap.ts');
 assert.match(sitemap,/\.\.\.sitemapEntries,offer,\.\.\.creationsSitemapEntries\(SITE_URL,new Date\(\)\)/);
 assert.match(sitemap,/url:`\$\{SITE_URL\}\/prospects-de-votre-zone`,lastModified:'2026-11-01'/,'the offer page, dated by its own last edit');
 assert.match(sitemap,/export const revalidate=86400;/);
});
