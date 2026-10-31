// Company-creation barometer (src/domain/company-creations.ts, src/components/CompanyCreations.tsx, app/creations-entreprises):
// totals only, a fixed register host, bounded answers, an error rather than a page of zeros, and pages that never
// depend on the network at build time.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 BODACC_DATASET,CREATIONS_DEPARTMENTS,CREATIONS_HUB,CreationsUnavailableError,EXPORT_FIELDS,MIN_COMMUNE_NOTICES,
 addMonths,aggregate,classifyActivity,creationsPath,creationsSitemapEntries,departmentBySlug,fetchDepartmentCreations,fetchRegionCreations,
 getBodaccJson,legalKind,monthExportUrl,monthlyCountsUrl,monthlySeries,noticeOf,percentChange,regionCountsUrl,reportMonth,
} from '../src/domain/company-creations.ts';

const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const NOW=new Date('2026-10-31T09:00:00Z');
const PERSON="Immatriculation d'une personne physique suite à création d'un établissement principal";
const COMPANY="Immatriculation d'une personne morale (B, C, D) suite à création d'un établissement principal";
const NO_ACTIVITY="Immatriculation d'une personne morale (B, D) sans activité";
const row=(category:string,activity:string|null,ville:string|null,extra:Record<string,unknown>={})=>({
 ville,acte:JSON.stringify({dateImmatriculation:'2026-09-10',creation:{categorieCreation:category}}),
 listeetablissements:activity===null?null:JSON.stringify({etablissement:{origineFonds:'Création',activite:activity,adresse:{nomVoie:'de Bayard',ville}}}),...extra});

test('departments — the 13 of Occitanie, unique slugs, hand-written prepositions',()=>{
 assert.equal(CREATIONS_DEPARTMENTS.length,13);
 assert.deepEqual(CREATIONS_DEPARTMENTS.map(d=>d.code),['09','11','12','30','31','32','34','46','48','65','66','81','82']);
 assert.equal(new Set(CREATIONS_DEPARTMENTS.map(d=>d.slug)).size,13);
 for(const d of CREATIONS_DEPARTMENTS){assert.match(d.slug,/^[a-z-]+$/);assert.match(d.in,/^(?:en |dans (?:le |la |les |l’))/);assert.ok(d.prefecture)}
 assert.equal(departmentBySlug('haute-garonne')?.in,'en Haute-Garonne');
 assert.equal(departmentBySlug('gers')?.in,'dans le Gers');
 assert.equal(departmentBySlug('paris'),null,'a department outside the list is a 404, never a guess');
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
 for(const url of [monthlyCountsUrl('31','2025-09','2026-10'),regionCountsUrl('2026-08','2026-10'),monthExportUrl('31','2026-09')]){
  assert.ok(url.startsWith(`${BODACC_DATASET}/`),url);
  const where=new URL(url).searchParams.get('where')!;
  assert.match(where,/^familleavis="creation" and /);
 }
 const ex=new URL(monthExportUrl('31','2026-09'));
 assert.equal(ex.searchParams.get('select'),EXPORT_FIELDS);
 assert.doesNotMatch(EXPORT_FIELDS,/commercant|registre|listepersonnes/);
 assert.match(ex.searchParams.get('where')!,/numerodepartement="31" and dateparution>=date'2026-09-01' and dateparution<date'2026-10-01'$/);
 assert.equal(new URL(monthlyCountsUrl('2A','2026-01','2026-02')).searchParams.get('select'),'count(*) as n','group_by aliases are not redeclared');
 assert.match(new URL(regionCountsUrl('2026-08','2026-10')).searchParams.get('where')!,/region_code=76/);
 assert.throws(()=>monthExportUrl('31" or "1"="1','2026-09'),CreationsUnavailableError,'the department code is validated before entering the query');
});

// A fake register: answers by endpoint; records every call.
function register(o:{counts?:unknown;rows?:unknown;status?:number;region?:unknown}={}){
 const calls:{url:string;init:RequestInit|undefined}[]=[];
 const fetchImpl=(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=String(input);calls.push({url,init});
  if(o.status)return new Response('{}',{status:o.status});
  const body=url.includes('/exports/json')?o.rows:url.includes('region_code')?o.region:o.counts;
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

test('region figures — every department, sorted, an empty month is an error',async()=>{
 const region={results:[{dep:'31',mois:'2026-09',n:1236},{dep:'31',mois:'2026-08',n:953},{dep:'32',mois:'2026-09',n:182},{dep:'34',mois:'2026-09',n:1054}]};
 const r=await fetchRegionCreations({fetchImpl:register({region}).fetchImpl,now:NOW});
 assert.equal(r.month,'2026-09');
 assert.equal(r.total,2472);
 assert.equal(r.rows.length,13);
 assert.deepEqual(r.rows.slice(0,3).map(x=>[x.department.code,x.count,x.previous]),[['31',1236,953],['34',1054,0],['32',182,0]]);
 await assert.rejects(fetchRegionCreations({fetchImpl:register({region:{results:[]}}).fetchImpl,now:NOW}),/EMPTY/);
});

test('pages — titles, descriptions and wording stay within the SEO rules, no name ever printed',async()=>{
 // The component module is TSX: its pure page builders are checked through their source contract here, and the
 // rendered HTML is checked on the built site (tests/seo-html.mjs pattern) by the person on the Preview.
 const src=read('src/components/CompanyCreations.tsx');
 assert.match(src,/titled=\(base:string\)=>`\$\{base\} \| ProspectOS`\.length<=75/,'the title never exceeds 75 characters with the brand');
 assert.match(src,/La répartition par activité est indicative/);
 assert.match(src,/Ce n’est pas le code NAF officiel/);
 assert.match(src,/Aucune entreprise n’est nommée ici/);
 assert.doesNotMatch(src,/\.(?:commercant|registre|listepersonnes|siren|siret)\b/,'the pages never read a name, a register number or people');
 assert.doesNotMatch(src,/#[0-9a-f]{3,8}\b|rgba?\(/i,'design tokens only');
 // Longest department name + longest month: still a valid title.
 const longest=CREATIONS_DEPARTMENTS.map(d=>`Créations d’entreprises ${d.in} (${d.code})\u202f: septembre 2026`).sort((a,b)=>b.length-a.length)[0]!;
 assert.ok(longest.length<=75,longest);
});

test('routes — on-demand ISR, no register call at build for departments, a build-only fallback for the hub',()=>{
 const dep=read('app/creations-entreprises/[departement]/page.tsx');
 assert.match(dep,/export const revalidate=86400;/);
 assert.match(dep,/export async function generateStaticParams\(\)\{return \[\]\}/);
 assert.match(dep,/if\(!department\)notFound\(\);/);
 assert.match(dep,/<PublicSeoPage page=\{page\}>/);
 assert.doesNotMatch(dep,/catch/,'a department page never renders a fallback of zeros');
 const hub=read('app/creations-entreprises/page.tsx');
 assert.match(hub,/export const revalidate=86400;/);
 assert.match(hub,/catch\(e\)\{if\(process\.env\.NEXT_PHASE!=='phase-production-build'\)throw e\}/,'at run time an error keeps the last good page');
 assert.match(hub,/<PublicSeoPage page=\{page\}>/);
 assert.match(read('src/ui/v2/public/PublicSite.tsx'),/<li><Link href="\/creations-entreprises">Créations d’entreprises<\/Link><\/li>/,'linked from every public page');
});

test('sitemap — hub and 13 departments, dated by the month that closed, not by the build',()=>{
 const entries=creationsSitemapEntries('https://prospectos.fr',NOW);
 assert.equal(entries.length,14);
 assert.equal(entries[0]!.url,`https://prospectos.fr/${CREATIONS_HUB}`);
 assert.ok(entries.every(e=>e.lastModified==='2026-10-01'));
 assert.equal(new Set(entries.map(e=>e.url)).size,14);
 const sitemap=read('app/sitemap.ts');
 assert.match(sitemap,/\.\.\.sitemapEntries,\.\.\.creationsSitemapEntries\(SITE_URL,new Date\(\)\)/);
 assert.match(sitemap,/export const revalidate=86400;/);
});
