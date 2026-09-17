import {z} from 'zod';
import {handleDiscovery} from '../../../../src/discovery/api';
import {projectCriteria} from '../../../../src/domain/relations';
import {authenticatedDb} from '../../../../src/server/db';
import {analyzeOffer} from '../../../../src/server/ai';
import {withAiQuota} from '../../../../src/server/ai-guard';
import {checked as checkedRpc} from '../../../../src/discovery/repository';
import {CriterionContextSchema} from '../../../../src/discovery/types';
import {DEFAULT_CRITERIA,STATUSES,validateCriteria,generateOutreach,scoreProspect,csv,safeLink} from '../../../../src/domain/core';
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
async function handler(request:Request,context:{params:Promise<{path:string[]}>}){
 try {
 const {db,user}=await authenticatedDb(request);const {path}=await context.params;const [resource,id]=path;
 let body:Record<string,any>={};
 if(!['GET','HEAD'].includes(request.method)){const raw=await request.text();if(raw.length>20000)return json({error:'Corps trop volumineux'},413);try{body=JSON.parse(raw||'{}')}catch{return json({error:'JSON invalide'},400)}if(!body||Array.isArray(body))return json({error:'Objet requis'},400)}
 const discoveryResponse=await handleDiscovery(request,path,body,db);if(discoveryResponse)return discoveryResponse;
 const checked=async(query:PromiseLike<any>)=>{const {data,error}=await query;if(error)throw Error('DATABASE_REQUEST_FAILED');return data};
 if(resource==='organizations'){
 if(request.method==='GET')return json(await checked(db.from('organizations').select('*')));
 if(request.method==='POST'){if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120)return json({error:'Nom requis'},400);return json(await checked(db.rpc('create_organization',{name:body.name.trim()})),201)}
 }
 if(resource==='projects'){
 if(request.method==='GET')return json(await checked(db.from('projects').select('*,icps(*)').order('created_at')));
 if(request.method==='POST'){
 if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120||typeof body.organization_id!=='string')return json({error:'Projet invalide'},400);
 return json(await checked(db.from('projects').insert({name:body.name.trim(),organization_id:body.organization_id,offer:String(body.offer??'').slice(0,4000)}).select().single()),201);
 }
 if(request.method==='PATCH'&&id){if(typeof body.offer!=='string')return json({error:'Offre requise'},400);return json(await checked(db.from('projects').update({offer:body.offer.slice(0,4000)}).eq('id',id).select().single()))}
 }
 if(resource==='icps'&&request.method==='POST'){
 // The same schema Discovery search uses for its own criteria context — a single source of truth for
 // "what is a valid Criterion", including a user-authored `rules` (bounds, dedup, discriminant all
 // enforced here). A malformed direct API payload is rejected here, not silently accepted.
 let criteria;try{criteria=z.array(CriterionContextSchema).max(30).parse(body.criteria??DEFAULT_CRITERIA)}catch{return json({error:'Critères invalides : structure incorrecte'},400)}
 try{validateCriteria(criteria)}catch{return json({error:'Critères invalides : poids total 100 requis'},400)}
 const project=await checked(db.from('projects').select('*').eq('id',body.project_id).single());
 return json(await checked(db.from('icps').upsert({project_id:project.id,organization_id:project.organization_id,criteria},{onConflict:'project_id'}).select().single()));
 }
 if(resource==='prospects'){
 if(request.method==='GET'){const pid=new URL(request.url).searchParams.get('project_id');if(!pid)return json({error:'Projet requis'},400);return json(await checked(db.from('prospects').select('*,evidence(*),channels(*)').eq('project_id',pid).order('created_at',{ascending:false})))}
 if(request.method==='POST'){
 if(typeof body.name!=='string'||!body.name.trim()||body.name.length>160||!safeLink(String(body.website??'')))return json({error:'Nom et URL HTTP(S) requis'},400);
 const project=await checked(db.from('projects').select('*').eq('id',body.project_id).single());
 return json(await checked(db.from('prospects').insert({project_id:project.id,organization_id:project.organization_id,name:body.name.trim(),website:body.website,city:String(body.city??'').slice(0,120),status:'À analyser'}).select().single()),201);
 }
 if(request.method==='PATCH'&&id){if(!STATUSES.includes(body.status))return json({error:'Statut invalide'},400);return json(await checked(db.from('prospects').update({status:body.status}).eq('id',id).select().single()))}
 }
 if(resource==='evidence'&&request.method==='POST'){
 if(typeof body.criterion!=='string'||typeof body.value!=='boolean'||!safeLink(String(body.source_url??''))||typeof body.excerpt!=='string'||!body.excerpt.trim()||body.excerpt.length>1500||!['VERIFIED','NOT_VERIFIED','CONTRADICTED','INFERRED_UNCONFIRMED'].includes(body.status))return json({error:'Preuve invalide'},400);
 const observed=new Date(body.observed_at);if(!Number.isFinite(+observed)||+observed>Date.now())return json({error:'Date invalide'},400);
 const p=await checked(db.from('prospects').select('*').eq('id',body.prospect_id).single());
 const icp=await checked(db.from('icps').select('criteria').eq('project_id',p.project_id).single());if(!icp.criteria.some((c:{key:string})=>c.key===body.criterion))return json({error:'Critère hors ICP'},400);
 return json(await checked(db.from('evidence').insert({prospect_id:p.id,organization_id:p.organization_id,criterion:body.criterion,value:body.value,status:body.status,source_url:body.source_url,excerpt:body.excerpt,observed_at:body.observed_at,verified_by:body.status==='VERIFIED'||body.status==='CONTRADICTED'?user.id:null}).select().single()),201);
 }
 if(resource==='channels'&&request.method==='POST'){
 if(!['email','phone','form','linkedin','whatsapp','instagram'].includes(body.kind)||typeof body.value!=='string'||!body.value.trim()||body.value.length>500||!safeLink(String(body.source_url??'')))return json({error:'Canal invalide'},400);
 if(['form','linkedin','whatsapp','instagram'].includes(body.kind)&&!safeLink(body.value))return json({error:'URL de canal invalide'},400);
 const p=await checked(db.from('prospects').select('*').eq('id',body.prospect_id).single());return json(await checked(db.from('channels').insert({prospect_id:p.id,organization_id:p.organization_id,kind:body.kind,value:body.value,source_url:body.source_url,verified:body.verified===true}).select().single()),201);
 }
 if(resource==='outreach'&&request.method==='POST'){
 const p=await checked(db.from('prospects').select('*,evidence(*)').eq('id',body.prospect_id).single());
 const project=await checked(db.from('projects').select('*,icps(*)').eq('id',p.project_id).single());
 const draft=generateOutreach(p.name,project.offer,projectCriteria(project.icps),p.evidence);
 await checked(db.from('outreach').insert({organization_id:p.organization_id,prospect_id:p.id,content:draft.text,evidence_ids:draft.evidence_ids}));return json(draft);
 }
 if(resource==='events'&&request.method==='GET'){const pid=new URL(request.url).searchParams.get('prospect_id');return json(await checked(db.from('events').select('*').eq('prospect_id',pid??'').order('created_at',{ascending:false}).limit(100)))}
 if(resource==='analyze-company'&&request.method==='POST'){
 if(typeof body.text!=='string'||body.text.length<30||body.text.length>10000||!safeLink(String(body.source_url??'')))return json({error:'URL source et texte public de 30 à 10 000 caractères requis'},400);
 if(typeof body.project_id!=='string')return json({error:'Projet requis'},400);
 // Quota is consumed BEFORE the paid provider call, never after: withAiQuota never reaches
 // analyzeOffer if consuming the quota throws, for any reason (quota exceeded, not a member of the
 // project's organization, or the check itself failing) — fail-closed by construction.
 return json(await withAiQuota(
  ()=>checkedRpc(db.rpc('consume_ai_offer_quota',{p_project_id:body.project_id})),
  ()=>analyzeOffer(body.text),
 ));
 }
 if(resource==='export'&&request.method==='GET'){
 const pid=new URL(request.url).searchParams.get('project_id');const project=await checked(db.from('projects').select('*,icps(*)').eq('id',pid??'').single());const rows=await checked(db.from('prospects').select('*,evidence(*)').eq('project_id',project.id));
 return new Response(csv([['Nom','Ville','Statut','Score','Couverture','URL'],...rows.map((p:any)=>{const s=scoreProspect(projectCriteria(project.icps),p.evidence);return [p.name,p.city,p.status,s.score,s.coverage,p.website]})]),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="prospectos.csv"','Cache-Control':'no-store'}});
 }
 return json({error:'Route ou action non disponible'},404);
 }catch(error){const code=error instanceof Error?error.message:'';const status=code==='UNAUTHORIZED'?401:code==='CONFIGURATION_REQUIRED'||code==='AI_NOT_CONFIGURED'?503:code==='QUOTA_EXCEEDED'?429:400;return json({error:code==='UNAUTHORIZED'?'Connexion requise':code==='CONFIGURATION_REQUIRED'?'Supabase reste à connecter':code==='AI_NOT_CONFIGURED'?'Fournisseur IA et modèle non configurés':code==='QUOTA_EXCEEDED'?'Quota horaire de votre organisation atteint.':'Opération impossible. Vérifiez les données et vos droits.'},status)}
}
export {handler as GET,handler as POST,handler as PATCH};
