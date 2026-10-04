// An organization's own page whose title presents the WHOLE sector the user searches, in a region ("Les industries
// agroalimentaires en région X", "L'agroalimentaire en X") — instead of what the organization makes or sells — is a
// sector body or portal, not a company to prospect. Real titles of the Brave canary (Vigil brief) + false-negative
// guards. The sector words are the user's own (query, categories): no sector list, name, domain or region is known.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import type {Candidate} from '../src/discovery/types.ts';

const BRIEF={query:'industriel',location:'Auvergne-Rhône-Alpes',categories:['industriel','agroalimentaire']};
type Hit={title:string;url:string;description?:string};
function normalize(hit:Hit):Candidate{
 const p=new BraveProvider('k',(async()=>{throw Error('no network')}) as unknown as typeof fetch) as unknown as {rank(pools:Array<{query:string;results:Hit[]}>,input:unknown):unknown[];normalizeResult(raw:unknown):Candidate};
 const [raw]=p.rank([{query:'industriel agroalimentaire auvergne-rhône-alpes',results:[hit]}],{...BRIEF,max_results:20,optional_filters:{}});
 return p.normalizeResult(raw);
}
const meta=(c:Candidate)=>c.raw_metadata as Record<string,any>;
const isCompany=(c:Candidate)=>meta(c).source_class==='COMPANY_CANDIDATE';
const why=(c:Candidate)=>`${c.name} · ${meta(c).admissibility.reason_code} · ${meta(c).entity_type}`;

// Real titles and URLs observed in the real Brave canary; the real snippets were not visible, so both an empty and a
// generic sector snippet are tried.
const REAL=[
 {title:'ARIA AURA - Les industries agroalimentaires en région AURA',url:'https://ariaaura.fr/'},
 {title:'L\'agroalimentaire en Auvergne-Rhône-Alpes | IFRIA AURA',url:'https://www.ifria-aura.fr/'},
 {title:'L\'agroalimentaire en Auvergne-Rhône-Alpes | IFRIA AURA',url:'https://www.ifria-aura.fr/decouvrir-lagroalimentaire/'},
];
for(const hit of REAL)for(const description of ['','Découvrez les industries agroalimentaires en Auvergne-Rhône-Alpes : chiffres clés, métiers et entreprises de la région.']){
 test(`real canary title "${hit.title}" (${hit.url}, ${description?'sector snippet':'empty snippet'}) is not proposed as a company`,()=>{
  const c=normalize({...hit,description});
  assert.equal(isCompany(c),false,why(c));
  assert.equal(meta(c).admissibility.reason_code,'SECTOR_BODY_PAGE',why(c));
  assert.ok(c.name,'still visible, with its reason');
 });
}

// A company stays a candidate even when its title names a region, "industrie"/"industriel", a sector or a regional
// specialty — only a title presenting the searched sector AS A WHOLE in a zone is set aside.
const GUARDS:Hit[]=[
 {title:'Fromagerie Durand - Fromages AOP de Savoie',url:'https://www.fromagerie-durand.fr/',description:'Fromagerie artisanale et industrielle : fromages AOP de Savoie, Auvergne-Rhône-Alpes.'},
 {title:'ACME - Fabricant industriel en Auvergne-Rhône-Alpes',url:'https://www.acme-industrie.fr/',description:'ACME, fabricant industriel en Auvergne-Rhône-Alpes.'},
 {title:'ACME Agroalimentaire - Conserverie industrielle en Auvergne-Rhône-Alpes',url:'https://www.acme-agroalimentaire.fr/',description:'Conserverie agroalimentaire industrielle en Auvergne-Rhône-Alpes.'},
 {title:'MECALP - L\'industrie du futur en Auvergne-Rhône-Alpes',url:'https://www.mecalp.fr/',description:'MECALP, usinage industriel de précision en Auvergne-Rhône-Alpes.'},
 {title:'NUTRIPRO - Leader de l\'agroalimentaire en Auvergne-Rhône-Alpes',url:'https://www.nutripro.fr/',description:'NUTRIPRO, industriel de l’agroalimentaire en Auvergne-Rhône-Alpes.'},
 {title:'SAVOIE PLATS - Les plats cuisinés de Savoie',url:'https://www.savoie-plats.fr/',description:'Fabricant agroalimentaire de plats cuisinés, Auvergne-Rhône-Alpes.'},
 {title:'ALPIMECA - L\'excellence industrielle en Auvergne-Rhône-Alpes',url:'https://www.alpimeca.fr/',description:'ALPIMECA, sous-traitant industriel en Auvergne-Rhône-Alpes.'},
 {title:'ACMI - Fabricant de machines industrielles',url:'https://www.acmi-industrie.fr/',description:'ACMI est une entreprise industrielle, fabricant de machines pour l’agroalimentaire, basée en Auvergne-Rhône-Alpes.'},
];
test('false-negative guards: companies naming a region, "industrie", a sector or a regional specialty stay candidates',()=>{
 for(const hit of GUARDS){const c=normalize(hit);assert.equal(isCompany(c),true,`${hit.title} → ${why(c)}`)}
});
