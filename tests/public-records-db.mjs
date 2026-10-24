// Public registers → observations, on real PostgreSQL (PGlite) with the full migration chain: what
// src/discovery/public-records.ts produces is accepted as is by save_discovery_observations, proposes evidence that
// counts for nothing until a human confirms it, never touches what a website analysis saved, and is idempotent.
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {registryObservations,SIRENE_PAGE} from '../src/discovery/public-records.ts';
import {toStorageSafeObservation} from '../src/discovery/repository.ts';
import {scoreProspect} from '../src/domain/core.ts';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
const NOW=new Date('2026-10-24T12:00:00Z');
const ICP=[
 {key:'target_fit',label:'Entreprise française du BTP structurée, environ 10 à 100 salariés, priorité Auvergne-Rhône-Alpes',weight:30},
 {key:'need_fit',label:'Répond régulièrement aux marchés publics, appels d’offres ou DCE',weight:35},
 {key:'commercial_signal',label:'Références avec collectivités, bailleurs sociaux ou établissements publics',weight:25},
 {key:'contactability',label:'Contact professionnel décisionnaire documenté',weight:10},
];
const COMPANY={siren:'560800583',nom_complet:'SOC LA GARONNE',nom_raison_sociale:'SOC LA GARONNE',statut_diffusion:'O',etat_administratif:'A',activite_principale:'42.21Z',
 date_creation:'1956-01-01',tranche_effectif_salarie:'12',annee_tranche_effectif_salarie:'2024',
 dirigeants:[{type_dirigeant:'personne physique',nom:'PASCUAL',prenoms:'NICOLAS',qualite:'Président du conseil d’administration'}],
 siege:{siret:'56080058300034',adresse:'63 CHEMIN DE GUILHERMY 31100 TOULOUSE',libelle_commune:'TOULOUSE',departement:'31'}};
const AWARDS={url:'https://tabular-api.data.gouv.fr/api/resources/22847056-61df-452d-837d-8b8ceadbfc52/data/?titulaire_id__exact=56080058300034',rows:[
 {uid:'u1',titulaire_id:'56080058300034',titulaire_typeIdentifiant:'SIRET',titulaire_nom:'SOC LA GARONNE',acheteur_nom:'TOULOUSE METROPOLE (SERVICE EAU POTABLE)',objet:'TVX CONSTRUCTION D’UN RESERVOIR AEP DE 5000 M²',procedure:'Procédure avec négociation',dateNotification:'2026-08-14',donneesActuelles:true},
 {uid:'u2',titulaire_id:'56080058300034',titulaire_typeIdentifiant:'SIRET',titulaire_nom:'SOC LA GARONNE',acheteur_nom:'COMMUNE DE MURET (ASSAINISSEMENT)',objet:'Rehabilitation sans tranchée des réseaux EU/EP de la ville de MURET',procedure:'Procédure adaptée',dateNotification:'2026-07-03',donneesActuelles:true}]};
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 for(const f of (await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 const A='00000000-0000-4000-8000-00000000000a',B='00000000-0000-4000-8000-00000000000b';
 await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,'a@t',now()),($2,'b@t',now())`,[A,B]);
 const oa=(await as(A,`select public.create_organization('Org A') id`)).rows[0].id;await as(B,`select public.create_organization('Org B') id`);
 const pa=(await as(A,`insert into public.projects(organization_id,name) values($1,'AppelGagnant') returning id`,[oa])).rows[0].id;
 await sql(`insert into public.icps(project_id,organization_id,criteria) values($1,$2,$3::jsonb)`,[pa,oa,JSON.stringify(ICP)]);
 const p=(await as(A,`insert into public.prospects(organization_id,project_id,name,website,city) values($1,$2,'SA LA GARONNE','https://www.lagaronnetp.com/','Toulouse') returning id`,[oa,pa])).rows[0].id;
 const save=(user,obs)=>as(user,'select public.save_discovery_observations($1,$2::jsonb) r',[p,JSON.stringify(obs.map(toStorageSafeObservation))]);
 const observations=async()=>(await sql('select * from public.prospect_observations where prospect_id=$1 order by observation_type',[p])).rows;
 const evidence=async()=>(await sql('select * from public.evidence where prospect_id=$1',[p])).rows.map(e=>({...e,observed_at:new Date(e.observed_at).toISOString()}));
 const obs=registryObservations(COMPANY,AWARDS,ICP,NOW);
 // A website analysis already saved one proposal for need_fit.
 const site={criterion:'need_fit',observation_type:'ICP_SIGNAL:need_fit',claim:'Le site mentionne la réponse aux appels d’offres',value:true,status:'INFERRED',source_url:'https://www.lagaronnetp.com/entreprise',
  source_title:'L’entreprise',source_excerpt:'de la réponse aux appels d’offres jusqu’au récolement',source_type:'official_website',confidence:.6,collected_at:NOW.toISOString(),expires_at:new Date(+NOW+90*864e5).toISOString(),content_hash:'site-1'};
 await save(A,[site]);

 await check('ACCEPTED: every observation the registers produce is accepted as is by save_discovery_observations',async()=>{
  await save(A,obs);const rows=await observations();
  for(const o of obs)assert.ok(rows.some(r=>r.observation_type===o.observation_type&&r.source_url===o.source_url),o.observation_type);
 });
 await check('NOTHING VERIFIED: each proposal has its own NOT_VERIFIED evidence, quoting the register; the score stays 0',async()=>{
  const ev=(await evidence()).filter(e=>e.source_url.includes('annuaire-entreprises')||e.source_url.includes('tabular-api'));
  assert.equal(ev.length,obs.filter(o=>o.criterion&&o.value!==null).length);
  assert.ok(ev.every(e=>e.status==='NOT_VERIFIED'&&e.verified_by===null));
  assert.equal(scoreProspect(ICP,await evidence(),NOW).score,0);
 });
 await check('SITE UNTOUCHED: the website analysis proposal and its evidence are unchanged',async()=>{
  const r=(await observations()).filter(o=>o.source_url==='https://www.lagaronnetp.com/entreprise');
  assert.equal(r.length,1);assert.equal(r[0].source_excerpt,site.source_excerpt);assert.ok(r[0].evidence_id);
  assert.equal((await evidence()).filter(e=>e.id===r[0].evidence_id).length,1);
 });
 await check('IDEMPOTENT: reading the registers again adds no observation and no evidence',async()=>{
  const o0=(await observations()).length,e0=(await evidence()).length;await save(A,registryObservations(COMPANY,AWARDS,ICP,NOW));
  assert.equal((await observations()).length,o0);assert.equal((await evidence()).length,e0);
 });
 await check('HUMAN REVIEW: confirming the registered award makes it VERIFIED by that person; the score counts its weight',async()=>{
  const award=(await observations()).find(o=>o.observation_type.startsWith('DECP_AWARD:need_fit:'));
  await as(A,'select public.review_discovery_observation($1,$2)',[award.id,'confirm']);
  const e=(await evidence()).find(x=>x.id===award.evidence_id);assert.equal(e.status,'VERIFIED');assert.equal(e.verified_by,A);
  assert.equal(scoreProspect(ICP,await evidence(),NOW).score,35);
 });
 await check('FROZEN AFTER REVIEW: a later reading of the registers never changes a reviewed proof',async()=>{
  const award=(await observations()).find(o=>o.observation_type.startsWith('DECP_AWARD:need_fit:'));
  await save(A,registryObservations(COMPANY,AWARDS,ICP,NOW));
  const e=(await evidence()).find(x=>x.id===award.evidence_id);assert.equal(e.status,'VERIFIED');assert.equal(e.verified_by,A);
 });
 await check('TENANT: another organization can neither save observations on this prospect nor read them',async()=>{
  let err=null;try{await save(B,obs)}catch(e){err=e}assert.ok(err,'refused');
  assert.equal((await as(B,'select count(*)::int n from public.prospect_observations where prospect_id=$1',[p])).rows[0].n,0);
 });
 await check('IDENTITY READ BACK: the identity row keeps the SIREN in its source URL',async()=>{
  const id=(await observations()).find(o=>o.observation_type==='REGISTRY_IDENTITY');assert.equal(id.source_url,SIRENE_PAGE('560800583'));assert.equal(id.criterion,null);
 });
}finally{
 for(const [name,s,m] of results)console.log(`${s.padEnd(4)}  ${name}${m?` — ${m}`:''}`);
 const failed=results.filter(r=>r[1]!=='PASS').length;
 console.log(`\nPUBLIC RECORDS DB: ${results.length-failed}/${results.length} checks passed`);
 await db.close();if(failed)process.exitCode=1;
}
