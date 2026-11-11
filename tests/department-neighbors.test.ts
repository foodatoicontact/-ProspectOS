// Neighbouring departments (src/domain/department-neighbors.ts), used for the "départements voisins" links of the
// /creations-entreprises pages: symmetric, every metropolitan department present, known borders right.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEPARTMENT_NEIGHBORS,neighborsOf} from '../src/domain/department-neighbors.ts';
import {CREATIONS_DEPARTMENTS,CREATIONS_REGIONS} from '../src/domain/company-creations.ts';

test('neighbours — symmetric, metropolitan departments only, known borders',()=>{
 const known=new Set(CREATIONS_DEPARTMENTS.map(d=>d.code));
 for(const [code,list] of Object.entries(DEPARTMENT_NEIGHBORS)){
  assert.ok(known.has(code),code);
  for(const n of list){assert.ok(known.has(n),`${code}→${n}`);assert.ok(neighborsOf(n).includes(code),`${code}↔${n}`)}
 }
 assert.equal(Object.keys(DEPARTMENT_NEIGHBORS).length,96,'the 96 metropolitan departments');
 assert.deepEqual(neighborsOf('69'),['01','38','42','71']);
 assert.deepEqual(neighborsOf('75'),['92','93','94']);
 assert.deepEqual(neighborsOf('13'),['30','83','84']);
 assert.deepEqual(neighborsOf('33'),['17','24','40','47']);
 assert.deepEqual(neighborsOf('2A'),['2B']);
 assert.deepEqual(neighborsOf('974'),[],'overseas: none');
 assert.ok(!neighborsOf('78').includes('75'),'the Yvelines do not border Paris');
 assert.equal(CREATIONS_REGIONS.length,13);
});
