// Migration 032 — LEGACY_GEO_BACKFILL on real PostgreSQL (PGlite), full migration chain: the statements printed by
// scripts/legacy-geo-backfill.ts re-locate an old Signal-first signal ONCE; everything else about a signal stays
// immutable; clients still cannot update signals. Fictitious companies, .example domains, real French places.
// Run: node --experimental-strip-types tests/legacy-geo-backfill-db.mjs
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {legacyGeoUpdate,legacyGeoSql} from '../src/signal-discovery/legacy-geo.ts';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
async function refused(op,pattern,what){let msg=null;try{await op()}catch(e){msg=String(e.message)}if(msg===null)throw Error(`BYPASS: ${what}`);if(!pattern.test(msg))throw Error(`refused for the wrong reason (${what}): ${msg}`)}
const h=t=>createHash('sha256').update(t).digest('hex');
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 assert.equal(files.at(-1),'032_signal_legacy_geo.sql');
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../db/migrations/checks/032_signal_legacy_geo.sql',import.meta.url),'utf8'));
 const A='00000000-0000-4000-8000-000000000001';
 await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,'a@t',now())`,[A]);
 await sql("select set_config('request.jwt.claim.sub',$1,false)",[A]);
 await sql('set role authenticated');
 const org=(await sql(`select public.create_organization('Org') id`)).rows[0].id;
 const proj=(await sql(`insert into public.projects(organization_id,name) values($1,'P') returning id`,[org])).rows[0].id;
 const pr=(await sql(`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'Kantina','https://kantina.example') returning id`,[org,proj])).rows[0].id;
 await sql('reset role');
 const insert=async(excerpt,meta)=>(await sql(`insert into public.signals(organization_id,project_id,prospect_id,provider,signal_type,title,excerpt,source_url,source_type,observed_at,confidence,content_hash,event_key,raw_metadata)
  values($1,$2,$3,'discovery_recycled','new_site','Kantina ouvre',$4,$5,'search_snippet',now(),0.6,$6,$7,$8::jsonb) returning id,title,excerpt,raw_metadata`,
  [org,proj,pr,excerpt,`https://presse.example/${h(excerpt).slice(0,8)}`,h(excerpt),`new_site:kantina:${h(excerpt).slice(0,6)}`,JSON.stringify(meta)])).rows[0];
 const ulis=await insert('Kantina ouvre une nouvelle enseigne aux Ulis (Essonne) le 14 octobre prochain.',{origin:'signal_discovery',location:{text:'Ulis',departments:[],regions:[],basis:'EVENT_MENTION'},run_id:'r1'});
 const located=await insert('Kantina ouvre à Toulouse.',{origin:'signal_discovery',location:{text:'Toulouse',departments:['31'],regions:['Occitanie'],basis:'EVENT_MENTION'}});
 const meta=async id=>(await sql(`select raw_metadata from public.signals where id=$1`,[id])).rows[0].raw_metadata;
 const update=legacyGeoUpdate(ulis,new Date());

 await check('A — the printed statement re-locates the legacy signal once, keeps every other key, records provenance',async()=>{
  await sql(legacyGeoSql(update));
  const m=await meta(ulis.id);
  assert.deepEqual(m.location.departments,['91']);assert.equal(m.location_backfill.version,'legacy-geo-v1');
  assert.deepEqual(m.location_backfill.previous,{text:'Ulis',departments:[],regions:[],basis:'EVENT_MENTION'});assert.equal(m.run_id,'r1');
 });
 await check('B — idempotent: running the same statement again changes nothing',async()=>{
  const before=await meta(ulis.id);await sql(legacyGeoSql(update));assert.deepEqual(await meta(ulis.id),before);
 });
 await check('C — a backfilled signal can never be re-located (even directly)',async()=>{
  await refused(()=>sql(`update public.signals set raw_metadata=jsonb_set(raw_metadata,'{location,departments}','["31"]') where id=$1`,[ulis.id]),/immutable/,'re-locate');
 });
 await check('D — an already located signal is never overwritten; other keys and columns stay immutable',async()=>{
  const fake={...update,id:located.id,provenance:{...update.provenance,previous:{text:'Toulouse',departments:['31'],regions:['Occitanie'],basis:'EVENT_MENTION'}}};
  await refused(()=>sql(`update public.signals set raw_metadata=raw_metadata||jsonb_build_object('location','{"text":"Ulis","departments":["91"],"regions":["Île-de-France"]}'::jsonb,'location_backfill',$2::jsonb) where id=$1`,[located.id,JSON.stringify(fake.provenance)]),/immutable/,'overwrite located');
  await refused(()=>sql(`update public.signals set excerpt='changed' where id=$1`,[located.id]),/immutable/,'excerpt');
  await refused(()=>sql(`update public.signals set raw_metadata=raw_metadata-'origin' where id=$1`,[located.id]),/immutable/,'other key');
 });
 await check('E — provenance must name the old location exactly, a version, and a non-empty place',async()=>{
  const other=await insert('Kantina ouvre à Connerré.',{origin:'signal_discovery',location:null});
  const loc=`'{"text":"Connerré","departments":["72"],"regions":["Pays de la Loire"]}'::jsonb`;
  await refused(()=>sql(`update public.signals set raw_metadata=raw_metadata||jsonb_build_object('location',${loc},'location_backfill','{"version":"legacy-geo-v1","previous":{"text":"x"}}'::jsonb) where id=$1`,[other.id]),/immutable/,'wrong previous');
  await refused(()=>sql(`update public.signals set raw_metadata=raw_metadata||jsonb_build_object('location',${loc},'location_backfill','{"version":"guess","previous":null}'::jsonb) where id=$1`,[other.id]),/immutable/,'no version');
  await refused(()=>sql(`update public.signals set raw_metadata=raw_metadata||jsonb_build_object('location','{"text":"x","departments":[],"regions":[]}'::jsonb,'location_backfill','{"version":"legacy-geo-v1","previous":null}'::jsonb) where id=$1`,[other.id]),/immutable/,'empty place');
  await sql(`update public.signals set raw_metadata=raw_metadata||jsonb_build_object('location',${loc},'location_backfill','{"version":"legacy-geo-v1","previous":null}'::jsonb) where id=$1`,[other.id]);
  assert.deepEqual((await meta(other.id)).location.departments,['72']);
 });
 await check('F — clients still cannot update signals; the review path is unchanged',async()=>{
  await sql('set role authenticated');
  await refused(()=>sql(`update public.signals set raw_metadata='{}'::jsonb where id=$1`,[located.id]),/permission denied/,'client update');
  const r=(await sql(`select public.review_signal($1,'verify',null) s`,[located.id])).rows[0].s;assert.equal(r.status,'VERIFIED');
  await sql('reset role');
 });
}catch(e){results.push(['setup','FAIL',String(e?.message??e).split('\n')[0]])}
for(const [n,s,m] of results)console.log(`${s} ${n}${m?` — ${m}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS').length;console.log(`${results.length-failed}/${results.length} passed`);process.exit(failed?1:0);
