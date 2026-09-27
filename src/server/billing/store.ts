import type {SupabaseClient} from '@supabase/supabase-js';
// Billing persistence, through the SERVER-ONLY functions of migration 017 (granted to service_role only).
// The billing tables live in the private schema: no browser session can read or write them.
export type BillingAccount={
 user_id:string;stripe_customer_id:string;stripe_subscription_id:string|null;stripe_price_id:string|null;plan:'PAID'|'PRO'|null;
 subscription_status:string|null;current_period_start:string|null;current_period_end:string|null;cancel_at_period_end:boolean;
};
export type SubscriptionState={
 eventId:string;eventType:string;customerId:string;subscriptionId:string;priceId:string|null;plan:'PAID'|'PRO'|null;
 status:string;periodStart:string|null;periodEnd:string|null;cancelAtPeriodEnd:boolean;paid:boolean;
};
export interface BillingStore{
 getAccount(userId:string):Promise<BillingAccount|null>;
 linkCustomer(userId:string,customerId:string):Promise<string>;
 applyState(state:SubscriptionState):Promise<{outcome:string;user_id:string|null}>;
}
export function supabaseBillingStore(admin:SupabaseClient):BillingStore{
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw Error('DATABASE_REQUEST_FAILED');return data};
 return {
  getAccount:async userId=>(await rpc('get_billing_account',{p_user_id:userId}))??null,
  linkCustomer:async(userId,customerId)=>String(await rpc('link_stripe_customer',{p_user_id:userId,p_customer_id:customerId})),
  applyState:async s=>rpc('apply_stripe_subscription_state',{
   p_event_id:s.eventId,p_event_type:s.eventType,p_customer_id:s.customerId,p_subscription_id:s.subscriptionId,p_price_id:s.priceId,
   p_plan:s.plan,p_status:s.status,p_period_start:s.periodStart,p_period_end:s.periodEnd,p_cancel_at_period_end:s.cancelAtPeriodEnd,p_paid:s.paid,
  }),
 };
}
