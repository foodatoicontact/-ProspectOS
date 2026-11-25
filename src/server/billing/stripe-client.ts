// Minimal Stripe REST client (server only): the five calls ProspectOS needs (four more for the partner programme, 052), no SDK dependency. The API
// version is pinned so the shapes parsed in webhook.ts never change underneath us; the parsing still accepts
// both locations of the billing period (subscription level before 2025-03-31.basil, item level after).
// The secret key only ever goes into the Authorization header of a request to api.stripe.com.
export const STRIPE_API_VERSION='2025-03-31.basil';
const STRIPE_API='https://api.stripe.com/v1';

export type StripePriceTier={up_to:number|null;flat_amount:number|null;unit_amount:number|null};
// tiers are only present when expanded: retrievePrice(id,true), used for the Équipe price only.
export type StripePrice={id:string;active:boolean;currency:string;unit_amount:number|null;livemode:boolean;recurring:{interval:string;interval_count:number}|null;type:string;
 billing_scheme?:string;tiers_mode?:string|null;tiers?:StripePriceTier[]};
export type StripeInvoice={id:string;status:string|null;paid?:boolean};
export type StripeSubscription={
 id:string;customer:string;status:string;cancel_at_period_end:boolean;livemode:boolean;
 current_period_start?:number;current_period_end?:number;
 items:{data:{price:{id:string}&Partial<StripePrice>;quantity?:number;current_period_start?:number;current_period_end?:number}[]};
 latest_invoice:string|StripeInvoice|null;metadata?:Record<string,string>;
};
// Programme partenaires (052): an invoice and a charge as re-read from Stripe, never as sent in a webhook body.
export type StripeInvoiceFull={id:string;status:string|null;customer:string|null;currency:string;livemode:boolean;amount_paid:number;total:number;
 total_excluding_tax:number|null;status_transitions?:{paid_at?:number|null}};
export type StripeCharge={id:string;livemode:boolean;currency:string;amount:number;amount_refunded:number;customer:string|null;
 payment_intent:string|null;invoice?:string|null};
export interface PartnerStripeApi{
 retrieveInvoice(id:string):Promise<StripeInvoiceFull>;
 retrieveCharge(id:string):Promise<StripeCharge>;
 // The invoice a payment belongs to (API 2025-03-31.basil: charges no longer name it; the invoice payments do).
 invoiceForPaymentIntent(paymentIntentId:string):Promise<string|null>;
 updateCustomerMetadata(customerId:string,metadata:Record<string,string>):Promise<unknown>;
}
export interface StripeApi{
 retrievePrice(id:string,withTiers?:boolean):Promise<StripePrice>;
 createCustomer(params:{email:string|null;userId:string;partnerId?:string|null},idempotencyKey:string):Promise<{id:string}>;
 createCheckoutSession(params:Record<string,unknown>,idempotencyKey:string):Promise<{id:string;url:string|null}>;
 createPortalSession(params:Record<string,unknown>):Promise<{url:string}>;
 retrieveSubscription(id:string):Promise<StripeSubscription>;
 // Programme partenaires only (absent from test doubles that do not need it).
 updateCustomerMetadata?(customerId:string,metadata:Record<string,string>):Promise<unknown>;
}
export class StripeRequestError extends Error{
 readonly status:number;readonly type:string|null;
 constructor(status:number,type:string|null){super('STRIPE_REQUEST_FAILED');this.status=status;this.type=type}
}

// application/x-www-form-urlencoded with Stripe's bracket notation: a[b][0][c]=v.
export function formEncode(params:Record<string,unknown>,prefix=''):string{
 const out:string[]=[];
 for(const [k,v] of Object.entries(params)){
  if(v===undefined||v===null)continue;
  const key=prefix?`${prefix}[${k}]`:k;
  if(Array.isArray(v))v.forEach((item,i)=>{if(item!==null&&typeof item==='object')out.push(formEncode(item as Record<string,unknown>,`${key}[${i}]`));else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)});
  else if(typeof v==='object')out.push(formEncode(v as Record<string,unknown>,key));
  else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
 }
 return out.filter(Boolean).join('&');
}

export function createStripeClient(secretKey:string,fetchImpl:typeof fetch=fetch):StripeApi&PartnerStripeApi{
 async function call<T>(method:'GET'|'POST',path:string,params?:Record<string,unknown>,idempotencyKey?:string):Promise<T>{
  const body=params?formEncode(params):'';
  const url=method==='GET'&&body?`${STRIPE_API}${path}?${body}`:`${STRIPE_API}${path}`;
  const headers:Record<string,string>={Authorization:`Bearer ${secretKey}`,'Stripe-Version':STRIPE_API_VERSION};
  if(method==='POST')headers['Content-Type']='application/x-www-form-urlencoded';
  if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
  const res=await fetchImpl(url,{method,headers,...(method==='POST'?{body}:{}),signal:AbortSignal.timeout(15000)});
  const data=await res.json().catch(()=>null) as any;
  // Never propagate Stripe's message verbatim (it can echo request parameters): status and type only.
  if(!res.ok)throw new StripeRequestError(res.status,typeof data?.error?.type==='string'?data.error.type:null);
  return data as T;
 }
 const id=(v:string,prefix:string)=>{if(!new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(v))throw Error('INVALID_STRIPE_ID');return v};
 return {
  retrievePrice:async(priceId,withTiers)=>call('GET',`/prices/${id(priceId,'price')}`,withTiers?{expand:['tiers']}:undefined),
  createCustomer:({email,userId,partnerId},key)=>call('POST','/customers',{...(email?{email}:{}),metadata:{prospectos_user_id:userId,...(partnerId?{prospectos_partner_id:partnerId}:{})}},key),
  createCheckoutSession:(params,key)=>call('POST','/checkout/sessions',params,key),
  createPortalSession:params=>call('POST','/billing_portal/sessions',params),
  retrieveSubscription:async subId=>call('GET',`/subscriptions/${id(subId,'sub')}`,{expand:['latest_invoice']}),
  retrieveInvoice:async invId=>call('GET',`/invoices/${id(invId,'in')}`),
  retrieveCharge:async chId=>call('GET',`/charges/${/^py_/.test(chId)?id(chId,'py'):id(chId,'ch')}`),
  invoiceForPaymentIntent:async pi=>{
   const r=await call<{data?:Array<{invoice?:unknown}>}>('GET','/invoice_payments',{payment:{type:'payment_intent',payment_intent:id(pi,'pi')},limit:1});
   const inv=r.data?.[0]?.invoice;return typeof inv==='string'&&/^in_[A-Za-z0-9]+$/.test(inv)?inv:null;
  },
  updateCustomerMetadata:(cusId,metadata)=>call('POST',`/customers/${id(cusId,'cus')}`,{metadata}),
 };
}
