// Cockpit administrateur — écran Clients (migration 059). The model of a client sheet and the server's reading of the
// invoices from Stripe: read-only, at display time, never stored; the database refuses the sheet to anyone but the
// administrator before Stripe is ever asked. Links go to the Stripe dashboard (behind the owner's Stripe login), never to
// a public invoice link.
import {billingConfig} from '../server/billing/config.ts';
import {createStripeClient,type StripeInvoiceSummary} from '../server/billing/stripe-client.ts';
export type StripeMode='test'|'live';
export type InvoiceLine={id:string;number:string|null;status:string|null;currency:string;total_cents:number;paid_cents:number;created:string;url:string};
export const stripeDashboard=(mode:StripeMode,path:string)=>`https://dashboard.stripe.com/${mode==='test'?'test/':''}${path}`;
export function invoiceLines(rows:StripeInvoiceSummary[]|undefined,mode:StripeMode):InvoiceLine[]{
 return (Array.isArray(rows)?rows:[]).filter(r=>/^in_[A-Za-z0-9]+$/.test(r?.id??'')&&r.livemode===(mode==='live')).map(r=>({id:r.id,number:typeof r.number==='string'?r.number.slice(0,40):null,
  status:typeof r.status==='string'?r.status:null,currency:String(r.currency??'eur').slice(0,3),total_cents:Number(r.total)||0,paid_cents:Number(r.amount_paid)||0,
  created:new Date((Number(r.created)||0)*1000).toISOString(),url:stripeDashboard(mode,`invoices/${r.id}`)}));
}
export type InvoiceReader=(customerId:string)=>Promise<{mode:StripeMode;invoices:InvoiceLine[]}|null>;
// Production: the configured Stripe key (test or live); null when billing is not configured. A Stripe failure is null too:
// the sheet still opens, saying the invoices could not be read.
export const stripeInvoiceReader=(env:Record<string,string|undefined>=process.env):InvoiceReader=>async customerId=>{
 const config=billingConfig(env);if(!config)return null;
 try{const r=await createStripeClient(config.secretKey).listInvoices(customerId,12);return {mode:config.mode,invoices:invoiceLines(r.data,config.mode)}}
 catch{return null}
};
