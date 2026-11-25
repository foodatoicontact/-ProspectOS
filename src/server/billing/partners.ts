import type {SupabaseClient} from '@supabase/supabase-js';
import {invoiceAmounts} from '../../partners/model.ts';
import type {PartnerStripeApi} from './stripe-client.ts';
// Programme partenaires (migration 052, docs/PARTNERS.md) — the commission lines written from the Stripe webhook.
// The event only says WHICH invoice or charge; both are re-read from Stripe (amounts, status, livemode), then the database
// decides: the referring partner, the 12-month window, the amount, and idempotency (one line per invoice, a refund line
// only for what was not yet refunded). Behind NEXT_PUBLIC_PARTNERS_ENABLED: off, nothing here runs.
export type PartnerOutcome={outcome:string};
export interface PartnerStore{
 recordInvoice(a:{eventId:string;invoiceId:string;customerId:string;paidAt:string;paidCents:number;paidHtCents:number;currency:string}):Promise<PartnerOutcome>;
 recordRefund(a:{eventId:string;chargeId:string;invoiceId:string;refundedTotalCents:number}):Promise<PartnerOutcome>;
}
export type PartnerDeps={stripe:PartnerStripeApi;store:PartnerStore};
export const PARTNER_EVENTS=new Set(['invoice.paid','charge.refunded']);
const str=(v:unknown)=>typeof v==='string'?v:null;

export async function handlePartnerEvent(event:{id:string;type:string;data:{object:any}},live:boolean,deps:PartnerDeps):Promise<PartnerOutcome>{
 const o=event.data?.object??{};
 if(event.type==='invoice.paid'){
  const id=str(o.id);if(!id||!/^in_[A-Za-z0-9]+$/.test(id))return {outcome:'ignored'};
  const inv=await deps.stripe.retrieveInvoice(id);
  if(inv.livemode!==live)return {outcome:'livemode_mismatch'};
  if(inv.status!=='paid'||!inv.customer)return {outcome:'not_paid'};
  const amounts=invoiceAmounts(inv);if(!amounts)return {outcome:'invalid_amounts'};
  const paidAt=inv.status_transitions?.paid_at;if(typeof paidAt!=='number')return {outcome:'not_paid'};
  return deps.store.recordInvoice({eventId:event.id,invoiceId:inv.id,customerId:inv.customer,paidAt:new Date(paidAt*1000).toISOString(),
   paidCents:amounts.paid,paidHtCents:amounts.ht,currency:inv.currency});
 }
 if(event.type==='charge.refunded'){
  const id=str(o.id);if(!id||!/^(ch|py)_[A-Za-z0-9]+$/.test(id))return {outcome:'ignored'};
  const ch=await deps.stripe.retrieveCharge(id);
  if(ch.livemode!==live)return {outcome:'livemode_mismatch'};
  const invoiceId=str(ch.invoice)??(ch.payment_intent?await deps.stripe.invoiceForPaymentIntent(ch.payment_intent):null);
  if(!invoiceId)return {outcome:'no_invoice'};
  return deps.store.recordRefund({eventId:event.id,chargeId:ch.id,invoiceId,refundedTotalCents:ch.amount_refunded});
 }
 return {outcome:'ignored'};
}

export function supabasePartnerStore(admin:SupabaseClient):PartnerStore{
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw Error('DATABASE_REQUEST_FAILED');return data as PartnerOutcome};
 return {
  recordInvoice:a=>rpc('record_partner_invoice',{p_event_id:a.eventId,p_invoice_id:a.invoiceId,p_customer_id:a.customerId,p_paid_at:a.paidAt,
   p_amount_paid_cents:a.paidCents,p_amount_paid_ht_cents:a.paidHtCents,p_currency:a.currency}),
  recordRefund:a=>rpc('record_partner_refund',{p_event_id:a.eventId,p_charge_id:a.chargeId,p_invoice_id:a.invoiceId,p_refunded_total_cents:a.refundedTotalCents}),
 };
}
// The referring partner of a ProspectOS user, copied into the Stripe customer and subscription metadata at checkout.
export function partnerOfUser(admin:SupabaseClient){
 return async(userId:string):Promise<string|null>=>{
  const {data,error}=await admin.rpc('partner_of_user',{p_user_id:userId});
  if(error)return null; // never blocks a payment: the commission itself does not depend on the metadata
  return typeof data==='string'?data:null;
 };
}
