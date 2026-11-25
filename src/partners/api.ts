// Programme partenaires — routes /api/v1/partners/… (migration 052, docs/PARTNERS.md). Behind NEXT_PUBLIC_PARTNERS_ENABLED:
// off, nothing answers here (404). Every call runs as the signed-in user: the database decides who sees what (RLS) and who
// may do what (functions check the INTERNAL administrator themselves). Nothing is computed here that the database does not hold.
//   GET  partners/me                                  the caller's partner space (code, link, counts, amounts, anonymous lines)
//   GET  partners/admin                               administrator: partners, balances, statements to pay, applications
//   POST partners/admin/partners                      administrator: {name,company,siret,email,code,rate_percent?}
//   POST partners/admin/partners/<id>/status          administrator: {status:'ACTIVE'|'SUSPENDED'}
//   POST partners/admin/statements/<id>/paid          administrator: {paid_on:'YYYY-MM-DD',reference}
//   POST partners/admin/organizations/<id>/referral   administrator: {partner_id|null,reason} (journaled)
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {normalizePartnerCode,siretValid,referralLink,euros,DEFAULT_RATE_PERCENT,PAYOUT_THRESHOLD_CENTS} from './model.ts';
type Json=(value:unknown,status?:number)=>Response;
export type PartnerApiDeps={enabled:boolean;origin:string};
const uuid=z.string().uuid();
const CreatePartner=z.object({name:z.string().trim().min(2).max(120),company:z.string().trim().min(2).max(160),siret:z.string().trim().refine(siretValid),
 email:z.string().trim().toLowerCase().email().max(254),code:z.string().transform(v=>normalizePartnerCode(v)).refine((v):v is string=>v!==null),
 rate_percent:z.number().gt(0).max(50).default(DEFAULT_RATE_PERCENT)}).strict();
const Status=z.object({status:z.enum(['ACTIVE','SUSPENDED'])}).strict();
const Paid=z.object({paid_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),reference:z.string().trim().min(3).max(80)}).strict();
const Referral=z.object({partner_id:uuid.nullable(),reason:z.string().trim().min(5).max(300)}).strict();
const KNOWN:Record<string,[string,number]>={
 partner_not_found:['Aucun espace partenaire n’est associé à ce compte. Connectez-vous avec l’adresse e-mail donnée lors de votre inscription au programme.',404],
 partner_code_taken:['Ce code est déjà utilisé par un autre partenaire.',409],
 partner_email_taken:['Un partenaire existe déjà avec cette adresse e-mail.',409],
 partner_code_invalid:['Code invalide : 3 à 20 lettres majuscules ou chiffres.',422],
 partner_siret_invalid:['SIRET invalide.',422],
 partner_statement_not_found:['Relevé introuvable.',404],
 partner_statement_already_paid:['Ce relevé est déjà marqué payé.',409],
 partner_statement_below_threshold:[`Solde inférieur au seuil de ${euros(PAYOUT_THRESHOLD_CENTS)} : il est reporté au relevé suivant.`,409],
 partner_statement_superseded:['Un relevé plus récent reprend ce solde : marquez celui-là comme payé.',409],
 partner_paid_on_invalid:['Date de virement invalide : après la fin du mois du relevé, et pas dans le futur.',422],
 partner_reference_invalid:['Référence de virement requise (3 à 80 caractères).',422],
 partner_reason_required:['Indiquez la raison du changement.',422],
 partner_organization_not_found:['Organisation introuvable.',404],
};
function refusal(error:{message?:string;code?:string},json:Json):Response{
 const m=String(error.message??'');
 for(const [k,[text,status]] of Object.entries(KNOWN))if(m.includes(k))return json({error:text,code:k.toUpperCase()},status);
 if(/Admin access required/.test(m))return json({error:'Accès administrateur requis.',code:'ADMIN_ACCESS_REQUIRED'},403);
 if(error.code==='22023'||error.code==='23514')return json({error:'Données invalides.',code:'INVALID'},422);
 throw Error('DATABASE_REQUEST_FAILED');
}
export async function handlePartners(request:Request,path:string[],db:SupabaseClient,json:Json,deps:PartnerApiDeps):Promise<Response|null>{
 if(path[0]!=='partners')return null;
 if(!deps.enabled)return json({error:'Route ou action non disponible'},404);
 const [,a,b,c,d]=path;
 const call=async(fn:string,args:Record<string,unknown>,map?:(data:any)=>unknown)=>{const {data,error}=await db.rpc(fn,args);return error?refusal(error,json):json(map?map(data):data)};
 let body:unknown={};
 if(request.method==='POST'){const raw=await request.text();if(raw.length>8000)return json({error:'Corps trop volumineux'},413);try{body=JSON.parse(raw||'{}')}catch{return json({error:'JSON invalide'},400)}}
 if(request.method==='GET'&&a==='me'&&!b)return call('partner_space',{},data=>({...data,link:referralLink(deps.origin,data?.partner?.code??'')}));
 if(a!=='admin')return json({error:'Route ou action non disponible'},404);
 if(request.method==='GET'&&!b)return call('partner_admin_overview',{});
 if(request.method!=='POST')return json({error:'Route ou action non disponible'},404);
 if(b==='partners'&&!c){
  const p=CreatePartner.safeParse(body);if(!p.success)return json({error:'Partenaire invalide : nom, entreprise, SIRET valide, e-mail et code (3 à 20 lettres ou chiffres).',code:'INVALID'},422);
  return call('create_partner',{p_name:p.data.name,p_company:p.data.company,p_siret:p.data.siret.replace(/\s/g,''),p_email:p.data.email,p_code:p.data.code,p_rate_percent:p.data.rate_percent});
 }
 if(b==='partners'&&c&&uuid.safeParse(c).success&&d==='status'){
  const p=Status.safeParse(body);if(!p.success)return json({error:'Statut invalide.',code:'INVALID'},422);
  return call('set_partner_status',{p_partner_id:c,p_status:p.data.status});
 }
 if(b==='statements'&&c&&uuid.safeParse(c).success&&d==='paid'){
  const p=Paid.safeParse(body);if(!p.success)return json({error:'Date (AAAA-MM-JJ) et référence du virement requises.',code:'INVALID'},422);
  return call('mark_partner_statement_paid',{p_statement_id:c,p_paid_on:p.data.paid_on,p_reference:p.data.reference});
 }
 if(b==='organizations'&&c&&uuid.safeParse(c).success&&d==='referral'){
  const p=Referral.safeParse(body);if(!p.success)return json({error:'Partenaire et raison du changement requis.',code:'INVALID'},422);
  return call('set_organization_referral',{p_organization_id:c,p_partner_id:p.data.partner_id,p_reason:p.data.reason});
 }
 return json({error:'Route ou action non disponible'},404);
}
