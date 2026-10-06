// Minimal Stripe REST client (server only): the five calls ProspectOS needs, no SDK dependency. The API
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
export interface StripeApi{
 retrievePrice(id:string,withTiers?:boolean):Promise<StripePrice>;
 createCustomer(params:{email:string|null;userId:string},idempotencyKey:string):Promise<{id:string}>;
 createCheckoutSession(params:Record<string,unknown>,idempotencyKey:string):Promise<{id:string;url:string|null}>;
 createPortalSession(params:Record<string,unknown>):Promise<{url:string}>;
 retrieveSubscription(id:string):Promise<StripeSubscription>;
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

export function createStripeClient(secretKey:string,fetchImpl:typeof fetch=fetch):StripeApi{
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
  createCustomer:({email,userId},key)=>call('POST','/customers',{...(email?{email}:{}),metadata:{prospectos_user_id:userId}},key),
  createCheckoutSession:(params,key)=>call('POST','/checkout/sessions',params,key),
  createPortalSession:params=>call('POST','/billing_portal/sessions',params),
  retrieveSubscription:async subId=>call('GET',`/subscriptions/${id(subId,'sub')}`,{expand:['latest_invoice']}),
 };
}
