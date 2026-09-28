import {createHmac,timingSafeEqual} from 'node:crypto';
// Stripe webhook signature (https://docs.stripe.com/webhooks#verify-manually): header
// `Stripe-Signature: t=<unix>,v1=<hex>[,v1=...]`, signature = HMAC-SHA256(secret, `${t}.${rawBody}`).
// The raw body must be the exact bytes Stripe sent (never a re-serialized JSON). A timestamp outside the
// tolerance is refused, which bounds the replay window of a captured request.
export const SIGNATURE_TOLERANCE_SECONDS=300;
export function signPayload(rawBody:string,secret:string,timestamp:number){
 return createHmac('sha256',secret).update(`${timestamp}.${rawBody}`,'utf8').digest('hex');
}
export function verifyStripeSignature(rawBody:string,header:string|null,secret:string,nowSeconds=Math.floor(Date.now()/1000),tolerance=SIGNATURE_TOLERANCE_SECONDS):boolean{
 if(!header||!secret||header.length>2000)return false;
 let timestamp:number|null=null;const candidates:string[]=[];
 for(const part of header.split(',')){
  const i=part.indexOf('=');if(i<0)continue;
  const k=part.slice(0,i).trim(),v=part.slice(i+1).trim();
  if(k==='t'&&/^\d{1,12}$/.test(v))timestamp=Number(v);
  else if(k==='v1'&&/^[0-9a-f]{64}$/.test(v))candidates.push(v);
 }
 if(timestamp===null||!candidates.length||Math.abs(nowSeconds-timestamp)>tolerance)return false;
 const expected=Buffer.from(signPayload(rawBody,secret,timestamp),'hex');
 return candidates.some(c=>{const b=Buffer.from(c,'hex');return b.length===expected.length&&timingSafeEqual(b,expected)});
}
