// Veille dédiée, suivi au résultat — routes /api/v1/dedicated/… (migration 043, docs/DEDICATED_TRACKING.md). Behind
// DEDICATED_TRACKING_ENABLED: off, nothing answers here (404). Every call runs as the signed-in user: the database decides
// who sees what (RLS) and who may do what (functions). Nothing is computed here that the database does not hold.
//   GET  dedicated                          the caller's contracts, deliveries, items and statements (RLS)
//   POST dedicated/items/<id>/open          journal « fiche ouverte » and return the item's history
//   POST dedicated/items/<id>/status        {status, first_invoice_on?, proof?}
//   GET  dedicated/export?contract_id=&delivery_id=&format=csv|pdf   journaled export
//   POST dedicated/statements/<id>/validate {attestation}
//   GET  dedicated/proposals/<contract>/pdf  the latest proposal PDF (header X-Proposal-Sha256)
//   POST dedicated/proposals/<contract>/accept {sha256} « J'accepte la proposition » — then the two e-mails (best effort)
//   GET  dedicated/admin                    administrator: every client, counters and alerts
//   GET  dedicated/admin/organizations?q=   administrator: existing organizations (by name or a member's address)
//   POST dedicated/admin/proposals          administrator: « Proposer une veille » {organization_id,label,minimum_eur,commission_eur,
//                                           known_client_days?,trial_starts_on,first_statement_month,file_name,pdf_base64}
//   POST dedicated/admin/contracts/<id>/proposal   administrator: a new version {file_name,pdf_base64} (before acceptance)
//   POST dedicated/admin/contracts/<id>/terminate  administrator: résiliation (6 months of reading and status updates)
//   POST dedicated/admin/deliveries         administrator: {contract_id,scope,lines}
// This module reads its own request body (the general 20 kB limit of the API would refuse a delivery or a PDF): 4 MB for
// the administrator's uploads, 20 kB otherwise. No subscription is checked here: the veille is independent of it.
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ATTESTATION,PROOF_KINDS,firstStatementIssue,alerts,counters,exportCsv,parseDelivery,isDedicatedStatus,dateFr,parisDate,type AdminContract,type ExportRow} from './model.ts';
import {exportPdf} from './pdf.ts';
import {stampPdf} from './stamp.ts';
type Json=(value:unknown,status?:number)=>Response;
export type Acceptance={label:string;organization:string;trial_starts_on:string;version:number;sha256:string;accepted_at:string;userEmail:string|null};
export type DedicatedDeps={enabled:boolean;now:()=>Date;userEmail?:string|null;notifyAccepted?:(a:Acceptance)=>Promise<void>};
const UPLOAD_LIMIT=4_000_000,BODY_LIMIT=20_000;
const uuid=z.string().uuid();
const KNOWN:Record<string,[string,number,string]>={
 known_window_closed:['« Déjà client » ne peut plus être déclaré : le délai de 15 jours après la livraison est passé.',409,'KNOWN_WINDOW_CLOSED'],
 known_proof_required:['Joignez une pièce datée (type, date antérieure ou égale à la livraison, référence).',422,'KNOWN_PROOF_REQUIRED'],
 first_invoice_required:['Indiquez la date de la première facture (entre la livraison et aujourd’hui).',422,'FIRST_INVOICE_REQUIRED'],
 item_in_statement:['Cette fiche figure déjà dans un relevé : son statut ne change plus.',409,'ITEM_IN_STATEMENT'],
 dedicated_status_invalid:['Statut inconnu.',422,'STATUS_INVALID'],
 attestation_required:['La validation demande la mention « J’atteste l’exactitude de ce relevé ».',422,'ATTESTATION_REQUIRED'],
 statement_already_validated:['Ce relevé est déjà validé.',409,'STATEMENT_ALREADY_VALIDATED'],
 dedicated_organization_not_found:['Organisation introuvable.',404,'ORGANIZATION_NOT_FOUND'],
 dedicated_proposal_invalid:['Le fichier joint n’est pas un PDF valide (5 Mo au plus).',422,'PROPOSAL_INVALID'],
 dedicated_proposal_changed:['La proposition a été mise à jour entre-temps : rechargez la page et relisez la nouvelle version avant d’accepter.',409,'PROPOSAL_CHANGED'],
 dedicated_proposal_already_accepted:['Cette proposition est déjà acceptée.',409,'PROPOSAL_ALREADY_ACCEPTED'],
 dedicated_proposal_missing:['Aucune proposition jointe.',409,'PROPOSAL_MISSING'],
 dedicated_space_closed:['L’espace de suivi n’est pas ouvert : la proposition n’est pas encore acceptée, ou l’accès a pris fin.',403,'SPACE_CLOSED'],
 dedicated_contract_not_active:['Ce contrat n’est pas actif (proposition non acceptée ou contrat résilié).',409,'CONTRACT_NOT_ACTIVE'],
 dedicated_siren_already_delivered:['Une entreprise de ce document a déjà été livrée à ce client : retirez-la du fichier de livraison et régénérez le PDF, pour que les numéros restent ceux du document.',409,'SIREN_ALREADY_DELIVERED'],
 dedicated_delivery_pdf_invalid:['Le PDF de la livraison n’est pas valide (5 Mo au plus).',422,'DELIVERY_PDF_INVALID'],
 dedicated_delivery_empty:['Toutes ces entreprises ont déjà été livrées à ce client : rien de nouveau.',409,'DELIVERY_EMPTY'],
 dedicated_contracts_organization_id_label_key:['Ce client a déjà un contrat avec ce libellé.',409,'CONTRACT_EXISTS'],
};
function refusal(error:{message?:string;code?:string}|null,json:Json):Response|null{
 const m=String(error?.message??'');
 for(const [k,[text,status,code]] of Object.entries(KNOWN))if(m.includes(k))return json({error:text,code},status);
 if(/Admin access required/.test(m))return json({error:'Accès administrateur requis.',code:'ADMIN_ACCESS_REQUIRED'},403);
 if(error?.code==='P0002'||/_not_found/.test(m))return json({error:'Introuvable.',code:'NOT_FOUND'},404);
 if(error?.code==='23514'||error?.code==='22023')return json({error:'Données invalides.',code:'INVALID'},422);
 return null;
}
const Status=z.object({status:z.string(),first_invoice_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
 proof:z.object({kind:z.enum(PROOF_KINDS),dated_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),reference:z.string().trim().min(3).max(200)}).strict().optional()}).strict();
const Pdf={file_name:z.string().trim().regex(/^[A-Za-z0-9._ -]{1,120}\.pdf$/),pdf_base64:z.string().min(100).max(UPLOAD_LIMIT)};
const Proposal=z.object({organization_id:uuid,label:z.string().trim().min(1).max(160),minimum_eur:z.number().min(0).max(100000),
 commission_eur:z.number().positive().max(100000),known_client_days:z.number().int().min(1).max(60).optional(),
 trial_starts_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),first_statement_month:z.string().regex(/^\d{4}-\d{2}-01$/),...Pdf}).strict();
const Replace=z.object(Pdf).strict();
// bytea as PostgREST returns it ("\x2550…") → bytes.
export function byteaToBytes(v:unknown):Uint8Array{
 const s=typeof v==='string'?v:'';if(!s.startsWith('\\x'))throw Error('DATABASE_REQUEST_FAILED');
 return Uint8Array.from(Buffer.from(s.slice(2),'hex'));
}
const Delivery=z.object({contract_id:uuid,scope:z.string().trim().min(1).max(500),lines:z.string().max(400000)}).strict();
// The delivered document (npm run livraison): its import file and the PDF sent to the client.
const txt=(n:number)=>z.string().max(n);
const ImportItem=z.object({siren:z.string().regex(/^\d{9}$/),name:txt(200).min(1),city:txt(120),department:z.string().regex(/^(\d{2,3}|2[AB])$/),event_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 event_label:txt(40),badge:txt(40).min(1),chips:z.array(txt(200)).max(6),fact:txt(1000),why_now:txt(1000),hook:txt(1000),source_url:z.string().url().startsWith('https://').max(1000),
 source_label:txt(160).min(1),section_key:z.string().regex(/^[a-z0-9-]{1,30}$/)}).strict();
const DocDelivery=z.object({contract_id:uuid,scope:z.string().trim().min(1).max(500),
 import:z.object({header:z.object({prepared_for:txt(160),eyebrow:txt(300),lead:txt(1000),title_count:z.number().int()}).strict(),
  sections:z.array(z.object({key:z.string().regex(/^[a-z0-9-]{1,30}$/),title:txt(160),subtitle:txt(300),source:txt(160),color:z.string().regex(/^#[0-9a-fA-F]{6}$/),badge:txt(40)}).strict()).max(12),
  items:z.array(ImportItem).min(1).max(1000)}).strict(),
 pdf_base64:z.string().min(100).max(UPLOAD_LIMIT),pdf_file_name:z.string().trim().regex(/^[A-Za-z0-9._ -]{1,120}\.pdf$/)}).strict();
const fileName=(label:string,ext:string,at:Date)=>`veille-${label.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'dediee'}-${at.toISOString().slice(0,10)}.${ext}`;

// Organizations the signed-in user belongs to (memberships: own rows only, RLS).
export async function memberOrganizations(db:SupabaseClient):Promise<string[]>{
 const {data,error}=await db.from('memberships').select('organization_id');if(error)throw Error('DATABASE_REQUEST_FAILED');
 return (data??[]).map((m:{organization_id:string})=>m.organization_id);
}
export async function handleDedicated(request:Request,path:string[],db:SupabaseClient,json:Json,deps:DedicatedDeps):Promise<Response|null>{
 if(path[0]!=='dedicated')return null;
 if(!deps.enabled)return json({error:'Route ou action non disponible'},404);
 let body:Record<string,unknown>={};
 if(request.method!=='GET'&&request.method!=='HEAD'){
  const upload=path[1]==='admin'&&['proposals','deliveries','contracts'].includes(path[2]??'');
  const raw=await request.text();if(raw.length>(upload?UPLOAD_LIMIT:BODY_LIMIT))return json({error:'Corps trop volumineux'},413);
  try{body=JSON.parse(raw||'{}')}catch{return json({error:'JSON invalide'},400)}
  if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Objet requis'},400);
 }
 const [,a,b,c]=path;const call=async(fn:string,args:Record<string,unknown>)=>{const {data,error}=await db.rpc(fn,args);if(error){const r=refusal(error,json);if(r)return {response:r};throw Error('DATABASE_REQUEST_FAILED')}return {data}};
 if(request.method==='GET'&&!a){
  // The caller's OWN organizations only: the administrator also reads every contract (RLS), but this is the client space.
  const orgs=await memberOrganizations(db);
  const read=async(t:string,cols:string,order:string,limit:number)=>{if(!orgs.length)return [];const {data,error}=await db.from(t).select(cols).in('organization_id',orgs).order(order,{ascending:false}).limit(limit);if(error)throw Error('DATABASE_REQUEST_FAILED');return data??[]};
  const [contracts,deliveries,items,statements]=await Promise.all([
   read('dedicated_contracts','id,label,minimum_ht_cents,commission_ht_cents,known_client_days,first_statement_month,status,trial_starts_on,accepted_at,terminated_at','created_at',20),
   read('dedicated_deliveries','id,contract_id,number,delivered_on,scope,header,sections,pdf_sha256,pdf_file_name','delivered_on',200),
   read('dedicated_items','id,delivery_id,contract_id,position,reference,siren,name,city,source_label,source_url,delivered_on,status,status_changed_at,first_invoice_on,known_proof,statement_id,section_key,badge,event_date,event_label,department,chips,fact,why_now,hook','delivered_on',5000),
   read('dedicated_statements','id,contract_id,month,signed_count,minimum_ht_cents,commission_ht_cents,amount_ht_cents,items,generated_at,validated_at','month',36)]);
  // The latest proposal of each contract (metadata only: the PDF itself is downloaded on demand).
  const {data:props,error:pe}=orgs.length?await db.from('dedicated_proposals').select('contract_id,version,file_name,sha256,created_at').in('organization_id',orgs).order('version',{ascending:false}).limit(100):{data:[],error:null};
  if(pe)throw Error('DATABASE_REQUEST_FAILED');
  const proposals=Object.values(((props??[]) as {contract_id:string}[]).reduce<Record<string,unknown>>((m,p)=>{if(!m[p.contract_id])m[p.contract_id]=p;return m},{}));
  return json({contracts,deliveries,items,statements,proposals,attestation:ATTESTATION});
 }
 if(a==='items'&&b&&request.method==='POST'){
  if(!uuid.safeParse(b).success)return json({error:'Fiche requise'},400);
  if(c==='open'){
   const r=await call('open_dedicated_item',{p_item_id:b});if(r.response)return r.response;
   const {data,error}=await db.from('dedicated_journal').select('kind,detail,created_at,actor_id').eq('item_id',b).order('id',{ascending:false}).limit(100);
   if(error)throw Error('DATABASE_REQUEST_FAILED');
   return json({history:data??[]});
  }
  if(c==='status'){
   const p=Status.safeParse(body);if(!p.success||!isDedicatedStatus(p.data.status))return json({error:'Demande invalide'},400);
   const r=await call('set_dedicated_item_status',{p_item_id:b,p_status:p.data.status,p_first_invoice_on:p.data.first_invoice_on??null,p_proof:p.data.proof??null});
   return r.response??json(r.data);
  }
 }
 if(a==='export'&&!b&&request.method==='GET'){
  const q=new URL(request.url).searchParams;const contract=q.get('contract_id'),delivery=q.get('delivery_id'),format=q.get('format')==='pdf'?'pdf':'csv';
  if(!uuid.safeParse(contract).success||(delivery&&!uuid.safeParse(delivery).success))return json({error:'Demande invalide'},400);
  const r=await call('export_dedicated_items',{p_contract_id:contract,p_delivery_id:delivery||null,p_format:format});if(r.response)return r.response;
  const out=r.data as {contract:string;rows:ExportRow[]};const now=deps.now();
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(format==='csv')return new Response(exportCsv(out.rows),{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="${fileName(out.contract,'csv',now)}"`}});
  const numbers=[...new Set(out.rows.map(x=>x.delivery_number))];
  // A delivered document: the PDF as it was sent, with only a watermark and the delivery number added.
  if(delivery){
   const {data:doc,error:de}=await db.from('dedicated_deliveries').select('number,delivered_on,header,pdf,pdf_file_name').eq('id',delivery).maybeSingle();
   if(de)throw Error('DATABASE_REQUEST_FAILED');
   const dd=doc as {number:number;delivered_on:string;header:{prepared_for?:string};pdf:unknown;pdf_file_name:string|null}|null;
   if(dd?.pdf){
    const who=dd.header?.prepared_for||out.contract;
    try{
     const stamped=stampPdf(byteaToBytes(dd.pdf),{watermark:`Livraison n° ${dd.number} · ${who} · confidentiel`,
      footer:`ProspectOS · Livraison n° ${dd.number} du ${dateFr(dd.delivered_on)} · ${who} · exportée le ${dateFr(parisDate(now))}`});
     return new Response(stamped as BodyInit,{headers:{...headers,'content-type':'application/pdf','content-disposition':`attachment; filename="livraison-${dd.number}-${(dd.pdf_file_name??'liste.pdf').replace(/"/g,'')}"`}});
    }catch{/* not stampable: the generated list below */}
   }
  }
  const pdf=exportPdf({title:`Veille dédiée — ${out.contract}`,subtitle:delivery?`Livraison n° ${numbers[0]??'—'}`:`Toutes les livraisons (${numbers.length})`,rows:out.rows,generatedAt:now});
  return new Response(pdf as BodyInit,{headers:{...headers,'content-type':'application/pdf','content-disposition':`attachment; filename="${fileName(out.contract,'pdf',now)}"`}});
 }
 if(a==='proposals'&&b){
  if(!uuid.safeParse(b).success)return json({error:'Contrat requis'},400);
  if(c==='pdf'&&request.method==='GET'){
   const {data,error}=await db.from('dedicated_proposals').select('version,file_name,sha256,pdf').eq('contract_id',b).order('version',{ascending:false}).limit(1).maybeSingle();
   if(error)throw Error('DATABASE_REQUEST_FAILED');if(!data)return json({error:'Introuvable.',code:'NOT_FOUND'},404);
   const p=data as {version:number;file_name:string;sha256:string;pdf:unknown};
   return new Response(byteaToBytes(p.pdf) as BodyInit,{headers:{'content-type':'application/pdf','content-disposition':`inline; filename="${p.file_name}"`,
    'X-Proposal-Sha256':p.sha256,'X-Proposal-Version':String(p.version),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(c==='accept'&&request.method==='POST'){
   const sha=typeof body.sha256==='string'&&/^[0-9a-f]{64}$/.test(body.sha256)?body.sha256:null;if(!sha)return json({error:'Version de la proposition requise'},400);
   const r=await call('accept_dedicated_proposal',{p_contract_id:b,p_sha256:sha});if(r.response)return r.response;
   const d=r.data as {label:string;organization:string;trial_starts_on:string;version:number;sha256:string;accepted_at:string};
   // The acceptance is recorded; the e-mails are best effort and never undo it.
   try{await deps.notifyAccepted?.({...d,userEmail:deps.userEmail??null})}catch{/* logged by the sender */}
   return json(d);
  }
 }
 if(a==='statements'&&b&&c==='validate'&&request.method==='POST'){
  if(!uuid.safeParse(b).success)return json({error:'Relevé requis'},400);
  const r=await call('validate_dedicated_statement',{p_statement_id:b,p_attestation:typeof body.attestation==='string'?body.attestation:''});
  return r.response??json(r.data);
 }
 if(a==='admin'){
  if(request.method==='GET'&&!b){
   const r=await call('dedicated_admin_overview',{});if(r.response)return r.response;
   const now=deps.now();
   return json((r.data as AdminContract[]).map(x=>({...x,counters:counters(x.items),alerts:alerts(x,now)})));
  }
  if(request.method==='GET'&&b==='organizations'){
   const r=await call('dedicated_find_organizations',{p_query:new URL(request.url).searchParams.get('q')??''});return r.response??json(r.data);
  }
  if(request.method==='POST'&&b==='proposals'&&!c){
   const p=Proposal.safeParse(body);if(!p.success)return json({error:'Demande invalide'},400);
   const monthIssue=firstStatementIssue(p.data.trial_starts_on,p.data.first_statement_month);if(monthIssue)return json({error:monthIssue,code:'FIRST_STATEMENT_MONTH'},422);
   const r=await call('propose_dedicated_watch',{p_organization_id:p.data.organization_id,p_label:p.data.label,p_minimum_ht_cents:Math.round(p.data.minimum_eur*100),
    p_commission_ht_cents:Math.round(p.data.commission_eur*100),p_known_client_days:p.data.known_client_days??15,p_trial_starts_on:p.data.trial_starts_on,
    p_first_statement_month:p.data.first_statement_month,p_file_name:p.data.file_name,p_pdf_base64:p.data.pdf_base64});
   return r.response??json(r.data,201);
  }
  if(request.method==='POST'&&b==='contracts'&&c&&uuid.safeParse(c).success){
   const op=path[4];
   if(op==='proposal'){const p=Replace.safeParse(body);if(!p.success)return json({error:'Demande invalide'},400);
    const r=await call('replace_dedicated_proposal',{p_contract_id:c,p_file_name:p.data.file_name,p_pdf_base64:p.data.pdf_base64});return r.response??json(r.data,201)}
   if(op==='terminate'){const r=await call('terminate_dedicated_contract',{p_contract_id:c});return r.response??json(r.data)}
  }
  if(request.method==='POST'&&b==='deliveries'&&'import' in body){
   const p=DocDelivery.safeParse(body);if(!p.success)return json({error:'Fichier d’import invalide (npm run livraison).',code:'DELIVERY_INVALID'},422);
   const keys=new Set(p.data.import.sections.map(s=>s.key));
   if(p.data.import.items.some(i=>!keys.has(i.section_key)))return json({error:'Fichier d’import invalide : une fiche renvoie à une section absente.',code:'DELIVERY_INVALID'},422);
   const r=await call('create_dedicated_delivery',{p_contract_id:p.data.contract_id,p_scope:p.data.scope,p_items:p.data.import.items,p_header:p.data.import.header,
    p_sections:p.data.import.sections,p_pdf_base64:p.data.pdf_base64,p_pdf_file_name:p.data.pdf_file_name});
   return r.response??json(r.data,201);
  }
  if(request.method==='POST'&&b==='deliveries'){
   const p=Delivery.safeParse(body);if(!p.success)return json({error:'Demande invalide'},400);
   const parsed=parseDelivery(p.data.lines);
   if(parsed.errors.length||!parsed.items.length)return json({error:parsed.errors.slice(0,10).join(' · ')||'Aucune entreprise à livrer.',code:'DELIVERY_INVALID'},422);
   const r=await call('create_dedicated_delivery',{p_contract_id:p.data.contract_id,p_scope:p.data.scope,p_items:parsed.items});
   return r.response??json(r.data,201);
  }
 }
 return json({error:'Route ou action non disponible'},404);
}
