// LEGACY_GEO_BACKFILL (src/signal-discovery/legacy-geo.ts): old Signal-first signals re-located with the ingestion's
// own place reader, from the text already stored. Real French places (public facts), fictitious companies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyGeoUpdate,legacyGeoSql,LEGACY_GEO_BACKFILL_VERSION,type LegacySignal} from '../src/signal-discovery/legacy-geo.ts';
import {buildOpportunity,type NbaSignal} from '../src/nba/engine.ts';

const NOW=new Date('2026-10-17T12:00:00Z');
const legacy=(title:string,excerpt:string,location:unknown=null,extra:Record<string,unknown>={}):LegacySignal=>({id:'0b9757d4-8586-4c53-9a00-000000000001',title,excerpt,
 raw_metadata:{origin:'signal_discovery',location,...extra}});
const dep=(s:LegacySignal)=>legacyGeoUpdate(s,NOW)?.location.departments??null;

test('legacy places re-read from the stored sentence, then the headline (same reader as ingestion)',()=>{
 assert.deepEqual(dep(legacy('Kantina — Essonne : prochaine ouverture','L’enseigne Kantina ouvre une nouvelle enseigne aux Ulis (Essonne) le 14 octobre prochain.',{text:'Ulis',departments:[],regions:[]})),['91']);
 assert.deepEqual(dep(legacy('Kantina a ouvert un restaurant à Vannes | Le Télégramme','Kantina a ouvert un restaurant à Vannes | Le Télégramme',{text:'Vannes',departments:[],regions:[]})),['56']);
 assert.deepEqual(dep(legacy('Un nouveau restaurant Kantina s’apprête à ouvrir ses portes à Connerré','Un nouveau restaurant Kantina s’apprête à ouvrir ses portes à Connerré')),['72']);
 const castel=legacyGeoUpdate(legacy('Commerce : on connaît la date d’ouverture du nouveau restaurant Kantina dans la commune de Castelnaudary','L’ouverture de l’établissement est programmée pour l’été 2026.'),NOW)!;
 assert.deepEqual([castel.location.departments,castel.location.regions,castel.location.basis,castel.provenance.source],[['11'],['Occitanie'],'HEADLINE_MENTION','title']);
 assert.equal(castel.location.text,'Castelnaudary');assert.equal(castel.provenance.previous,null);assert.equal(castel.provenance.version,LEGACY_GEO_BACKFILL_VERSION);
});

test('never invented: no place written → no update (UNKNOWN stays); an already structured place is never overwritten',()=>{
 assert.equal(legacyGeoUpdate(legacy('Kantina ouvre un nouveau restaurant','Le restaurant ouvrira cet été.'),NOW),null);
 assert.equal(legacyGeoUpdate(legacy('x','à Toulouse',{text:'Toulouse',departments:['31'],regions:['Occitanie']}),NOW),null);
 // Not a Signal-first row: not this reader's to re-read.
 assert.equal(legacyGeoUpdate({...legacy('x','ouvre à Vannes'),raw_metadata:{origin:'manual'}},NOW),null);
 // A company named like a town is not a place: only a name the sentence introduces as a place is read.
 assert.equal(legacyGeoUpdate(legacy('Vannes Burger recrute','Vannes Burger recrute un manager.'),NOW),null);
});

test('idempotent: a backfilled row is never re-read; the SQL only applies to un-backfilled rows',()=>{
 const s=legacy('x','Kantina a ouvert un restaurant à Vannes.');
 const u=legacyGeoUpdate(s,NOW)!;
 assert.equal(legacyGeoUpdate({...s,raw_metadata:{...s.raw_metadata,location:u.location,location_backfill:u.provenance}},NOW),null);
 const sql=legacyGeoSql(u);
 assert.match(sql,/where id='0b9757d4-8586-4c53-9a00-000000000001' and raw_metadata->>'origin'='signal_discovery' and raw_metadata->'location_backfill' is null;$/);
 assert.ok(!/; *(drop|delete|insert)/i.test(sql));
});

test('after backfill, NBA reads the structured place: Vannes / Les Ulis MISMATCH for Occitanie, no timing',()=>{
 for(const [title,excerpt] of [['Kantina à Vannes','Kantina a ouvert un restaurant à Vannes.'],['Kantina','Kantina ouvre une nouvelle enseigne aux Ulis (Essonne) le 14 octobre prochain.']]){
  const u=legacyGeoUpdate(legacy(title,excerpt),NOW)!;
  const sig:NbaSignal={id:'s',signal_type:'new_site',status:'VERIFIED',title,excerpt,source_url:'https://presse.example/x',source_domain:'presse.example',source_type:'search_snippet',
   confidence:0.6,event_date:null,published_at:'2026-10-09T00:00:00Z',observed_at:'2026-10-13T00:00:00Z',matched_terms:[],raw_metadata:{origin:'signal_discovery',location:u.location}};
  const o=buildOpportunity({prospect:{id:'p',project_id:'x',name:'Kantina',status:'À analyser'},criteria:[{key:'target_fit',label:'Cible',weight:100,rules:{type:'target_fit',config:{locations:['Occitanie'],match:'any_defined'}}}],
   evidence:[],signals:[sig],publicContent:[],profile:null,now:NOW});
  assert.equal(o.scores.timing.score,0);assert.equal(o.recommended_action,'DISMISS');
 }
});
