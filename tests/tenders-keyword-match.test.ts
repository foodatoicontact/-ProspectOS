// « Appels d'offres ouverts » — exact keyword matching (src/tenders/match.ts). Bug of 13 nov. 2026: the BOAMP's search
// splits an expression into words and matches prefixes, so « techniques de vente » brought back « Entretien des
// installations techniques (chauffage) ». An expression must now match as a whole, in order, on whole words.
import test from 'node:test';
import assert from 'node:assert/strict';
import {keywordMatches,matchingKeywords,meaningfulWords,words} from '../src/tenders/match.ts';
import {parseTenderQuery,searchOpenTenders,toTender,TendersError} from '../src/tenders/boamp.ts';

const yes=(subject:string,keyword:string)=>assert.equal(keywordMatches(subject,keyword),true,`« ${keyword} » should find « ${subject} »`);
const no=(subject:string,keyword:string)=>assert.equal(keywordMatches(subject,keyword),false,`« ${keyword} » should NOT find « ${subject} »`);

test('the reported cases',()=>{
 no('Entretien des installations techniques (chauffage)','techniques de vente');
 no('Entretien et maintenance des installations techniques (Chauffage, ventilation, climatisation)','techniques de vente');
 yes('Formation au management des encadrants','formation management');
 no('Travaux de voirie à Saint-Pierre','pierre');
 no('Prestation de sous traitance de maintenance biomédicale pour le site de Saint Pierre du Mont','pierre');
});

test('a whole expression, words in the same order',()=>{
 yes('Formation aux techniques de vente pour les agents','techniques de vente');
 yes('Formation aux techniques de la vente','techniques de vente');
 yes('Formation aux TECHNIQUES DE VENTE','Techniques de vente');
 no('Vente de matériels et techniques associées','techniques de vente');
 no('Formation du personnel encadrant, management de projet','formation management');
 no('Formation des agents à l’accueil et au management','formation management');
});

test('case and accents ignored, plurals in -s / -x accepted',()=>{
 yes('RAVALEMENT DES FAÇADES DU GYMNASE','façade');
 yes('Ravalement de la facade nord','Façades');
 yes('Nettoyage des vitreries et des réseaux','réseau');
 yes('Œuvres d’art : restauration','oeuvre');
});

test('whole words only',()=>{
 no('Organisation d’une aventure sportive','vente');
 no('Travaux de ventilation','vente');
 yes('Vente aux enchères de véhicules','vente');
 yes('Fourniture de produits anti-graffitis','graffiti');
 yes('Prestations de sous-traitance','sous traitance');
 yes('Travaux de voirie à Saint-Pierre','Saint-Pierre');
 yes('Travaux de voirie à Saint-Pierre','saint pierre');
 yes('Église Sainte Marie : couverture','sainte marie');
 no('Église Sainte Marie : couverture','marie');
});

test('linking words alone never match; a keyword made only of them is refused',()=>{
 for(const k of ['de','la','le','des','en','et','de la','la et le'])assert.deepEqual(meaningfulWords(k),[],k);
 no('Marché de nettoyage de la mairie','de');
 no('Marché de nettoyage de la mairie','de la');
 for(const k of ['de','la et le','des'])assert.throws(()=>parseTenderQuery(k,'33'),(e:unknown)=>e instanceof TendersError&&e.message==='KEYWORD_TOO_GENERIC',k);
 assert.deepEqual(parseTenderQuery('nettoyage de la façade','33').keywords,['nettoyage de la façade']);
});

test('which keyword made a notice come out',()=>{
 assert.deepEqual(matchingKeywords('Formation au management des encadrants',['techniques de vente','formation management','management']),['formation management','management']);
 assert.deepEqual(words('L’hôtel de Saint-Pierre-du-Mont'),['l','hotel','de','saint-pierre','du','mont']);
});

test('search — the BOAMP candidates are filtered: only exact expressions come out, each with its keyword',async()=>{
 const notice=(idweb:string,objet:string)=>({idweb,objet,nature:'APPEL_OFFRE',nomacheteur:'Ville',code_departement:['33'],dateparution:'2026-11-01',
  datelimitereponse:'2026-12-01T12:00:00+00:00',url_avis:`https://www.boamp.fr/pages/avis/?q=idweb:${idweb}`});
 const results=[notice('26-1','Entretien des installations techniques (chauffage)'),notice('26-2','Formation aux techniques de vente'),
  notice('26-3','Formation au management des encadrants'),notice('26-4','Travaux de voirie à Saint-Pierre')];
 const fetch=(async()=>new Response(JSON.stringify({total_count:4,results}))) as typeof globalThis.fetch;
 const r=await searchOpenTenders(parseTenderQuery('techniques de vente, formation management, pierre','33'),{fetch,now:new Date('2026-11-13T09:00:00Z')});
 assert.deepEqual(r.tenders.map(t=>[t.id,t.matched]),[['26-2',['techniques de vente']],['26-3',['formation management']]]);
 assert.equal(r.total,2);assert.equal(r.truncated,false);
 const more=(async()=>new Response(JSON.stringify({total_count:250,results}))) as typeof globalThis.fetch;
 assert.equal((await searchOpenTenders(parseTenderQuery('vente','33'),{fetch:more,now:new Date('2026-11-13T09:00:00Z')})).truncated,true,'more candidates than one request reads');
 assert.deepEqual(toTender(results[0],new Date('2026-11-13T09:00:00Z'),['techniques de vente'])!.matched,[]);
});
