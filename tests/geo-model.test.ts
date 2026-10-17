// Generic geography (src/geo/): France AND international, one model — country > admin_area_level_1 >
// admin_area_level_2 > locality (+ postal_code). The required cases, the France adapter, the gazetteer's exact-name
// rule, and the guarantee that French Discovery is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {relevanceOf,containment,geoPlace,isGeoPlace,type GeoPlace} from '../src/geo/model.ts';
import {resolveLabel,resolveScope,placeNamed} from '../src/geo/gazetteer.ts';
import {frPlacesFromLegacyLocation,frDepartmentPlace} from '../src/geo/fr.ts';
import {geoRelevance,icpZoneOf,type NbaSignal} from '../src/nba/engine.ts';
import {placesIn,locationTarget,compareLocation} from '../src/discovery/geo-fr.ts';

// A Signal-first France signal (legacy structured location) and a generic one (any country).
const frSignal=(text:string,departments:string[],regions:string[]):NbaSignal=>({id:`s-${text}`,signal_type:'new_site',status:'PENDING_REVIEW',title:text,excerpt:text,
 source_url:'https://presse.example/x',source_domain:'presse.example',source_type:'search_snippet',confidence:0.6,event_date:null,published_at:'2026-10-12T00:00:00Z',
 observed_at:'2026-10-12T00:00:00Z',matched_terms:[],raw_metadata:{location:{text,departments,regions,basis:'EVENT_MENTION'}}});
const geoSignal=(geo:GeoPlace|GeoPlace[]):NbaSignal=>({...frSignal('x',[],[]),raw_metadata:{geo}});
const zone=(...labels:string[])=>icpZoneOf([{key:'target_fit',label:'Cible',weight:100,rules:{type:'target_fit',config:{locations:labels,match:'any_defined'}}}]);
const rel=(s:NbaSignal,...labels:string[])=>geoRelevance(s,zone(...labels)).relevance;

const TOULOUSE=frSignal('Toulouse',['31'],['Occitanie']);
const VANNES=frSignal('Vannes',['56'],['Bretagne']);
const PARIS=frSignal('Paris',['75'],['Île-de-France']);
const BRUXELLES=geoSignal({country:'BE',admin_area_level_1:'BE-BRU',locality:'Bruxelles',label:'Bruxelles'});
const BARCELONE=geoSignal({country:'ES',admin_area_level_1:'ES-CT',admin_area_level_2:'ES-B',locality:'Barcelona',label:'Barcelone'});

test('required — France / Occitanie / Toulouse + signal Toulouse → MATCH',()=>{
 assert.equal(rel(TOULOUSE,'France / Occitanie / Toulouse'),'MATCH');
 assert.equal(rel(TOULOUSE,'France','Occitanie','Toulouse'),'MATCH');
});
test('required — France / Occitanie + signal Vannes → MISMATCH',()=>{assert.equal(rel(VANNES,'France / Occitanie'),'MISMATCH')});
test('required — France + signal Paris → MATCH',()=>{assert.equal(rel(PARIS,'France'),'MATCH')});
test('required — Belgique + signal Bruxelles → MATCH',()=>{assert.equal(rel(BRUXELLES,'Belgique'),'MATCH')});
test('required — Belgique + signal Toulouse → MISMATCH',()=>{assert.equal(rel(TOULOUSE,'Belgique'),'MISMATCH')});
test('required — Espagne / Catalogne + signal Barcelone → MATCH',()=>{
 assert.equal(rel(BARCELONE,'Espagne / Catalogne'),'MATCH');
 assert.equal(rel(TOULOUSE,'Espagne / Catalogne'),'MISMATCH');
});
test('required — insufficient location → UNKNOWN (never promoted to MATCH)',()=>{
 assert.equal(rel(frSignal('quelque part',[],[]),'France'),'UNKNOWN');
 assert.equal(rel(geoSignal({country:'FR',label:'France'}),'Toulouse'),'UNKNOWN','a country-level place against a town scope');
 assert.equal(rel(frSignal('Blagnac',['31'],['Occitanie']),'Toulouse'),'UNKNOWN','department known, town not');
 assert.equal(rel(TOULOUSE),'UNKNOWN','no scope');
 assert.equal(rel(TOULOUSE,'Atlantide'),'UNKNOWN','an unknown label resolves to nothing');
 assert.equal(geoRelevance({...TOULOUSE,raw_metadata:{location:{text:'Toulouse'}}},zone('Toulouse')).relevance,'UNKNOWN','text alone is never compared');
});

test('Morocco and other countries: the model holds any admin tree',()=>{
 const casa=geoSignal({country:'MA',admin_area_level_1:'MA-06',locality:'Casablanca'});
 assert.equal(rel(casa,'Maroc'),'MATCH');assert.equal(rel(casa,'Casablanca-Settat'),'MATCH');assert.equal(rel(casa,'Rabat'),'MISMATCH');
 assert.equal(rel(casa,'France'),'MISMATCH');
 // A country the seed knows only by name still works at country level.
 assert.equal(rel(geoSignal({country:'CH',locality:'Lausanne'}),'Suisse'),'MATCH');
});

test('model — containment level by level, postal code, several places',()=>{
 const fr31:GeoPlace={country:'FR',admin_area_level_1:'FR-OCC',admin_area_level_2:'FR-31'};
 assert.equal(containment({country:'FR'},fr31),'in');
 assert.equal(containment({country:'FR',admin_area_level_1:'FR-OCC'},fr31),'in');
 assert.equal(containment({country:'FR',admin_area_level_1:'FR-BRE'},fr31),'out');
 assert.equal(containment({...fr31,locality:'toulouse'},fr31),'unknown');
 assert.equal(containment({country:'FR',postal_code:'31000'},{country:'FR',postal_code:'31 000'}),'in');
 assert.equal(containment({country:'FR',postal_code:'31000'},{country:'FR'}),'unknown');
 // A signal naming two places: both in → MATCH, both out → MISMATCH, one in one out → UNKNOWN.
 const occ=[{country:'FR',admin_area_level_1:'FR-OCC'}];
 assert.equal(relevanceOf([fr31,{...fr31,admin_area_level_2:'FR-34'}],occ).relevance,'MATCH');
 assert.deepEqual(relevanceOf([fr31,{country:'FR',admin_area_level_1:'FR-BRE'}],occ),{relevance:'UNKNOWN',reason:'mixed_places'});
 assert.ok(isGeoPlace({country:'BE'})&&!isGeoPlace({country:'Belgique'})&&!isGeoPlace({country:'BE',locality:3}));
 assert.equal(geoPlace({country:'ES',locality:'Barcelóna'}).locality,'barcelona');
});

test('gazetteer — exact names only, paths, homonyms; never a word inside a text',()=>{
 assert.deepEqual(resolveLabel('Toulouse'),[frDepartmentPlace('31','Toulouse','Toulouse')]);
 assert.equal(resolveLabel('France / Occitanie / Toulouse')[0]!.locality,'toulouse','a path keeps the most precise place');
 assert.equal(resolveLabel('Espagne > Catalogne')[0]!.admin_area_level_1,'ES-CT');
 assert.equal(placeNamed('Paris')!.admin_area_level_2,'FR-75','Paris: the department and its town chain → the broader');
 assert.deepEqual(resolveLabel('restaurants à Toulouse'),[],'a sentence is not a place');
 assert.deepEqual(resolveLabel('Toulouse / Atlantide'),[],'one unknown part: nothing guessed');
 assert.equal(resolveScope(['Toulouse','Bretagne']).length,2);
 assert.equal(placeNamed('Bruxelles')!.country,'BE');assert.equal(placeNamed('Brussel')!.country,'BE');
});

test('France adapter — Signal-first locations translated, prefecture as town, overseas departments',()=>{
 assert.deepEqual(frPlacesFromLegacyLocation({text:'Toulouse',departments:['31'],regions:['Occitanie']}).map(p=>[p.admin_area_level_1,p.admin_area_level_2,p.locality]),[['FR-OCC','FR-31','toulouse']]);
 assert.deepEqual(frPlacesFromLegacyLocation({text:'Le Crès',departments:['34'],regions:['Occitanie']}).map(p=>p.locality),[null],'not a prefecture: town unknown, department known');
 assert.deepEqual(frPlacesFromLegacyLocation({text:'Occitanie',departments:[],regions:['Occitanie']}).map(p=>p.admin_area_level_1),['FR-OCC']);
 assert.equal(frDepartmentPlace('971')!.admin_area_level_1,'FR-971');
 assert.equal(frDepartmentPlace('2A')!.admin_area_level_1,'FR-20R');
});

test('no regression — French Discovery keeps its own gazetteer, untouched; the NBA engine knows no French level',async()=>{
 assert.deepEqual([...placesIn('Restaurants à Toulouse (31)').departments],['31']);
 assert.equal(compareLocation(locationTarget('Occitanie'),'Montpellier, Hérault').state,'COMPATIBLE');
 const engine=await readFile(new URL('../src/nba/engine.ts',import.meta.url),'utf8');
 assert.doesNotMatch(engine.split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n'),/DEPARTMENTS|departements?\b|\bregions?\b|geo-fr/i,'no French administrative concept in the NBA engine');
 const model=await readFile(new URL('../src/geo/model.ts',import.meta.url),'utf8');
 assert.doesNotMatch(model.split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n'),/departement|département|région|\bFR-|geo-fr/i,'the generic model has no French concept (comments aside)');
});
