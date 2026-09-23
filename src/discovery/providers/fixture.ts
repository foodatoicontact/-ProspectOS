import {CandidateSchema,type Candidate,type DiscoveryProvider,type DiscoveryInput} from '../types.ts';
import {DeduplicationService} from '../deduplication.ts';
import {isRestaurantPresetActive} from '../strategies/restaurant.ts';
export const FIXTURE_LABEL='TEST — données synthétiques, aucune recherche Internet';
// All fixture hosts live under this suffix. It is the single source of truth for "is this URL a
// deterministic ProspectOS fixture" — used both by the discovery guard (FIXTURE_WEBSITE_MISMATCH)
// and by the fetcher below. No per-URL hack lives in the analysis business logic.
export const FIXTURE_HOST_SUFFIX='.fixture.example';
export function isFixtureUrl(url:string):boolean{try{return new URL(url).hostname.toLowerCase().endsWith(FIXTURE_HOST_SUFFIX)}catch{return false}}

type FixtureCompany={name:string;website:string;city:string;address:string;phone:string|null;homepage:string;contact:string};

// Restaurant-flavoured dataset — used when the project's ICP itself carries a Foodatoi-style key.
export const RESTAURANT_FIXTURE_COMPANIES:FixtureCompany[]=[
 {name:'TEST — Burger Démonstration',website:'https://burger.fixture.example/menu',city:'Toulouse',address:'1 rue fictive — TEST',phone:'05 00 00 00 01',
 homepage:'<html><head><title>TEST — Restaurant Toulouse</title></head><body><p>Restaurant de burgers à Toulouse.</p><p>Commandez au 05 00 00 00 01.</p><p>Disponible sur Uber Eats et Deliveroo.</p><p>Commandes par Instagram.</p><p>Click & collect et retrait sur place.</p><p>Livraison directe.</p><a href="/contact">Contact</a></body></html>',
 contact:'<html><head><title>TEST — Contact Burger Démonstration</title></head><body><p>Contactez-nous au 05 00 00 00 01 ou via ce formulaire de contact.</p></body></html>'},
 {name:'TEST — Boulangerie Démonstration',website:'https://pain.fixture.example/',city:'Toulouse',address:'2 rue fictive — TEST',phone:'05 00 00 00 02',
 homepage:'<html><head><title>TEST — Boulangerie Toulouse</title></head><body><p>Boulangerie artisanale à Toulouse.</p><p>Commandez au 05 00 00 00 02.</p><p>Commandes par Instagram.</p><p>Click & collect et retrait sur place.</p><a href="/contact">Contact</a></body></html>',
 contact:'<html><head><title>TEST — Contact Boulangerie Démonstration</title></head><body><p>Contactez-nous au 05 00 00 00 02 ou via ce formulaire de contact.</p></body></html>'},
 {name:'TEST — Snack Démonstration',website:'https://snack.fixture.example/',city:'Albi',address:'3 rue fictive — TEST',phone:null,
 homepage:'<html><head><title>TEST — Snack Albi</title></head><body><p>Snack rapide à Albi.</p><p>Disponible sur Uber Eats et Deliveroo.</p><p>Livraison directe par nos équipes.</p><a href="/contact">Contact</a></body></html>',
 contact:'<html><head><title>TEST — Contact Snack Démonstration</title></head><body><p>Contactez-nous via ce formulaire de contact.</p></body></html>'}
];
// Generic B2B dataset — used for any other ICP (SaaS, services, etc.), demonstrating that Discovery
// is not restaurant-only. Content is generic business language, never tailored to a hardcoded
// criterion key: ObservationService's generic matcher (candidate-only, never conclusive) and the
// criterion-less contact signals are what pick up whatever the project's own ICP defines.
export const GENERIC_FIXTURE_COMPANIES:FixtureCompany[]=[
 {name:'TEST — Alpha Services',website:'https://alpha.fixture.example/',city:'Toulouse',address:'10 rue fictive — TEST',phone:'05 00 00 00 11',
 homepage:'<html><head><title>TEST — Alpha Services</title></head><body><h1>Alpha Services</h1><p>Nous accompagnons les PME dans la gestion de leurs demandes clients.</p><p>Notre équipe traite les demandes reçues par téléphone au 05 00 00 00 11, par email et par formulaire de contact.</p><a href="/contact">Contact</a></body></html>',
 contact:'<html><head><title>TEST — Contact Alpha Services</title></head><body><p>Contactez Alpha Services au 05 00 00 00 11 ou via ce formulaire de contact.</p></body></html>'},
 {name:'TEST — Nova Assistance',website:'https://nova.fixture.example/',city:'Montpellier',address:'11 rue fictive — TEST',phone:'05 00 00 00 12',
 homepage:'<html><head><title>TEST — Nova Assistance</title></head><body><h1>Nova Assistance</h1><p>Nova Assistance accompagne les PME de services dans le traitement de leurs demandes entrantes.</p><p>Nova Assistance recrute actuellement plusieurs conseillers pour renforcer son équipe suite à une forte croissance de son activité.</p><p>Contactez notre équipe au 05 00 00 00 12 ou via notre formulaire de contact.</p><a href="/contact">Contact</a></body></html>',
 contact:'<html><head><title>TEST — Contact Nova Assistance</title></head><body><p>Contactez Nova Assistance au 05 00 00 00 12 ou via ce formulaire de contact.</p></body></html>'},
 {name:'TEST — Horizon Solutions',website:'https://horizon.fixture.example/',city:'Bordeaux',address:'12 rue fictive — TEST',phone:null,
 homepage:'<html><head><title>TEST — Horizon Solutions</title></head><body><h1>Horizon Solutions</h1><p>Horizon Solutions propose une automatisation du traitement des demandes entrantes pour les PME.</p><p>Signal commercial observable : plus de 50 PME accompagnées cette année.</p><a href="/contact">Contact</a></body></html>',
 contact:'<html><head><title>TEST — Contact Horizon Solutions</title></head><body><p>Contactez Horizon Solutions via ce formulaire de contact.</p></body></html>'}
];
export const FIXTURE_COMPANIES=RESTAURANT_FIXTURE_COMPANIES;
export const FIXTURE_HTML=RESTAURANT_FIXTURE_COMPANIES[0].homepage;

const canonical=(url:string)=>new URL(url).toString();
const FIXTURE_PAGES=new Map<string,string>();
for(const company of [...RESTAURANT_FIXTURE_COMPANIES,...GENERIC_FIXTURE_COMPANIES]){
 FIXTURE_PAGES.set(canonical(company.website),company.homepage);
 FIXTURE_PAGES.set(canonical(new URL('/contact',company.website).toString()),company.contact);
}
export function fixtureHtmlFor(url:string):string|null{try{return FIXTURE_PAGES.get(canonical(url))??null}catch{return null}}
type PageFetch=(url:string)=>Promise<{url:string;html:string}>;
// Deterministic, network-free fetcher for known ProspectOS fixture pages.
export function createFixturePageFetcher():PageFetch{return async url=>{const html=fixtureHtmlFor(url);if(html===null)throw Error('FIXTURE_PAGE_NOT_FOUND');return {url,html}}}
// Routes a fixture URL to the deterministic fixture fetcher and everything else to the real,
// policy-checked fetcher — the only place that decides "is this a fixture", so CompanyAnalysisService
// itself never needs to know about fixtures at all.
export function createCompositePageFetcher(real:PageFetch):PageFetch{const fixture=createFixturePageFetcher();return async url=>isFixtureUrl(url)?fixture(url):real(url)}

function pickFixtureDataset(input:DiscoveryInput):FixtureCompany[]{
 const criteria=input.optional_filters.criteria;
 if(criteria?.length&&!isRestaurantPresetActive(new Set(criteria.map(c=>c.key))))return GENERIC_FIXTURE_COMPANIES;
 return RESTAURANT_FIXTURE_COMPANIES;
}
export class FixtureProvider implements DiscoveryProvider {
 id='fixture';mode='test' as const;
 async searchCompanies(input:DiscoveryInput){return pickFixtureDataset(input).slice(0,input.max_results)}
 async fetchCompanyDetails(candidate:Candidate){return candidate}
 normalizeResult(raw:unknown):Candidate {const r=raw as FixtureCompany;return CandidateSchema.parse({name:r.name,website:r.website,city:r.city,address:r.address,phone:r.phone,canonical_url:r.website,discovered_source:this.id,source_url:r.website,source_title:FIXTURE_LABEL,discovery_timestamp:new Date().toISOString(),confidence:1,raw_metadata:{fixture:true,notice:FIXTURE_LABEL,source_class:'COMPANY_CANDIDATE',source_type:'official_site',company_name_status:'RESOLVED',company_domain_status:'RESOLVED',company_name:r.name,company_domain:new URL(r.website).hostname},deduplication_key:new DeduplicationService().key(r)})}
}
