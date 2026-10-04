// Entity resolution hardening, part 2 — two generic guards: a job title + a place is never a company name, and an
// organization that describes ITSELF as a professional body, federation, cluster, sector network or foundation is
// not a company by default. No name, domain, region or role list specific to a case is known here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {planSearchQueries} from '../src/discovery/query-plan.ts';
import {DEFAULT_CRITERIA} from '../src/domain/core.ts';
import type {Candidate} from '../src/discovery/types.ts';

const BRIEF={query:'industriel',location:'Auvergne-Rhône-Alpes',categories:['industriel','agroalimentaire']};
type Hit={title:string;url:string;description?:string};
function normalize(hit:Hit,foundBy='industriel agroalimentaire auvergne-rhône-alpes'):Candidate{
 const p=new BraveProvider('k',(async()=>{throw Error('no network')}) as unknown as typeof fetch) as unknown as {rank(pools:Array<{query:string;results:Hit[]}>,input:unknown):unknown[];normalizeResult(raw:unknown):Candidate};
 const [raw]=p.rank([{query:foundBy,results:[hit]}],{...BRIEF,max_results:20,optional_filters:{}});
 return p.normalizeResult(raw);
}
const meta=(c:Candidate)=>c.raw_metadata as Record<string,any>;
const isCompany=(c:Candidate)=>meta(c).source_class==='COMPANY_CANDIDATE';
const why=(c:Candidate)=>`${c.name} · ${meta(c).admissibility.reason_code} · ${meta(c).entity_type}`;

// A page of a recognized job platform (classified "job board listing or platform") — the case #18 part 1 left open.
test('1 — "<job title> <place> : Emploi et recrutement" on a job platform is never a company',()=>{
 const c=normalize({title:'Développeur Java Lyon : Emploi et recrutement',url:'https://www.hellowork.com/fr-fr/emploi/metier_developpeur-java-ville_lyon.html',description:'Offres en CDI dans un groupe industriel.'});
 assert.equal(isCompany(c),false,why(c));
 assert.equal(meta(c).admissibility.reason_code,'ENTITY_UNRESOLVED',why(c));
});

test('2 — "<job title> <place>" stays unresolved',()=>{
 for(const title of ['Responsable cybersécurité Paris','Technicien maintenance Toulouse : offres d’emploi','Directeur commercial Bordeaux : Emploi et recrutement']){
  const c=normalize({title,url:'https://www.hellowork.com/fr-fr/emploi/'+encodeURIComponent(title.split(' ')[0]!.toLowerCase())+'.html',description:'Offres en CDI dans un groupe industriel.'});
  assert.equal(isCompany(c),false,`${title} → ${why(c)}`);
 }
});

test('3 — a job title with an explicit employer still resolves the employer',()=>{
 for(const hit of [
  {title:'Développeur Java chez Acme Industrie - Lyon',url:'https://jobs.example-platform.fr/offre/123',description:'Groupe industriel, CDI à Lyon (Auvergne-Rhône-Alpes).'},
  {title:'Développeur Java - Lyon',url:'https://jobs.example-platform.fr/offre/456',description:'Entreprise : Acme Industrie | groupe industriel, CDI à Lyon (Auvergne-Rhône-Alpes).'},
 ]){
  const c=normalize(hit);
  assert.equal(meta(c).company_name,'Acme Industrie',hit.title);
  assert.equal(isCompany(c),true,`${hit.title} → ${why(c)}`);
 }
});

const own=(acronym:string,description:string):Hit=>({title:`${acronym} - Les industries de la région`,url:`https://www.${acronym.toLowerCase()}-region.fr/`,description});
for(const [label,acronym,description] of [
 ['4 — professional organization','ACIA','ACIA est une organisation professionnelle qui représente les industries agroalimentaires d’Auvergne-Rhône-Alpes.'],
 ['5 — federation','FRIA','FRIA est une fédération régionale des industries agroalimentaires en Auvergne-Rhône-Alpes.'],
 ['6 — cluster','INDURA','INDURA est un cluster qui rassemble les industriels d’Auvergne-Rhône-Alpes.'],
 ['7 — foundation','FIA','FIA est une fondation qui soutient l’industrie agroalimentaire en Auvergne-Rhône-Alpes.'],
 ['7b — sector network (filière)','AGRIA','AGRIA est la filière agroalimentaire régionale : elle fédère les industriels d’Auvergne-Rhône-Alpes.'],
] as const){
 test(`${label}: an acronym that describes itself as such is not a company for a company brief`,()=>{
  const c=normalize(own(acronym,description));
  assert.equal(isCompany(c),false,why(c));
  assert.notEqual(meta(c).entity_type,'COMPANY',why(c));
 });
}

test('8, 9 — a real company merely mentioning a cluster, a federation, the sector or its training offer stays a candidate',()=>{
 for(const description of [
  'MECALP est une entreprise industrielle d’usinage en Auvergne-Rhône-Alpes, membre d’un cluster régional.',
  'MECALP, fabricant industriel en Auvergne-Rhône-Alpes, est adhérente à une fédération professionnelle.',
  'MECALP est un acteur de la filière agroalimentaire, fabricant industriel en Auvergne-Rhône-Alpes.',
  'MECALP, entreprise industrielle d’usinage en Auvergne-Rhône-Alpes : nous proposons également des formations à nos clients.',
 ]){
  const c=normalize({title:'MECALP - Usinage de précision',url:'https://www.mecalp.fr/',description});
  assert.equal(isCompany(c),true,`${description} → ${why(c)}`);
 }
});

test('10 — controls of part 1 still hold',()=>{
 const aria=normalize({title:'ARIA AURA - Les industries agroalimentaires en région AURA',url:'https://ariaaura.fr/',description:'ARIA Auvergne-Rhône-Alpes est l’association qui représente les industries agroalimentaires de la région.'});
 const ifria=normalize({title:'Présentation IFRIA AURA - Formations en agroalimentaire',url:'https://www.ifria-aura.fr/qui-sommes-nous/',description:'Présentation de l’IFRIA AURA et de ses formations pour l’industrie agroalimentaire.'});
 const job=normalize({title:'Rssi Auvergne-Rhône-Alpes : Emploi et recrutement',url:'https://espace-emploi.agefiph.fr/Auvergne-Rh%C3%B4ne-Alpes-Emploi-Rssi',description:'RSSI H/F au sein d’un groupe industriel à Lyon.'},'industriel recrutent rssi auvergne-rhône-alpes');
 const real=normalize({title:'ACMI - Fabricant de machines industrielles',url:'https://www.acmi-industrie.fr/',description:'ACMI est une entreprise industrielle, fabricant de machines pour l’agroalimentaire, basée en Auvergne-Rhône-Alpes.'});
 assert.equal(isCompany(aria),false,why(aria));assert.equal(isCompany(ifria),false,why(ifria));assert.equal(isCompany(job),false,why(job));
 assert.equal(isCompany(real),true,why(real));
 // the signal-first plan of #17 is untouched
 assert.deepEqual(planSearchQueries({...BRIEF,optional_filters:{criteria:DEFAULT_CRITERIA.map(c=>c.key==='need_fit'?{...c,rules:{type:'need_fit' as const,config:{signals:['recrutent un RSSI','incident cyber']}}}:c)}}).queries,
  ['industriel agroalimentaire auvergne-rhône-alpes','industriel recrutent rssi auvergne-rhône-alpes','industriel incident cyber auvergne-rhône-alpes']);
});
