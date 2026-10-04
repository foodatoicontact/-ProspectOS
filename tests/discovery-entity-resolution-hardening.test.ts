// Entity resolution + organization type hardening — the false positives of the real Brave canary of PR #17
// (Vigil ICP), reproduced on the real pipeline with the real page titles. Generic rules only: no name, domain,
// role or sector is known here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {isQueryEchoOrGeneric} from '../src/discovery/source-classification.ts';
import {planSearchQueries} from '../src/discovery/query-plan.ts';
import {DEFAULT_CRITERIA} from '../src/domain/core.ts';
import type {Candidate} from '../src/discovery/types.ts';

const VIGIL={query:'industriel',location:'Auvergne-Rhône-Alpes',categories:['industriel','agroalimentaire']};
const SIGNAL_QUERY='industriel recrutent rssi auvergne-rhône-alpes';
type Hit={title:string;url:string;description?:string};
// The real ranking + normalization of a Brave result, found by the given executed query, for the Vigil brief.
function normalize(hit:Hit,foundBy=SIGNAL_QUERY):Candidate{
 const p=new BraveProvider('k',(async()=>{throw Error('no network')}) as unknown as typeof fetch) as unknown as {rank(pools:Array<{query:string;results:Hit[]}>,input:unknown):unknown[];normalizeResult(raw:unknown):Candidate};
 const [raw]=p.rank([{query:foundBy,results:[hit]}],{...VIGIL,max_results:20,optional_filters:{}});
 return p.normalizeResult(raw);
}
const meta=(c:Candidate)=>c.raw_metadata as Record<string,any>;
const isCompany=(c:Candidate)=>meta(c).source_class==='COMPANY_CANDIDATE';

test('A — a job board page without an identified employer never becomes a company through a title pattern',()=>{
 const c=normalize({title:'Rssi Auvergne-Rhône-Alpes : Emploi et recrutement',url:'https://espace-emploi.agefiph.fr/Auvergne-Rh%C3%B4ne-Alpes-Emploi-Rssi',description:'RSSI H/F au sein d’un groupe industriel à Lyon. 133 offres d’emploi Rssi en Auvergne-Rhône-Alpes.'});
 assert.equal(meta(c).page_type,'THIRD_PARTY_JOB_BOARD');
 assert.equal(isCompany(c),false,`${c.name} · ${meta(c).admissibility.reason_code}`);
 assert.notEqual(meta(c).company_name,'Rssi Auvergne-Rhône-Alpes');
});

// The forms the existing employer mechanisms recognize on a job board: "… chez <employer>" and a labeled field
// ("Entreprise : <employer>"). ("Poste - Employeur - Ville" is not recognized today: a pre-existing gap, out of scope.)
test('B — an individual job ad naming its employer still resolves that employer (no regression)',()=>{
 for(const hit of [
  {title:'RSSI H/F chez ACME Industries - Lyon | Indeed',url:'https://fr.indeed.com/viewjob?jk=abc123',description:'Fabricant industriel en Auvergne-Rhône-Alpes, recrute son RSSI en CDI à Lyon.'},
  {title:'RSSI H/F - Lyon | Indeed',url:'https://fr.indeed.com/viewjob?jk=def456',description:'Entreprise : ACME Industries | Fabricant industriel en Auvergne-Rhône-Alpes, CDI à Lyon.'},
 ]){
  const c=normalize(hit);
  assert.equal(meta(c).company_name,'ACME Industries',hit.title);
  assert.equal(isCompany(c),true,`${hit.title} · ${meta(c).admissibility.reason_code}`);
 }
});

test('C — a headline in the publisher’s own voice ("… : … nos apprentis") never makes its topic a company',()=>{
 for(const title of ['Aide Premier Équipement : la Région Auvergne-Rhône-Alpes équipe nos apprentis','Aide Premier Équipement : La Région Auvergne-Rhône-Alpes équipe nos apprentis - IFRIA AURA']){
  const c=normalize({title,url:'https://www.ifria-aura.fr/2026/09/08/aide-premier-equipement-la-region-auvergne-rhone-alpes-equipe-nos-apprentis/',description:'Les apprentis de l’industrie agroalimentaire reçoivent leur équipement.'},'industriel agroalimentaire auvergne-rhône-alpes');
  assert.notEqual(meta(c).company_name,'Aide Premier Équipement',title);
  assert.ok(!(isCompany(c)&&c.name==='Aide Premier Équipement'),title);
 }
});

test('D — an association named by an acronym is recognized from how it describes itself, and set aside for a company brief',()=>{
 const c=normalize({title:'ARIA AURA - Les industries agroalimentaires en région AURA',url:'https://ariaaura.fr/',description:'ARIA Auvergne-Rhône-Alpes est l’association qui représente les industries agroalimentaires de la région.'},'industriel agroalimentaire auvergne-rhône-alpes');
 assert.equal(isCompany(c),false,`${c.name} · ${meta(c).admissibility.reason_code}`);
 assert.equal(meta(c).entity_type,'ASSOCIATION');
});

test('E — a training organization named by an acronym is not a company for a company brief',()=>{
 for(const hit of [
  {title:'Présentation IFRIA AURA - Formations en agroalimentaire',url:'https://www.ifria-aura.fr/qui-sommes-nous/',description:'Présentation de l’IFRIA AURA et de ses formations pour l’industrie agroalimentaire.'},
  {title:'L’équipe de l’IFRIA AURA - IFRIA AURA',url:'https://www.ifria-aura.fr/equipe/',description:'L’IFRIA Auvergne-Rhône-Alpes est un institut de formation et CFA de l’industrie agroalimentaire.'},
 ]){
  const c=normalize(hit,'industriel agroalimentaire auvergne-rhône-alpes');
  assert.equal(isCompany(c),false,`${hit.title} → ${c.name} · ${meta(c).admissibility.reason_code}`);
 }
});

test('F — a real company named by an acronym, on its own site, stays a candidate (not an anti-acronym filter)',()=>{
 const c=normalize({title:'ACMI - Fabricant de machines industrielles',url:'https://www.acmi-industrie.fr/',description:'ACMI est une entreprise industrielle, fabricant de machines de conditionnement pour l’agroalimentaire, basée en Auvergne-Rhône-Alpes.'},'industriel agroalimentaire auvergne-rhône-alpes');
 assert.equal(isCompany(c),true,`${c.name} · ${meta(c).admissibility.reason_code}`);
 assert.equal(meta(c).entity_type,'COMPANY');
});

test('G — a "name" made only of executed search terms (signal queries included) and places is a query echo',()=>{
 const ctx={...VIGIL,searched:planSearchQueries({...VIGIL,optional_filters:{criteria:DEFAULT_CRITERIA.map(c=>c.key==='need_fit'?{...c,rules:{type:'need_fit' as const,config:{signals:['recrutent un RSSI','incident cyber']}}}:c)}}).queries};
 assert.equal(isQueryEchoOrGeneric('Rssi Auvergne-Rhône-Alpes',ctx),true);
 assert.equal(isQueryEchoOrGeneric('Incident Cyber Auvergne-Rhône-Alpes',ctx),true);
 assert.equal(isQueryEchoOrGeneric('ACME Industries',ctx),false,'a real name is never an echo');
 // Through the real pipeline: an article titled with the searched words is not a company.
 const c=normalize({title:'Rssi Auvergne-Rhône-Alpes : un poste devenu stratégique',url:'https://www.lyon-entreprises.com/actualites/article/rssi-poste-strategique',description:'Les industriels de la région renforcent leur cybersécurité.'});
 assert.equal(isCompany(c)&&c.name==='Rssi Auvergne-Rhône-Alpes',false,`${c.name} · ${meta(c).admissibility.reason_code}`);
});

test('H — invariants: the signal-first plan of #17 is unchanged, at most 3 queries',()=>{
 const plan=planSearchQueries({...VIGIL,optional_filters:{criteria:DEFAULT_CRITERIA.map(c=>c.key==='need_fit'?{...c,rules:{type:'need_fit' as const,config:{signals:['recrutent un RSSI','incident cyber']}}}:c)}}).queries;
 assert.deepEqual(plan,['industriel agroalimentaire auvergne-rhône-alpes','industriel recrutent rssi auvergne-rhône-alpes','industriel incident cyber auvergne-rhône-alpes']);
});
