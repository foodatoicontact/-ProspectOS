// Signal-first Discovery V1 — P4: the failures of canary #1 (staging run 4baae3b8, "restaurant" × Occitanie, Brave:
// 56 results → 25 rows, about three real openings in the zone), replayed on fictitious brands (Crousto, Burgerio,
// Pastaro, Merciplo…) and .exemple domains. The communes are real: they are public places, the point of the fix.
//
// What canary #1 showed, one test each:
//  1. off-zone openings in towns the prefecture-only gazetteer did not know stayed UNKNOWN (reviewed) instead of OUT;
//  2. "au Mans" was read "Mans", "aux Ulis" "Ulis";
//  3. the place written only in the headline ("dans la commune de Castelnaudary") was lost;
//  4. one opening seen on four sources stayed four rows (names unresolved, "Crès" ≠ "Hérault (34)");
//  5. a media's name glued to the headline made the event a MEDIA one (OUT) and leaked into excerpts;
//  6. a how-to guide and a ranking page passed as events;
//  7. a town heading the sentence was taken as the organization.
import test from 'node:test';
import assert from 'node:assert/strict';
import {rankSignalCandidates,buildCandidate,type SignalDiscoveryCandidate} from '../src/signal-discovery/rank.ts';
import {extractEvent,withoutSiteName,type SearchHit} from '../src/signal-discovery/extract.ts';
import {resolveEventEntity,objectName} from '../src/signal-discovery/entity.ts';
import {communeDepartment,eventPlacesIn} from '../src/signal-discovery/places.ts';
import {COMMUNES_FR} from '../src/signal-discovery/communes-fr.ts';

const NOW=new Date('2026-10-13T12:00:00Z');
const TARGET={activity_terms:['restaurant','restauration rapide','fast-food','snack'],location:'Occitanie'};
const hit=(title:string,description:string,url:string,page_age='2026-09-20T08:00:00Z'):SearchHit=>({title,description,url,page_age});
const one=(h:SearchHit):SignalDiscoveryCandidate=>{const r=buildCandidate(h,TARGET,NOW);assert.ok(r.ok,`expected an event: ${h.title}`);return (r as {candidate:SignalDiscoveryCandidate}).candidate};

test('canary 1 — the communes gazetteer: official source, unambiguous names only, articles restored',()=>{
 const rows=COMMUNES_FR.split('\n');
 assert.ok(rows.length>5000&&rows.every(r=>/^[a-zœæ0-9 ]+\|(?:\d{2}|2A|2B|97[1-6])$/.test(r)),'folded name | department code');
 assert.equal(new Set(rows.map(r=>r.split('|')[0])).size,rows.length,'one department per name');
 for(const [name,dep] of [['Castelnaudary','11'],['Le Crès','34'],['Le Mans','72'],['Les Ulis','91'],['Loudéac','22'],['Coutances','50'],['Carcassonne','11'],['Sète','34']] as const)
  assert.equal(communeDepartment(name),dep,name);
 // Not a commune of the list (abroad, or too small / ambiguous): unknown, never guessed.
 for(const name of ['Gran Jonquera','Saint-Michel','Paris Nord','Xyz'])assert.equal(communeDepartment(name),null,name);
 // No article is ever added: "Crès" alone is not "Le Crès", and "dans le Val-d'Oise" is never the commune "Le Val".
 for(const name of ['Crès','Mans','Val'])assert.equal(communeDepartment(name),null,name);
 assert.deepEqual([...eventPlacesIn('c’est la 5e implantation dans le Val-d’Oise.').departments],['95']);
 assert.deepEqual([...eventPlacesIn('ouvre au Mans').departments],['72']);
 assert.deepEqual([...eventPlacesIn('ouvre aux Ulis').departments],['91']);
 assert.deepEqual([...eventPlacesIn('ouvre à Saint-Jean-de-Luz').departments],['64']);
 // A department named like a common word is read only as "dans" + its article + the capitalized name.
 assert.deepEqual([...eventPlacesIn('recrute pour son nouveau restaurant dans l’Eure').departments],['27']);
 assert.deepEqual([...eventPlacesIn('un nouveau restaurant dans le Var').departments],['83']);
 assert.deepEqual([...eventPlacesIn('le var et le nord du pays').departments],[]);
 // Read only where the text introduces a place — never a capitalized word anywhere ("Orange" the brand).
 assert.deepEqual([...eventPlacesIn('Orange recrute des vendeurs').departments],[]);
 assert.deepEqual([...eventPlacesIn('ouvre une boutique à Orange').departments],['84']);
 assert.deepEqual([...eventPlacesIn('dans la zone commerciale du Crès').departments],['34']);
 // A city adjective counts only after a word of place.
 assert.deepEqual([...eventPlacesIn('dans la métropole montpelliéraine',{demonyms:true}).departments],['34']);
 assert.deepEqual([...eventPlacesIn('le chef toulousain',{demonyms:true}).departments],[]);
});

test('canary 1.1–1.2 — an opening in a known town of another region is OUT, its article restored',()=>{
 const loudeac=one(hit('Un nouveau fast-food va ouvrir à Loudéac | Actu Exemple','','https://actu-exemple.fr/loudeac-fast-food.html'));
 assert.equal(loudeac.location?.text,'Loudéac');assert.deepEqual(loudeac.location?.departments,['22']);
 assert.equal(loudeac.icp_match,'OUT');assert.ok(loudeac.icp_reasons.includes('location:ZONE_MISMATCH'));
 const mans=one(hit('Deux nouveaux fast-foods vont ouvrir au Mans, à quelques mètres l’un de l’autre','','https://actu-exemple.fr/le-mans.html'));
 assert.equal(mans.location?.text,'Le Mans');assert.deepEqual(mans.location?.departments,['72']);assert.equal(mans.icp_match,'OUT');
 const ulis=one(hit('Pour sa prochaine ouverture, ce fast-food offre 50 burgers','L’enseigne de restauration rapide Burgerio ouvre une nouvelle enseigne aux Ulis (Essonne) le 14 octobre prochain.','https://media-exemple.fr/ulis.html'));
 assert.equal(ulis.location?.text,'Les Ulis');assert.equal(ulis.icp_match,'OUT');assert.equal(ulis.entity_name,'Burgerio');
 // Abroad / unknown: stays UNKNOWN (shown, never invented as a match or a mismatch).
 const abroad=one(hit('Un nouveau restaurant va ouvrir à Gran Jonquera, c’est un célèbre fast-food américain','','https://actu-exemple.fr/jonquera.html'));
 assert.equal(abroad.icp_match,'UNKNOWN');assert.ok(abroad.icp_reasons.includes('location:ZONE_UNKNOWN'));
});

test('canary 1.3 — the headline says where when the snippet sentence does not; the brand is the object of "nouveau restaurant"',()=>{
 const c=one(hit('Commerce : on connaît la date d’ouverture du nouveau restaurant Burgerio dans la commune de Castelnaudary',
  'L’ouverture de l’établissement est programmée pour l’été 2026.','https://actu-exemple.fr/castelnaudary.html','2026-06-10T07:48:00Z'));
 assert.equal(c.location?.text,'Castelnaudary');assert.equal(c.location?.basis,'HEADLINE_MENTION');assert.deepEqual(c.location?.departments,['11']);
 assert.equal(c.icp_match,'IN');
 assert.equal(c.entity_name,'Burgerio');assert.equal(c.entity_name_method,'event_subject');
 assert.ok(c.reasons.includes('named_as_event_object'));
 assert.equal(c.event_date?.text,'été 2026');
 // The name stops before the place it is followed by.
 assert.equal(objectName('le nouveau restaurant Burgerio de Castelnaudary ouvrira'),'Burgerio');
 assert.equal(objectName('Un nouveau Crousto ouvrira ses portes au Crès'),'Crousto');
 assert.equal(objectName('un nouveau restaurant à Toulouse'),null);
 assert.equal(objectName('un nouveau restaurant Castelnaudary'),null,'a commune is never a name');
});

const CRES:SearchHit[]=[
 hit('Crousto ouvre un nouveau restaurant aux portes de Montpellier','Ce vendredi 17 septembre, Crousto ouvre un nouveau restaurant aux portes de Montpellier, dans la zone commerciale du Crès.','https://actu-exemple.fr/crousto-montpellier.html','2026-09-20T12:56:58Z'),
 hit('Crousto s\'installe au Crès et dévoile son nouveau design | Hérault Exemple','La chaîne de restauration rapide, qui avait un temps déserté la France au profit de Burgerio, ouvre un établissement au Crès, près de Montpellier.','https://www.herault-exemple.com/crousto-cres','2026-09-18T09:24:00Z'),
 hit('Un nouveau Crousto va ouvrir ses portes au Crès | Hérault Exemple','Les fans du Crousto’n’Toast vont être ravis : un nouveau Crousto ouvrira ses portes au Crès, près de Montpellier, le 17 septembre prochain.','https://www.herault-exemple.com/crousto-bientot','2026-07-25T07:01:00Z'),
 hit('Un nouveau Crousto a ouvert ses portes au Crès - Montpel Exemple Magazine','La chaîne de restauration rapide Crousto poursuit son implantation dans la métropole montpelliéraine avec l\'ouverture, le 17 septembre, d\'un nouveau restaurant au Crès.','https://montpel-exemple.com/crousto-cres','2026-09-24T11:39:37Z'),
];

test('canary 1.4–1.5 — one opening on four sources is ONE candidate in the zone; a media name is the source, never the organization',()=>{
 const each=CRES.map(one);
 for(const c of each){
  assert.equal(c.entity_name,'Crousto',c.source_url);
  assert.ok(c.location?.departments.includes('34'),`${c.source_url}: ${JSON.stringify(c.location)}`);
  assert.notEqual(c.icp_match,'OUT',`${c.source_url}: ${c.icp_reasons}`);
  assert.ok(c.icp_reasons.includes('location:ZONE_COMPATIBLE'),`${c.source_url}: ${c.icp_reasons}`);
  assert.ok(!c.icp_reasons.some(r=>r.startsWith('non_commercial')),'a magazine source is not a MEDIA organization');
  assert.doesNotMatch(c.headline,/Exemple/,'the site name is removed from the headline');
 }
 const out=rankSignalCandidates(CRES,{target:TARGET,now:NOW,max_results:20});
 const kept=[...out.review,...out.out_of_icp];
 assert.equal(kept.length,1,kept.map(k=>k.source_url).join(' '));
 assert.equal(out.merged,3);assert.equal(kept[0]!.other_sources.length,3);
 assert.equal(kept[0]!.icp_match,'IN','the source kept first is one that names the activity in the zone');
 // The kept row carries its own facts only (the most precise source): never mixed across sources.
 assert.ok(CRES.some(h=>h.description.includes(kept[0]!.excerpt)||h.title.includes(kept[0]!.excerpt)));
});

test('canary 1.5 — site names: removed after "|" always, after a dash only when they match the host; a headline is never emptied',()=>{
 assert.equal(withoutSiteName('Un nouveau fast-food va ouvrir à Loudéac | Actu Exemple','https://actu-exemple.fr/x'),'Un nouveau fast-food va ouvrir à Loudéac');
 assert.equal(withoutSiteName('Le Crès : la date d\'ouverture révélée - MY EXEMPLE','https://myexemple.com/x'),'Le Crès : la date d\'ouverture révélée');
 assert.equal(withoutSiteName('Hérault : un nouveau Crousto ouvre — InfExemple','https://infexemple.fr/x'),'Hérault : un nouveau Crousto ouvre');
 // A dash inside the sentence, not the site's name: kept.
 assert.equal(withoutSiteName('Crousto ouvre à Toulouse - Blagnac en décembre','https://actu-exemple.fr/x'),'Crousto ouvre à Toulouse - Blagnac en décembre');
 assert.equal(withoutSiteName('Actu | Exemple','https://actu-exemple.fr/x'),'Actu | Exemple');
});

test('canary 1.6 — a how-to guide, a cost guide and a ranking page are never one event',()=>{
 for(const h of [
  hit('Guide pour ouvrir un snack avec succès en 2026','L’ouverture d’un snack nécessite un budget compris entre 50 000 et 225 000 euros selon la taille de l’établissement.','https://banque-exemple.com/guide-snack'),
  hit('Top 200 restauration rapide 2026 : le classement complet','Merciplo poursuit son développement avec l’ouverture d’une nouvelle agence à Quimper 6 octobre 2026','https://franchise-exemple.com/top-200'),
  hit('Comment ouvrir un restaurant : les 10 étapes','Ouvrir un nouveau restaurant à Toulouse demande un business plan solide.','https://conseil-exemple.fr/ouvrir'),
 ]){const r=extractEvent(h,NOW);assert.equal(r.ok,false,h.title);assert.equal((r as {reason:string}).reason,'GENERIC_CONTENT',h.title)}
 const out=rankSignalCandidates([hit('Guide pour ouvrir un snack avec succès en 2026','L’ouverture d’un snack nécessite un budget.','https://banque-exemple.com/g')],{target:TARGET,now:NOW,max_results:20});
 assert.deepEqual(out.rejected,{GENERIC_CONTENT:1});
 // A real announcement that happens to say "nouveau" stays an event.
 assert.equal(extractEvent(hit('Crousto ouvrira un nouveau restaurant à Nîmes en décembre 2026','','https://actu-exemple.fr/nimes'),NOW).ok,true);
});

test('canary 1.7 — a town heading the sentence is a place, never the organization; a brand introduced as such keeps its name',()=>{
 const r=extractEvent(hit('L’appétit sans limite des fast-foods dans cette ville de Charente-Maritime','Jonzac, 3 800 habitants, son centre-ville typique, ses thermes, et depuis quelques semaines, son deuxième fast-food.','https://info-exemple.fr/jonzac','2026-05-13T18:35:02Z'),NOW);
 assert.ok(r.ok);assert.equal(resolveEventEntity((r as any).event).entity_name,null);
 const orange=extractEvent(hit('Télécoms','L’enseigne Orange ouvre une nouvelle boutique à Montpellier.','https://actu-exemple.fr/orange'),NOW);
 assert.ok(orange.ok);assert.equal(resolveEventEntity((orange as any).event).entity_name,'Orange');
 // The head office before the verb is never the event's place, even as an adjective.
 const lyon=one(hit('Le groupe toulousain Pastaro ouvrira un restaurant à Lyon en novembre 2026','','https://actu-exemple.fr/pastaro-lyon'));
 assert.deepEqual(lyon.location?.departments,['69']);assert.equal(lyon.icp_match,'OUT');
});
