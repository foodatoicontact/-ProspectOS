// Audit of 11 nov. 2026, reliability lot: Q1 the prospects list is never cut silently (paged reading).
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readAllPages,PAGE_ROWS} from '../src/server/paged.ts';
test('Q1 — every page is read in order; a ceiling reached is reported, never hidden; an error is not an empty list',async()=>{
 const total=1234;const asked:[number,number][]=[];
 const page=async(from:number,to:number)=>{asked.push([from,to]);return {data:Array.from({length:Math.max(0,Math.min(to,total-1)-from+1)},(_,i)=>from+i),error:null}};
 const all=await readAllPages(page);
 assert.equal(all.rows.length,1234);assert.equal(all.truncated,false);assert.deepEqual(all.rows.slice(998,1002),[998,999,1000,1001],'past PostgREST\'s 1 000 rows');
 assert.deepEqual(asked,[[0,PAGE_ROWS-1],[PAGE_ROWS,2*PAGE_ROWS-1],[2*PAGE_ROWS,3*PAGE_ROWS-1]]);
 const capped=await readAllPages(page,1000);assert.equal(capped.rows.length,1000);assert.equal(capped.truncated,true);
 const exact=await readAllPages(async(f,t)=>({data:f<500?Array.from({length:t-f+1},(_,i)=>f+i):[],error:null}));assert.equal(exact.rows.length,500);assert.equal(exact.truncated,false);
 await assert.rejects(readAllPages(async()=>({data:null,error:{message:'x'}})),/DATABASE_REQUEST_FAILED/);
});
