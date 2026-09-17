import test from 'node:test';import assert from 'node:assert/strict';
import {projectCriteria} from '../src/domain/relations.ts';
const custom=[{key:'food',label:'Food',weight:100}];
test('PostgREST to-one ICP respects saved criteria',()=>assert.deepEqual(projectCriteria({criteria:custom}),custom));
test('legacy to-many ICP is normalized',()=>assert.deepEqual(projectCriteria([{criteria:custom}]),custom));
test('missing ICP falls back safely',()=>assert.equal(projectCriteria(null).reduce((n,c)=>n+c.weight,0),100));
