import {createAdminClient} from '../admin-client.ts';
import {billingConfig} from './config.ts';
import {createStripeClient,type StripeApi} from './stripe-client.ts';
import {supabaseBillingStore} from './store.ts';
// Production wiring of the billing services (the services themselves take their dependencies as arguments).
const unavailable:StripeApi=new Proxy({} as StripeApi,{get:()=>async()=>{throw Error('CONFIGURATION_REQUIRED')}});
export function billingDeps(){
 const config=billingConfig();
 return {config,stripe:config?createStripeClient(config.secretKey):unavailable,store:supabaseBillingStore(createAdminClient()),log:(m:string)=>console.warn(m)};
}
// The origin used for Stripe return URLs: the configured public URL, else the request's own origin.
export function appOrigin(request:Request){
 const configured=process.env.APP_BASE_URL;
 if(configured&&/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(configured))return configured;
 return new URL(request.url).origin;
}
