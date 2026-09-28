import {handleStripeWebhook} from '../../../../../../src/server/billing/webhook';
import {billingDeps} from '../../../../../../src/server/billing';
// Stripe → ProspectOS. Unauthenticated by design (Stripe is the caller): the Stripe signature is the only
// credential, verified on the raw body before anything is read or written. More specific than the
// authenticated catch-all /api/v1/[...path], so it never goes through the user session gate.
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 const raw=await request.text();
 if(raw.length>512000)return Response.json({error:'Payload too large'},{status:413,headers});
 try{
  const result=await handleStripeWebhook(raw,request.headers.get('stripe-signature'),billingDeps());
  return Response.json(result.body,{status:result.status,headers});
 }catch(error){
  // 5xx: Stripe retries later; nothing was recorded for this event.
  console.error('billing webhook failed',error instanceof Error?error.message:'unknown');
  return Response.json({error:'Webhook processing failed'},{status:500,headers});
 }
}
