import test from 'node:test';import assert from 'node:assert/strict';
import {proposeEvidence} from '../src/domain/analysis.ts';
import {scoreProspect,FOODATOI_CRITERIA} from '../src/domain/core.ts';
test('extraction never verifies automatically',()=>{const rows=proposeEvidence('Notre restaurant à Toulouse prend vos commandes par téléphone.','https://example.com');assert.ok(rows.length>=2);assert.ok(rows.every(e=>e.status==='NOT_VERIFIED'));assert.equal(scoreProspect(FOODATOI_CRITERIA,rows).score,0)});
test('no click collect absence inferred',()=>assert.ok(!proposeEvidence('Bienvenue au restaurant.','https://example.com').some(e=>e.criterion==='weak_collect')));
test('source text preserved',()=>{const text='Commandez par téléphone au numéro indiqué.';assert.ok(proposeEvidence(text,'https://example.com').every(e=>text.includes(e.excerpt)))});
test('unsafe source rejected',()=>assert.throws(()=>proposeEvidence('restaurant','javascript:alert(1)')));
