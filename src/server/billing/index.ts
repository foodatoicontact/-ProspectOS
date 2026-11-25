import {createAdminClient} from '../admin-client.ts';
import {billingConfig} from './config.ts';
import {createStripeClient,type StripeApi} from './stripe-client.ts';
import {supabaseBillingStore} from './store.ts';
import {supabasePartnerStore,partnerOfUser} from './partners.ts';
import {partnersEnabledIn} from '../../partners/flag.ts';
// Production wiring of the billing services (the services themselves take their dependencies as arguments).
const unavailable:StripeApi=new Proxy({} as StripeApi,{get:()=>async()=>{throw Error('CONFIGURATION_REQUIRED')}});
export function billingDeps(){
 const config=billingConfig();
 const admin=createAdminClient();const client=config?createStripeClient(config.secretKey):null;
 // Programme partenaires (052): only when its flag is on — the commission lines, and the partner id in the Stripe metadata.
 const partners=partnersEnabledIn(process.env)&&client?{stripe:client,store:supabasePartnerStore(admin)}:null;
 return {config,stripe:client??unavailable,store:supabaseBillingStore(admin),log:(m:string)=>console.warn(m),partners,
  partnerOf:partners?partnerOfUser(admin):undefined};
}
// The origin used for Stripe return URLs: the configured public URL, else the request's own origin.
export function appOrigin(request:Request){
 const configured=process.env.APP_BASE_URL;
 if(configured&&/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(configured))return configured;
 return new URL(request.url).origin;
}
