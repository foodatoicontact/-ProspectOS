import {CHECKOUT_PRICES} from '../../domain/plans.ts';
import {planForPrice,type BillingConfig} from './config.ts';
import {teamTiersMatch} from './checkout.ts';
import {verifyStripeSignature} from './signature.ts';
import type {StripeApi,StripePrice,StripeSubscription} from './stripe-client.ts';
import type {BillingStore,SubscriptionState} from './store.ts';
import type {BillingResult} from './checkout.ts';
// Stripe webhook. The only path by which a paid plan is granted, extended or ended.
//  1. The signature is verified on the raw body (a forged or altered request is refused with 400).
//  2. The event only says WHICH subscription changed: its state is re-read from the Stripe API, so events
//     arriving late, twice, or out of order all converge to Stripe's current truth.
//  3. The database applies it atomically and records the event id (017): a replayed or concurrently
//     delivered event has no second effect.
// A browser landing on success_url proves nothing and is never consulted.
export const HANDLED_EVENTS=new Set(['checkout.session.completed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed']);
export type WebhookDeps={config:BillingConfig|null;stripe:StripeApi;store:BillingStore;log?:(message:string)=>void};
const ok=(body:Record<string,unknown>):BillingResult=>({status:200,body:{received:true,...body}});
const str=(v:unknown)=>typeof v==='string'?v:null;
const iso=(seconds:unknown)=>typeof seconds==='number'&&Number.isFinite(seconds)?new Date(seconds*1000).toISOString():null;

export function subscriptionIdOf(event:{type:string;data:{object:any}}):string|null{
 const o=event.data?.object??{};
 if(event.type==='checkout.session.completed')return o.mode==='subscription'?str(o.subscription):null;
 if(event.type.startsWith('customer.subscription.'))return str(o.id);
 if(event.type.startsWith('invoice.'))return str(o.subscription)??str(o.parent?.subscription_details?.subscription);
 return null;
}
// The subscription as ProspectOS understands it. A subscription with several items, an unknown price, or a
// price whose amount/currency/interval (TEAM: tiers) is not the offer's grants no plan (the event is still
// recorded). For TEAM the item quantity is the number of paid accounts; its range is enforced by the database.
// teamPrice: the Équipe price re-read WITH its tiers (handleStripeWebhook does it only for that price).
export function subscriptionState(sub:StripeSubscription,config:Pick<BillingConfig,'prices'>,event:{id:string;type:string},teamPrice?:StripePrice|null):SubscriptionState{
 const items=sub.items?.data??[];const item=items[0];
 const priceId=str(item?.price?.id);
 let plan=items.length===1?planForPrice(config,priceId):null;
 const price=item?.price;
 if(plan==='TEAM'){
  const p=teamPrice&&teamPrice.id===priceId?teamPrice:null;
  if(!p||p.currency!=='eur'||p.recurring?.interval!=='month'||!teamTiersMatch(p))plan=null;
 }else if(plan){
  const expected=CHECKOUT_PRICES[plan==='PAID'?'BETA':'PRO'];
  if(price?.unit_amount!==undefined&&(price.unit_amount!==expected.unitAmount||price.currency!==expected.currency||price.recurring?.interval!==expected.interval))plan=null;
 }
 const seats=plan==='TEAM'&&typeof item?.quantity==='number'&&Number.isInteger(item.quantity)?item.quantity:null;
 const invoice=sub.latest_invoice&&typeof sub.latest_invoice==='object'?sub.latest_invoice:null;
 return {
  eventId:event.id,eventType:event.type,customerId:String(sub.customer),subscriptionId:sub.id,priceId,plan,seats,status:sub.status,
  periodStart:iso(item?.current_period_start??sub.current_period_start),periodEnd:iso(item?.current_period_end??sub.current_period_end),
  cancelAtPeriodEnd:sub.cancel_at_period_end===true,paid:invoice?.status==='paid',
 };
}

export async function handleStripeWebhook(rawBody:string,signature:string|null,deps:WebhookDeps,nowSeconds?:number):Promise<BillingResult>{
 const {config}=deps;
 if(!config||!config.webhookSecret)return {status:503,body:{error:'Billing webhook not configured'}};
 if(!verifyStripeSignature(rawBody,signature,config.webhookSecret,nowSeconds))return {status:400,body:{error:'Invalid signature'}};
 let event:any;
 try{event=JSON.parse(rawBody)}catch{return {status:400,body:{error:'Invalid payload'}}}
 if(typeof event?.id!=='string'||!/^evt_[A-Za-z0-9]+$/.test(event.id)||typeof event.type!=='string')return {status:400,body:{error:'Invalid payload'}};
 // A TEST event can never change a LIVE deployment, and the reverse.
 if(event.livemode!==(config.mode==='live'))return {status:400,body:{error:'Livemode mismatch'}};
 if(!HANDLED_EVENTS.has(event.type))return ok({ignored:true});
 const subscriptionId=subscriptionIdOf(event);
 if(!subscriptionId)return ok({ignored:true});
 // A Stripe failure here returns 5xx on purpose: Stripe retries, and nothing was recorded yet.
 const sub=await deps.stripe.retrieveSubscription(subscriptionId);
 if(sub.livemode!==(config.mode==='live'))return {status:400,body:{error:'Livemode mismatch'}};
 // Only the Équipe price is re-read, with its tiers: Solo and Pro keep exactly the calls they always had.
 const items=sub.items?.data??[];
 const teamPrice=items.length===1&&config.prices.TEAM&&items[0]?.price?.id===config.prices.TEAM?await deps.stripe.retrievePrice(config.prices.TEAM,true):null;
 const state=subscriptionState(sub,config,event,teamPrice);
 const result=await deps.store.applyState(state);
 if(['unknown_customer','unknown_price','stale_subscription'].includes(result.outcome))deps.log?.(`billing webhook ${event.id} (${event.type}): ${result.outcome}`);
 return ok({outcome:result.outcome});
}
