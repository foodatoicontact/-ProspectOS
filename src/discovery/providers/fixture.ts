import {CandidateSchema,type Candidate,type DiscoveryProvider,type DiscoveryInput} from '../types.ts';
import {DeduplicationService} from '../deduplication.ts';
export const FIXTURE_LABEL='TEST — données synthétiques, aucune recherche Internet';
export const FIXTURE_COMPANIES=[
 {name:'TEST — Burger Démonstration',website:'https://burger.fixture.example/menu',city:'Toulouse',address:'1 rue fictive — TEST',phone:'05 00 00 00 01'},
 {name:'TEST — Boulangerie Démonstration',website:'https://pain.fixture.example/',city:'Toulouse',address:'2 rue fictive — TEST',phone:'05 00 00 00 02'},
 {name:'TEST — Snack Démonstration',website:'https://snack.fixture.example/',city:'Albi',address:'3 rue fictive — TEST',phone:null}
];
export const FIXTURE_HTML='<html><head><title>TEST — Restaurant Toulouse</title></head><body><p>Restaurant de burgers à Toulouse.</p><p>Commandez au 05 00 00 00 01.</p><p>Disponible sur Uber Eats et Deliveroo.</p><p>Commandes par Instagram.</p><p>Click & collect et retrait sur place.</p><p>Livraison directe.</p></body></html>';
export class FixtureProvider implements DiscoveryProvider {
 id='fixture';mode='test' as const;
 async searchCompanies(input:DiscoveryInput){return FIXTURE_COMPANIES.slice(0,input.max_results)}
 async fetchCompanyDetails(candidate:Candidate){return candidate}
 normalizeResult(raw:unknown):Candidate {const r=raw as typeof FIXTURE_COMPANIES[number];return CandidateSchema.parse({...r,canonical_url:r.website,discovered_source:this.id,source_url:r.website,source_title:FIXTURE_LABEL,discovery_timestamp:new Date().toISOString(),confidence:1,raw_metadata:{fixture:true,notice:FIXTURE_LABEL},deduplication_key:new DeduplicationService().key(r)})}
}
