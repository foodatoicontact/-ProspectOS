// Migration 016 re-creates two functions that already run in production: public.start_discovery and
// public.delete_own_account. Their CURRENT production bodies were read (read-only) and snapshotted in
// tests/fixtures/production/. This test proves, token by token (whitespace and line endings ignored), that
// 016 keeps every production behaviour and differs ONLY by the one change each needs:
//   start_discovery    → the reservation passes `p_provider<>'fixture'` (a fixture run is not billable);
//   delete_own_account → one line removes the user's temporary offer analyses once deletion is allowed.
// Header attributes (SECURITY DEFINER, search_path, language, parameters, return type) are checked too.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
const migration=await read('../db/migrations/016_beta_commercial_quotas.sql');
const snapshot=async(name:string)=>(await read(`./fixtures/production/${name}.sql`)).split('\n').filter(l=>!l.startsWith('--')).join('\n');
const tokens=(sql:string)=>sql.replace(/\r/g,'').match(/'[^']*'|[A-Za-z_][A-Za-z_0-9.]*|\d+|<>|\|\||:=|[^\s]/g)??[];
function defined(signature:string){
 const start=migration.indexOf(`create or replace function ${signature}`);
 assert.ok(start>=0,`${signature} not re-created by 016`);
 const header=migration.slice(start,migration.indexOf('as $$',start));
 const body=migration.slice(migration.indexOf('as $$',start)+5,migration.indexOf('end $$;',start)+3);
 return {header,body};
}
// Removes one contiguous run of `extra` tokens from `mine` and checks the rest equals `prod` exactly.
function onlyAdds(prod:string[],mine:string[],extra:string[]){
 for(let i=0;i<=mine.length-extra.length;i++){
  if(extra.every((t,j)=>mine[i+j]===t)){const rest=[...mine.slice(0,i),...mine.slice(i+extra.length)];if(rest.join(' ')===prod.join(' '))return true}
 }
 return false;
}

test('start_discovery — 016 equals the current PRODUCTION body except the billable argument',async()=>{
 const {header,body}=defined('public.start_discovery');
 assert.match(header,/public\.start_discovery\(p_project_id uuid,p_query text,p_location text,p_categories jsonb,p_provider text,p_max_results int,p_filters jsonb\) returns jsonb\nlanguage plpgsql security definer set search_path=''/);
 const prod=tokens(await snapshot('start_discovery')),mine=tokens(body);
 assert.notEqual(prod.join(' '),mine.join(' '),'the billable argument is present');
 assert.ok(onlyAdds(prod,mine,[',','p_provider','<>',"'fixture'"]),'no other difference with production');
 // The invariants a reviewer cares about, spelled out.
 for(const must of ['perform prospectos_private.require_member(tenant);',"if p_provider not in ('fixture','brave')","raise exception 'max_results_exceeded'",'insert into public.discovery_runs(organization_id,project_id,query,location,categories,provider,filters_json)','return to_jsonb(row);'])
  assert.ok(body.replace(/\s+/g,' ').includes(must.replace(/\s+/g,' ')),must);
});
test('delete_own_account — 016 equals the current PRODUCTION body plus one line removing temporary offer analyses',async()=>{
 const {header,body}=defined('public.delete_own_account');
 assert.match(header,/public\.delete_own_account\(\) returns jsonb\nlanguage plpgsql security definer set search_path=''/);
 const prod=tokens(await snapshot('delete_own_account')),mine=tokens(body);
 assert.ok(onlyAdds(prod,mine,tokens('delete from prospectos_private.offer_analyses where user_id=actor;')),'no other difference with production');
 assert.ok(body.indexOf('offer_analyses')>body.indexOf("raise exception 'last_owner_blocked'"),'removed only once deletion is allowed');
});
test('the other functions 016 re-creates keep the production contract of 005/015 (hourly checks unchanged)',()=>{
 assert.match(migration,/if used >= allowed then raise exception 'quota_exceeded' using errcode='P0001'; end if;/);
 assert.match(migration,/if used >= per_user then raise exception 'quota_exceeded' using errcode='P0001'; end if;/);
 assert.match(migration,/if used >= per_org then raise exception 'quota_exceeded' using errcode='P0001'; end if;/);
 assert.match(migration,/perform pg_advisory_xact_lock\(hashtextextended\(tenant::text\|\|':'\|\|action_name,0\)\);/);
 assert.match(migration,/perform pg_advisory_xact_lock\(hashtextextended\(tenant::text\|\|':analysis',0\)\);/);
});
