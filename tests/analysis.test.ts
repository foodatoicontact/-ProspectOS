import test from 'node:test';import assert from 'node:assert/strict';
import {proposeEvidence} from '../src/domain/analysis.ts';
import {scoreProspect,FOODATOI_CRITERIA,DEFAULT_CRITERIA} from '../src/domain/core.ts';
test('extraction never verifies automatically',()=>{const rows=proposeEvidence('Notre restaurant à Toulouse prend vos commandes par téléphone.','https://example.com',FOODATOI_CRITERIA);assert.ok(rows.length>=2);assert.ok(rows.every(e=>e.status==='NOT_VERIFIED'));assert.equal(scoreProspect(FOODATOI_CRITERIA,rows).score,0)});
test('no click collect absence inferred',()=>assert.ok(!proposeEvidence('Bienvenue au restaurant.','https://example.com',FOODATOI_CRITERIA).some(e=>e.criterion==='weak_collect')));
test('source text preserved',()=>{const text='Commandez par téléphone au numéro indiqué.';assert.ok(proposeEvidence(text,'https://example.com',FOODATOI_CRITERIA).every(e=>text.includes(e.excerpt)))});
test('unsafe source rejected',()=>assert.throws(()=>proposeEvidence('restaurant','javascript:alert(1)',FOODATOI_CRITERIA)));
test('restaurant patterns never fire for a non-restaurant ICP',()=>{const rows=proposeEvidence('Notre restaurant à Toulouse prend vos commandes par téléphone. Livraison Uber Eats.','https://example.com',DEFAULT_CRITERIA);assert.equal(rows.length,0)});

// --- Red team: a bare keyword overlap must never become an Evidence(value:true) ---
test('a generic ICP criterion whose label word merely appears in the text produces 0 Evidence',()=>{
 const criteria=[{key:'need_fit',label:'Besoin correspondant à l’offre',weight:100}];
 const rows=proposeEvidence('Nous avons un besoin urgent de personnel.','https://example.com',criteria);
 assert.equal(rows.length,0);
});
test('an unknown-at-compile-time criterion matched only by a bare label word produces 0 Evidence',()=>{
 const criteria=[{key:'custom_signal_x',label:'Mention API publique documentée',weight:100}];
 const rows=proposeEvidence('Notre API publique documentée est accessible à tous.','https://example.com',criteria);
 assert.equal(rows.length,0);
});
test('an explicit, deterministically supported Foodatoi criterion still produces NOT_VERIFIED Evidence',()=>{
 const criteria=[{key:'phone_orders',label:'Commandes par téléphone',weight:100}];
 const rows=proposeEvidence('Vous pouvez commander par téléphone dès maintenant.','https://example.com',criteria);
 assert.equal(rows.length,1);
 assert.equal(rows[0].criterion,'phone_orders');
 assert.equal(rows[0].value,true);
 assert.equal(rows[0].status,'NOT_VERIFIED');
});
test('a proposal never targets a key absent from the current ICP',()=>{const criteria=[{key:'target_fit',label:'Correspond à la cible définie',weight:100}];const rows=proposeEvidence('Restaurant Uber Eats Deliveroo Toulouse Occitanie téléphone Instagram.','https://example.com',criteria);assert.equal(rows.length,0)});
test('proposeEvidence never returns a VERIFIED evidence',()=>{const rows=proposeEvidence('Notre restaurant à Toulouse prend vos commandes par téléphone.','https://example.com',FOODATOI_CRITERIA);assert.ok(rows.every(e=>e.status!=='VERIFIED'))});
