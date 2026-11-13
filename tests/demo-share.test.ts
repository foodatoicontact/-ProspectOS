import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newDemoToken,isDemoToken,demoTokenHash,demoLink} from '../src/demo-share/token.ts';
import {isPreviewBot,isPrefetch} from '../src/demo-share/bots.ts';
import {createRateLimiter,clientKey} from '../src/demo-share/rate-limit.ts';
import {DemoViewSchema,demoCompanies,officialLink} from '../src/demo-share/view.ts';
import {renderDemoPage,renderDemoUnavailable,frenchDate} from '../src/demo-share/page.ts';
import {handleDemoShares} from '../src/demo-share/api.ts';
import {firstViewEmail,notifyFirstView} from '../src/demo-share/notify.ts';
import {MockTransport} from '../src/self-outreach/transport.ts';
import {robotsPolicy} from '../src/domain/seo.ts';

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const headers=(h:Record<string,string>)=>({get:(k:string)=>h[k.toLowerCase()]??null});
const json=(value:unknown,status=200)=>Response.json(value,{status});

test('token: 32 random bytes in base64url, only its SHA-256 is ever handed to the database',()=>{
 const a=newDemoToken(),b=newDemoToken();
 assert.equal(Buffer.from(a,'base64url').length,32);assert.match(a,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(a,b);
 assert.ok(isDemoToken(a));for(const bad of ['',a.slice(1),a+'A',a.replace(/.$/,'+'),null,42,'../../etc/passwd'])assert.equal(isDemoToken(bad),false);
 assert.match(demoTokenHash(a),/^[0-9a-f]{64}$/);assert.notEqual(demoTokenHash(a),a);
 assert.equal(demoLink('https://prospectos.fr',a),`https://prospectos.fr/d/${a}`);
});

test('preview robots are recognised (served, never counted); a real phone browser is a person',()=>{
 for(const ua of ['LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)','facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)','Twitterbot/1.0','WhatsApp/2.23.20.0','TelegramBot (like TwitterBot)','Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)','curl/8.5.0','','   '])assert.equal(isPreviewBot(ua),true,ua);
 assert.equal(isPreviewBot(null),true);
 for(const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'])assert.equal(isPreviewBot(ua),false,ua);
 assert.equal(isPrefetch(headers({'sec-purpose':'prefetch;prerender'})),true);assert.equal(isPrefetch(headers({purpose:'prefetch'})),true);assert.equal(isPrefetch(headers({})),false);
});

test('rate limit: a fixed window per address, then a wait; another address is not affected',()=>{
 const l=createRateLimiter({limit:3,windowMs:60000});
 for(let i=0;i<3;i++)assert.equal(l.hit('1.1.1.1',1000+i).allowed,true);
 const blocked=l.hit('1.1.1.1',2000);assert.equal(blocked.allowed,false);assert.ok(blocked.retryAfterSeconds>=1&&blocked.retryAfterSeconds<=60);
 assert.equal(l.hit('2.2.2.2',2000).allowed,true);
 assert.equal(l.hit('1.1.1.1',1000+60000).allowed,true,'a new window opens');
 const small=createRateLimiter({limit:1,windowMs:1000,maxKeys:2});small.hit('a',0);small.hit('b',0);assert.equal(small.hit('c',1).allowed,true,'memory stays bounded');
 assert.equal(clientKey(headers({'x-forwarded-for':'9.9.9.9, 10.0.0.1'})),'9.9.9.9');assert.equal(clientKey(headers({'x-real-ip':'8.8.8.8','x-forwarded-for':'9.9.9.9'})),'8.8.8.8');assert.equal(clientKey(headers({})),'unknown');
});

const VIEW=DemoViewSchema.parse({project:{name:'Alexandre · Garages repris IDF'},target:'Garages qui viennent d’être repris en Île-de-France',prospects:[
 {name:'ATELIER <b>MÉCA</b>',city:'Osny',signals:[{signal_type:'acquisition',title:'Vente',excerpt:'entretien et réparation "auto"',source_url:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A1',event_date:'2026-09-29',demo:{department:'95',activity:'Entretien et réparation'}}]},
 {name:'VENDEUR RÉCENT',city:'Cergy',signals:[{signal_type:'acquisition',title:'Vente',excerpt:'achat et vente de véhicules',source_url:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A2',event_date:'2026-11-12',demo:{department:'95',activity:'Achat-vente de véhicules',sells_vehicles:true,is_new:true,hook:'J’ai vu que vous avez repris le garage à Cergy en novembre.'}}]},
 {name:'VENDEUR ANCIEN',city:'Paris',signals:[{signal_type:'acquisition',title:'Vente',excerpt:'négoce de voitures',source_url:'javascript:alert(1)',event_date:'2026-05-02',demo:{department:'75',sells_vehicles:true}}]},
 {name:'SANS SIGNAL',city:null,signals:[]},
]});

test('order: the marked priority first, then the most recent signal; a non-http source is no link',()=>{
 const rows=demoCompanies(VIEW);
 assert.deepEqual(rows.map(r=>r.name),['VENDEUR RÉCENT','VENDEUR ANCIEN','ATELIER <b>MÉCA</b>','SANS SIGNAL']);
 assert.equal(rows[0]!.isNew,true);assert.equal(rows[1]!.isNew,false);assert.equal(rows[1]!.sourceUrl,null);
 assert.equal(rows[0]!.signalLabel,'Reprise de fonds de commerce');
 assert.equal(officialLink('https://user:pw@bodacc.fr/x'),null);assert.equal(officialLink('ftp://x'),null);
 assert.equal(frenchDate('2026-11-01'),'1er novembre 2026');assert.equal(frenchDate('2026-10-27'),'27 octobre 2026');assert.equal(frenchDate('nope'),null);
});

test('page: banner, project, target, count, list with signal, date, Nouveau, official link — escaped, noindex, no phone, no email',()=>{
 const token='t'.repeat(43);const html=renderDemoPage(VIEW,{token,nonce:'N0nce'});
 assert.match(html,/Démo préparée pour vous par <b>Kevin<\/b>, ProspectOS/);
 assert.match(html,/<h1>Alexandre · Garages repris IDF<\/h1>/);assert.match(html,/Garages qui viennent d’être repris en Île-de-France/);
 assert.match(html,/<b>4<\/b><span>entreprises<\/span>/);
 assert.match(html,/Reprise de fonds de commerce/);assert.match(html,/12 novembre 2026/);assert.match(html,/95 · Cergy/);
 assert.equal((html.match(/class="new">Nouveau</g)??[]).length,1);
 assert.match(html,/href="https:\/\/www\.bodacc\.fr\/pages\/annonces-commerciales-detail\/\?q\.id=id:A2" target="_blank" rel="noopener noreferrer nofollow"/);
 assert.match(html,/Créer mon compte et garder ces résultats/);
 assert.match(html,/<meta name="robots" content="noindex,nofollow,noarchive">/);assert.match(html,/<meta name="referrer" content="no-referrer">/);
 assert.ok(html.includes('ATELIER &lt;b&gt;MÉCA&lt;/b&gt;'));assert.ok(!html.includes('<b>MÉCA</b>'));assert.ok(!html.includes('javascript:'));
 assert.doesNotMatch(html,/tel:|mailto:|Téléphone\s*:|E-?mail\s*:/i,'no contact channel is suggested');
 assert.equal((html.match(/<script/g)??[]).length,1);assert.match(html,/<script nonce="N0nce">/);
 assert.doesNotMatch(html,/<form|<input|<button/,'no action is possible from the page');
 assert.doesNotMatch(html,/https?:\/\/(?!www\.bodacc\.fr)[^"'\s]+/,'no request or link to any other host');
 assert.match(renderDemoPage(VIEW,{token,nonce:'n',author:'Léa <x>'}),/par <b>Léa &lt;x&gt;<\/b>/);
});

test('unavailable page: one neutral wording for unknown, expired and revoked',()=>{
 const html=renderDemoUnavailable();
 assert.match(html,/Lien expiré ou invalide/);assert.match(html,/noindex/);
 assert.doesNotMatch(html,/révoqué|désactivé|a existé|n’existe pas|introuvable/i);assert.doesNotMatch(html,/<script/);
});

test('route: checks the token before the database, serves robots without counting, sets noindex and no-referrer headers',()=>{
 const src=read('../app/d/[token]/route.ts');
 assert.match(src,/'x-robots-tag':'noindex, nofollow, noarchive'/);assert.match(src,/'referrer-policy':'no-referrer'/);assert.match(src,/'cache-control':'private, no-store'/);
 assert.ok(src.indexOf('limiter.hit(')<src.indexOf('isDemoToken(token)')&&src.indexOf('isDemoToken(token)')<src.indexOf("rpc('read_demo_share'"),'rate limit, then shape, then database');
 assert.match(src,/if\(!isPreviewBot\(request\.headers\.get\('user-agent'\)\)&&!isPrefetch\(request\.headers\)\)\{\s*after\(/,'only a person is counted');
 assert.equal((src.match(/record_demo_share_view/g)??[]).length,1);
 assert.match(src,/if\(!data\|\|!view\.success\)return unavailable\(\)/);
 assert.deepEqual([...src.matchAll(/export async function (\w+)/g)].map(m=>m[1]),['GET','HEAD'],'no method that could change anything');
 assert.doesNotMatch(src,/console\.(info|log|error)\([^)]*token/,'the token is never logged');
 assert.ok(robotsPolicy.disallow.includes('/d/'));
});

test('api: create returns the link once and stores only the hash; list never selects the hash; refusals are mapped',async()=>{
 const calls:any[]=[];let selected='';
 const db:any={rpc:async(name:string,args:any)=>{calls.push([name,args]);
   if(name==='create_demo_share')return args.p_project_id.startsWith('11111111')?{data:{id:'s1',view_count:0},error:null}:{data:null,error:{message:'Authenticated owner required',code:'42501'}};
   if(name==='claim_demo_share')return {data:null,error:{message:'demo_share_invalid',code:'P0001'}};
   return {data:true,error:null}},
  from:()=>({select:(c:string)=>{selected=c;return {eq:()=>({order:()=>({limit:async()=>({data:[{id:'s1'}],error:null})})})}}})};
 const req=(method:string,url='https://prospectos.fr/api/v1/demo-shares')=>new Request(url,{method});
 assert.equal(await handleDemoShares(req('GET'),['projects'],{},db,json),null,'other resources are left alone');
 const ok=await handleDemoShares(req('POST'),['demo-shares'],{project_id:'11111111-1111-4111-8111-111111111111',target:' Garages '},db,json);
 assert.equal(ok!.status,201);const body=await ok!.json();
 const token=body.link.split('/d/')[1];assert.ok(isDemoToken(token));assert.ok(body.link.startsWith('https://prospectos.fr/d/'));
 assert.equal(calls[0][1].p_token_hash,demoTokenHash(token));assert.equal(calls[0][1].p_target,'Garages');assert.equal(calls[0][1].p_days,14);
 assert.ok(!JSON.stringify(calls).includes(token),'the raw token never goes to the database');
 const denied=await handleDemoShares(req('POST'),['demo-shares'],{project_id:'22222222-2222-4222-8222-222222222222'},db,json);
 assert.equal(denied!.status,403);assert.equal((await denied!.json()).code,'DEMO_SHARE_OWNER_REQUIRED');
 assert.equal((await handleDemoShares(req('POST'),['demo-shares'],{project_id:'x'},db,json))!.status,400);
 assert.equal((await handleDemoShares(req('POST'),['demo-shares'],{project_id:'11111111-1111-4111-8111-111111111111',days:900},db,json))!.status,400,'unknown fields are refused');
 const list=await handleDemoShares(req('GET','https://prospectos.fr/api/v1/demo-shares?project_id=11111111-1111-4111-8111-111111111111'),['demo-shares'],{},db,json);
 assert.equal(list!.status,200);assert.doesNotMatch(selected,/token_hash|\*/);
 assert.equal((await handleDemoShares(req('GET'),['demo-shares'],{},db,json))!.status,400);
 assert.equal((await handleDemoShares(req('POST'),['demo-shares','claim'],{token:'short'},db,json))!.status,410);
 const gone=await handleDemoShares(req('POST'),['demo-shares','claim'],{token:'a'.repeat(43)},db,json);
 assert.equal(gone!.status,410);assert.equal(calls.at(-1)[1].p_token_hash,demoTokenHash('a'.repeat(43)));
 assert.equal((await handleDemoShares(req('POST'),['demo-shares','33333333-3333-4333-8333-333333333333','revoke'],{},db,json))!.status,200);
 assert.equal((await handleDemoShares(req('POST'),['demo-shares','nope','revoke'],{},db,json))!.status,400);
});

test('first view: one plain email to the creator, nothing about the visitor; no address or no SMTP means nothing sent',async()=>{
 const mail=firstViewEmail({projectName:'Alexandre · Garages\nrepris IDF',viewedAt:new Date('2026-11-13T14:05:00Z'),siteUrl:'https://prospectos.fr'});
 assert.equal(mail.subject,'Votre démo « Alexandre · Garages repris IDF » vient d’être ouverte');assert.match(mail.text,/15 h 05/);
 assert.doesNotMatch(mail.text,/adresse IP|navigateur|user-agent/i);
 const t=new MockTransport();const base={projectName:'P',viewedAt:new Date(),siteUrl:'https://prospectos.fr',messageDomain:'prospectos.fr',transport:async()=>t,id:()=>'x'};
 assert.equal(await notifyFirstView({...base,to:'owner@example.fr'}),'SENT');assert.equal(t.sent.length,1);assert.equal(t.sent[0]!.to,'owner@example.fr');
 assert.equal(await notifyFirstView({...base,to:null}),'SKIPPED');assert.equal(await notifyFirstView({...base,to:'not an address'}),'SKIPPED');
 assert.equal(await notifyFirstView({...base,to:'owner@example.fr',transport:async()=>{throw Error('SMTP')}}),'FAILED');
 assert.equal(t.sent.length,1);
});

test('wiring: the API module is called by the catch-all route, the panel and the claim are mounted in the v2 shell only',()=>{
 const route=read('../app/api/v1/[...path]/route.ts');assert.match(route,/handleDemoShares\(request,path,body,db,json\)/);
 const page=read('../app/page.tsx');const v2=page.slice(page.indexOf(' if(v2){'));
 assert.match(v2,/<v2\.DemoSharePanel key=\{`demo-\$\{project\.id\}`\}/);assert.match(v2,/const demoClaim=mode===.live.&&token&&<v2\.DemoClaim api=\{api\}/);assert.match(v2,/return <>\{demoClaim\}<Shell /);
 assert.doesNotMatch(page.slice(0,page.indexOf(' if(v2){')),/DemoShare|DemoClaim/);
 const panel=read('../src/components/DemoSharePanel.tsx');assert.match(panel,/DEMO_CLAIM_KEY='prospectos-demo-claim-v1'/);assert.match(read('../src/demo-share/page.ts'),/prospectos-demo-claim-v1/);
});
