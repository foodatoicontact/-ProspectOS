import {after} from 'next/server';
import {randomBytes,randomUUID} from 'node:crypto';
import {createAdminClient} from '../../../src/server/admin-client';
import {isDemoToken,demoTokenHash} from '../../../src/demo-share/token';
import {isPreviewBot,isPrefetch} from '../../../src/demo-share/bots';
import {createRateLimiter,clientKey} from '../../../src/demo-share/rate-limit';
import {DemoViewSchema} from '../../../src/demo-share/view';
import {renderDemoPage,renderDemoUnavailable} from '../../../src/demo-share/page';
import {notifyFirstView} from '../../../src/demo-share/notify';
import {smtpConfig} from '../../../src/self-outreach/config';
import {smtpTransportFrom} from '../../../src/self-outreach/transport';
import {SITE_URL} from '../../../src/domain/seo';
// Public demo link (migration 042, src/demo-share): a read-only page of ONE project's companies, opened without an
// account by whoever holds the link. The token is checked on the server by its SHA-256, with expiry and revocation; an
// unknown, expired or revoked link gets the same neutral page. Nothing here accepts an action: GET and HEAD only.
// Loading the page changes nothing but the view counter, and link-preview robots are served without being counted.
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
// 30 pages a minute per address and server instance: far above a person reading, far below a scan.
const limiter=createRateLimiter({limit:30,windowMs:60000});
function html(body:string,status:number,nonce:string|null,extra:Record<string,string>={}){
 return new Response(body,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex, nofollow, noarchive',
  'referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-frame-options':'DENY',
  'content-security-policy':`default-src 'none'; style-src 'unsafe-inline'; ${nonce?`script-src 'nonce-${nonce}'; `:''}img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,...extra}});
}
const unavailable=()=>html(renderDemoUnavailable('invalid'),404,null);

export async function GET(request:Request,context:{params:Promise<{token:string}>}){
 const limit=limiter.hit(clientKey(request.headers));
 if(!limit.allowed)return html(renderDemoUnavailable('busy'),429,null,{'retry-after':String(limit.retryAfterSeconds)});
 const {token}=await context.params;
 if(!isDemoToken(token))return unavailable();
 const hash=demoTokenHash(token);
 let admin;try{admin=createAdminClient()}catch{return html(renderDemoUnavailable('unavailable'),503,null)}
 const {data,error}=await admin.rpc('read_demo_share',{p_token_hash:hash});
 if(error)return html(renderDemoUnavailable('unavailable'),503,null);
 const view=DemoViewSchema.safeParse(data);
 if(!data||!view.success)return unavailable();
 // A person opening the link: counted once per load, after the page is sent. A preview robot or a prefetch: not counted.
 if(!isPreviewBot(request.headers.get('user-agent'))&&!isPrefetch(request.headers)){
  after(async()=>{
   try{
    const {data:seen,error:countError}=await admin.rpc('record_demo_share_view',{p_token_hash:hash});
    if(countError||!seen?.first)return;
    const cfg=smtpConfig(process.env);
    const outcome=cfg?await notifyFirstView({to:seen.owner_email??null,projectName:seen.project_name??null,viewedAt:new Date(seen.viewed_at??Date.now()),siteUrl:SITE_URL,
     messageDomain:cfg.fromEmail.split('@')[1]!,transport:async()=>smtpTransportFrom(cfg,await import('nodemailer')),id:randomUUID}):'SKIPPED';
    console.info(JSON.stringify({event:'demo_share_first_view',notification:outcome}));
   }catch{/* the page was already served; a failed count never surfaces to the visitor */}
  });
 }
 const nonce=randomBytes(16).toString('base64');
 return html(renderDemoPage(view.data,{token,nonce,author:process.env.DEMO_SHARE_AUTHOR}),200,nonce);
}
// HEAD answers the headers of the neutral page shape without reading or counting anything.
export async function HEAD(){return new Response(null,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex, nofollow, noarchive'}})}
