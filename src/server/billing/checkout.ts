import {z} from 'zod';
import {CHECKOUT_PRICES,TEAM_PRICING,type CheckoutPlan} from '../../domain/plans.ts';
import type {BillingConfig} from './config.ts';
import type {StripeApi,StripePrice} from './stripe-client.ts';
import type {BillingStore} from './store.ts';
// Self-service subscription (Stripe Checkout, hosted by Stripe — no card form in ProspectOS) and the Stripe
// Customer Portal. The browser only ever says WHICH offer (BETA, PRO or TEAM); the server decides the price id,
// checks that this price really is 49 € / 99 € per month, or the Équipe tiers, in EUR, and uses the customer it
// linked itself. For TEAM the number of accounts is chosen on the Stripe page, within 2–5 set by the server.
// Paying on the Stripe page grants nothing by itself: the plan is granted by the webhook (webhook.ts).
export type BillingResult={status:number;body:Record<string,unknown>};
export type BillingDeps={config:BillingConfig|null;stripe:StripeApi;store:BillingStore;log?:(message:string)=>void};
// Strict: a price_id, amount, currency, customer_id or any other key is refused, never ignored silently.
const CheckoutBody=z.object({plan:z.string()}).strict();
const PortalBody=z.object({}).strict();
// A subscription in one of these states already covers (or still bills) the account: manage it in the portal.
const BLOCKING=new Set(['active','trialing','past_due','unpaid','paused']);
const fail=(status:number,code:string,error:string):BillingResult=>({status,body:{error,code}});

// ProspectOS Équipe: exactly two graduated tiers — up to `includedSeats` for the flat base amount, then
// `extraSeatAmount` per account. Any other shape (volume tiers, another amount or bound) is not the offer.
export function teamTiersMatch(price:Pick<StripePrice,'billing_scheme'|'tiers_mode'|'tiers'>):boolean{
 const t=price.tiers;
 return price.billing_scheme==='tiered'&&price.tiers_mode==='graduated'&&Array.isArray(t)&&t.length===2
  &&t[0].up_to===TEAM_PRICING.includedSeats&&t[0].flat_amount===TEAM_PRICING.baseAmount&&!t[0].unit_amount
  &&t[1].up_to===null&&!t[1].flat_amount&&t[1].unit_amount===TEAM_PRICING.extraSeatAmount;
}
export function priceMatches(price:StripePrice,plan:CheckoutPlan,mode:BillingConfig['mode']):boolean{
 const recurring=price.active===true&&price.type==='recurring'&&price.recurring?.interval==='month'&&price.recurring.interval_count===1&&price.livemode===(mode==='live');
 if(plan==='TEAM')return recurring&&price.currency===TEAM_PRICING.currency&&teamTiersMatch(price);
 const expected=CHECKOUT_PRICES[plan];
 return recurring&&price.billing_scheme!=='tiered'&&price.currency===expected.currency&&price.unit_amount===expected.unitAmount;
}

export async function startCheckout(input:{userId:string;email:string|null;body:unknown;origin:string;now?:number},deps:BillingDeps):Promise<BillingResult>{
 const parsed=CheckoutBody.safeParse(input.body);
 if(!parsed.success)return fail(400,'INVALID_CHECKOUT_REQUEST','Offre invalide.');
 const plan=parsed.data.plan;
 if(plan==='ENTERPRISE')return fail(400,'ENTERPRISE_QUOTE_ONLY','L’offre Entreprise / White Label est sur devis. Contactez-nous.');
 if(plan!=='BETA'&&plan!=='PRO'&&plan!=='TEAM')return fail(400,'INVALID_CHECKOUT_REQUEST','Offre invalide.');
 const {config,stripe,store}=deps;
 if(!config||!config.checkoutEnabled)return fail(503,'BILLING_UNAVAILABLE','Le paiement en ligne n’est pas disponible pour le moment.');
 if(plan==='BETA'&&!config.betaCheckoutOpen)return fail(409,'BETA_OFFER_CLOSED','L’offre ProspectOS Bêta n’est plus proposée aux nouveaux abonnés.');
 const priceId=config.prices[plan];
 if(!priceId)return fail(503,'BILLING_UNAVAILABLE','Le paiement en ligne n’est pas disponible pour le moment.');
 const price=await stripe.retrievePrice(priceId,plan==='TEAM');
 if(!priceMatches(price,plan,config.mode)){deps.log?.(`billing: configured ${plan} price does not match the offer`);return fail(503,'BILLING_UNAVAILABLE','Le paiement en ligne n’est pas disponible pour le moment.')}
 const account=await store.getAccount(input.userId);
 if(account?.subscription_status&&BLOCKING.has(account.subscription_status))return fail(409,'SUBSCRIPTION_EXISTS','Vous avez déjà un abonnement. Gérez-le depuis « Gérer mon abonnement ».');
 // One Stripe customer per user, even for two checkouts started at the same moment: the idempotency key makes
 // Stripe return the same customer, and link_stripe_customer keeps the first one stored.
 const customerId=account?.stripe_customer_id??await store.linkCustomer(input.userId,(await stripe.createCustomer({email:input.email,userId:input.userId},`prospectos-customer-${input.userId}`)).id);
 const metadata={prospectos_user_id:input.userId,prospectos_plan:plan};
 // Same user + offer within 5 minutes (double click, retry) → Stripe returns the same session.
 const bucket=Math.floor((input.now??Date.now())/300000);
 const session=await stripe.createCheckoutSession({
  mode:'subscription',customer:customerId,client_reference_id:input.userId,
  line_items:[plan==='TEAM'
   ?{price:priceId,quantity:TEAM_PRICING.minSeats,adjustable_quantity:{enabled:true,minimum:TEAM_PRICING.minSeats,maximum:TEAM_PRICING.maxSeats}}
   :{price:priceId,quantity:1}],
  success_url:`${input.origin}/?billing=success`,cancel_url:`${input.origin}/?billing=cancel`,
  metadata,subscription_data:{metadata},
  // B2B invoicing data collected by Stripe: company name, billing address, VAT number.
  billing_address_collection:'required',tax_id_collection:{enabled:true},customer_update:{name:'auto',address:'auto'},
  allow_promotion_codes:false,
  ...(config.automaticTax?{automatic_tax:{enabled:true}}:{}),
 },`prospectos-checkout-${input.userId}-${plan}-${bucket}`);
 if(!session.url||!/^https:\/\/checkout\.stripe\.com\//.test(session.url))throw Error('STRIPE_REQUEST_FAILED');
 return {status:200,body:{url:session.url}};
}

export async function openPortal(input:{userId:string;body:unknown;origin:string},deps:BillingDeps):Promise<BillingResult>{
 if(!PortalBody.safeParse(input.body??{}).success)return fail(400,'INVALID_PORTAL_REQUEST','Requête invalide.');
 if(!deps.config)return fail(503,'BILLING_UNAVAILABLE','Le paiement en ligne n’est pas disponible pour le moment.');
 // The customer is the one linked to the authenticated user — never an id sent by the browser.
 const account=await deps.store.getAccount(input.userId);
 if(!account)return fail(404,'NO_BILLING_ACCOUNT','Aucun abonnement associé à ce compte.');
 const session=await deps.stripe.createPortalSession({
  customer:account.stripe_customer_id,return_url:`${input.origin}/?billing=portal`,
  ...(deps.config.portalConfiguration?{configuration:deps.config.portalConfiguration}:{}),
 });
 if(!session.url||!/^https:\/\/billing\.stripe\.com\//.test(session.url))throw Error('STRIPE_REQUEST_FAILED');
 return {status:200,body:{url:session.url}};
}
