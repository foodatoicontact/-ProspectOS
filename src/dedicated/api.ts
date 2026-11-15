// Veille dédiée, suivi au résultat — routes /api/v1/dedicated/… (migration 043, docs/DEDICATED_TRACKING.md). Behind
// DEDICATED_TRACKING_ENABLED: off, nothing answers here (404). Every call runs as the signed-in user: the database decides
// who sees what (RLS) and who may do what (functions). Nothing is computed here that the database does not hold.
//   GET  dedicated                          the caller's contracts, deliveries, items and statements (RLS)
//   POST dedicated/items/<id>/open          journal « fiche ouverte » and return the item's history
//   POST dedicated/items/<id>/status        {status, first_invoice_on?, proof?}
//   GET  dedicated/export?contract_id=&delivery_id=&format=csv|pdf   journaled export
//   POST dedicated/statements/<id>/validate {attestation}
//   GET  dedicated/admin                    administrator: every client, counters and alerts
//   POST dedicated/admin/contracts          administrator: {client_email,label,minimum_eur,commission_eur,known_client_days?,first_statement_month}
//   POST dedicated/admin/deliveries         administrator: {contract_id,scope,lines}
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ATTESTATION,PROOF_KINDS,alerts,counters,exportCsv,parseDelivery,isDedicatedStatus,type AdminContract,type ExportRow} from './model.ts';
import {exportPdf} from './pdf.ts';
type Json=(value:unknown,status?:number)=>Response;
export type DedicatedDeps={enabled:boolean;now:()=>Date};
const uuid=z.string().uuid();
const KNOWN:Record<string,[string,number,string]>={
 known_window_closed:['« Déjà client » ne peut plus être déclaré : le délai de 15 jours après la livraison est passé.',409,'KNOWN_WINDOW_CLOSED'],
 known_proof_required:['Joignez une pièce datée (type, date antérieure ou égale à la livraison, référence).',422,'KNOWN_PROOF_REQUIRED'],
 first_invoice_required:['Indiquez la date de la première facture (entre la livraison et aujourd’hui).',422,'FIRST_INVOICE_REQUIRED'],
 item_in_statement:['Cette fiche figure déjà dans un relevé : son statut ne change plus.',409,'ITEM_IN_STATEMENT'],
 dedicated_status_invalid:['Statut inconnu.',422,'STATUS_INVALID'],
 attestation_required:['La validation demande la mention « J’atteste l’exactitude de ce relevé ».',422,'ATTESTATION_REQUIRED'],
 statement_already_validated:['Ce relevé est déjà validé.',409,'STATEMENT_ALREADY_VALIDATED'],
 dedicated_client_not_found:['Aucun compte propriétaire avec cette adresse : le client doit d’abord créer son compte ProspectOS.',404,'CLIENT_NOT_FOUND'],
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
const Contract=z.object({client_email:z.string().trim().email().max(320),label:z.string().trim().min(1).max(160),minimum_eur:z.number().min(0).max(100000),
 commission_eur:z.number().positive().max(100000),known_client_days:z.number().int().min(1).max(60).optional(),
 first_statement_month:z.string().regex(/^\d{4}-\d{2}-01$/)}).strict();
const Delivery=z.object({contract_id:uuid,scope:z.string().trim().min(1).max(500),lines:z.string().max(400000)}).strict();
const fileName=(label:string,ext:string,at:Date)=>`veille-${label.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'dediee'}-${at.toISOString().slice(0,10)}.${ext}`;

// Organizations the signed-in user belongs to (memberships: own rows only, RLS).
export async function memberOrganizations(db:SupabaseClient):Promise<string[]>{
 const {data,error}=await db.from('memberships').select('organization_id');if(error)throw Error('DATABASE_REQUEST_FAILED');
 return (data??[]).map((m:{organization_id:string})=>m.organization_id);
}
export async function handleDedicated(request:Request,path:string[],body:Record<string,unknown>,db:SupabaseClient,json:Json,deps:DedicatedDeps):Promise<Response|null>{
 if(path[0]!=='dedicated')return null;
 if(!deps.enabled)return json({error:'Route ou action non disponible'},404);
 const [,a,b,c]=path;const call=async(fn:string,args:Record<string,unknown>)=>{const {data,error}=await db.rpc(fn,args);if(error){const r=refusal(error,json);if(r)return {response:r};throw Error('DATABASE_REQUEST_FAILED')}return {data}};
 if(request.method==='GET'&&!a){
  // The caller's OWN organizations only: the administrator also reads every contract (RLS), but this is the client space.
  const orgs=await memberOrganizations(db);
  const read=async(t:string,cols:string,order:string,limit:number)=>{if(!orgs.length)return [];const {data,error}=await db.from(t).select(cols).in('organization_id',orgs).order(order,{ascending:false}).limit(limit);if(error)throw Error('DATABASE_REQUEST_FAILED');return data??[]};
  const [contracts,deliveries,items,statements]=await Promise.all([
   read('dedicated_contracts','id,label,minimum_ht_cents,commission_ht_cents,known_client_days,first_statement_month','created_at',20),
   read('dedicated_deliveries','id,contract_id,number,delivered_on,scope','delivered_on',200),
   read('dedicated_items','id,delivery_id,contract_id,reference,siren,name,city,source_label,source_url,delivered_on,status,status_changed_at,first_invoice_on,known_proof,statement_id','delivered_on',5000),
   read('dedicated_statements','id,contract_id,month,signed_count,minimum_ht_cents,commission_ht_cents,amount_ht_cents,items,generated_at,validated_at','month',36)]);
  return json({contracts,deliveries,items,statements,attestation:ATTESTATION});
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
  const pdf=exportPdf({title:`Veille dédiée — ${out.contract}`,subtitle:delivery?`Livraison n° ${numbers[0]??'—'}`:`Toutes les livraisons (${numbers.length})`,rows:out.rows,generatedAt:now});
  return new Response(pdf as BodyInit,{headers:{...headers,'content-type':'application/pdf','content-disposition':`attachment; filename="${fileName(out.contract,'pdf',now)}"`}});
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
  if(request.method==='POST'&&b==='contracts'){
   const p=Contract.safeParse(body);if(!p.success)return json({error:'Demande invalide'},400);
   const r=await call('create_dedicated_contract',{p_client_email:p.data.client_email,p_label:p.data.label,p_minimum_ht_cents:Math.round(p.data.minimum_eur*100),
    p_commission_ht_cents:Math.round(p.data.commission_eur*100),p_known_client_days:p.data.known_client_days??15,p_first_statement_month:p.data.first_statement_month});
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
