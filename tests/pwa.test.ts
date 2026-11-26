// ProspectOS installable (PWA, migration 057, owner decision 26 nov. 2026): the manifest, the service worker (what it may
// cache, what it shows), the invitation rules, web push sending, the API and the wiring. The database side (consent,
// preferences, queue, events, RLS) is tests/pwa-push-db.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import manifest,{THEME_COLOR} from '../app/manifest.ts';
import {mayInvite,afterShown,readState,platformOf,isIosSafari,urlBase64ToBytes,MAX_SHOWS,MIN_GAP_MS,FIRST_SESSION_QUIET_MS,type InstallState} from '../src/pwa/rules.ts';
import {vapidConfig,sendUserPushes,pushPayload} from '../src/pwa/webpush.ts';
import {handleApp} from '../src/pwa/api.ts';
import {NOTIFY,INSTALL_COPY,PUSH_COPY,EMAIL_INSTALL_LINE} from '../src/pwa/copy.ts';
import {acceptanceEmails} from '../src/dedicated/notify.ts';
const read=(f:string)=>readFileSync(new URL(`../${f}`,import.meta.url),'utf8');
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

test('manifest — name, the favicon\'s icons (192/512, maskable), theme colour, standalone, opening on /app',()=>{
 const m=manifest();
 assert.equal(m.name,'ProspectOS');assert.equal(m.start_url,'/app');assert.equal(m.display,'standalone');assert.equal(m.scope,'/');
 assert.equal(m.theme_color,THEME_COLOR);assert.equal(THEME_COLOR,'#236c53','the green of app/icon.png');
 const sizes=m.icons!.map(i=>`${i.sizes}:${i.purpose}`).sort();
 assert.deepEqual(sizes,['192x192:any','192x192:maskable','512x512:any','512x512:maskable']);
 for(const i of m.icons!)assert.ok(existsSync(new URL(`../public${i.src}`,import.meta.url)),i.src);
 assert.match(read('app/layout.tsx'),/export const viewport:Viewport=\{themeColor:'#236c53'\};/);
 assert.match(read('app/layout.tsx'),/appleWebApp:\{capable:true,title:'ProspectOS',statusBarStyle:'default'\}/);
 const app=read('app/app/page.tsx');assert.match(app,/robots:\{index:false,follow:false\}/);assert.match(app,/return <Home\/>/);
});

test('service worker — caches public pages and the shell only: never an API answer, a credentialed request or a private page',()=>{
 const sw=read('public/sw.js');
 assert.match(sw,/const PRIVATE=\/\^\\\/\(api\|cockpit\|partenaires\\\/\(espace\|admin\)\|d\)\(\\\/\|\$\)\/;/);
 assert.match(sw,/request\.method==='GET'&&url\.origin===self\.location\.origin&&!PRIVATE\.test\(url\.pathname\)&&!request\.headers\.has\('authorization'\)/);
 assert.match(sw,/const SHELL=\['\/app','\/','\/icons\/icon-192\.png','\/icons\/icon-512\.png'\];/);
 assert.match(sw,/res\.ok&&!url\.search&&\(res\.headers\.get\('content-type'\)\|\|''\)\.includes\('text\/html'\)/,'only plain HTML pages, without query string');
 assert.doesNotMatch(sw,/indexedDB|localStorage|cookie/i);
 const re=/const PRIVATE=(\/.*\/);/.exec(sw)![1]!;const PRIVATE=eval(re) as RegExp;
 for(const p of ['/api/v1/prospects','/api/public/demande-veille','/cockpit','/partenaires/espace','/partenaires/admin','/d/abc'])assert.ok(PRIVATE.test(p),p);
 for(const p of ['/','/app','/tarifs','/partenaires','/installer-application'])assert.ok(!PRIVATE.test(p),p);
 // The notification texts of the worker are those of src/pwa/copy.ts, word for word.
 for(const l of ['fr','en'] as const)for(const [k,v] of Object.entries(NOTIFY[l])){assert.ok(sw.includes(`${k}:{title:'${v.title}',body:'${v.body}'}`),`${l} ${k}`)}
 assert.match(sw,/data\.url\.startsWith\('\/'\)\?data\.url:'\/app'/,'a link out of ProspectOS is never opened');
 assert.match(read('src/pwa/PwaBoot.tsx'),/useEffect\(\(\)=>\{bootPwa\(\)\},\[\]\);return null/);
});

const S=(o:Partial<InstallState>={}):InstallState=>({device:'device-0000000000000001',firstSeenAt:0,shows:0,lastShownAt:null,installed:false,pushOffered:false,...o});
const ok={now:FIRST_SESSION_QUIET_MS+1,platform:'ios' as const,standalone:false,refused:false,iosSafari:true,androidPrompt:false};
test('invitation rules — mobile only, not installed, not refused, never in the first 2 minutes, 3 times at most, 7 days apart',()=>{
 assert.equal(mayInvite({...ok,state:S()}),true);
 assert.equal(mayInvite({...ok,state:S(),now:FIRST_SESSION_QUIET_MS-1}),false,'first 2 minutes of the first session');
 assert.equal(mayInvite({...ok,state:S(),platform:'desktop'}),false,'never on a computer');
 assert.equal(mayInvite({...ok,state:S(),standalone:true}),false,'already the app');
 assert.equal(mayInvite({...ok,state:S({installed:true})}),false,'installed on this device: never again');
 assert.equal(mayInvite({...ok,state:S(),refused:true}),false,'« Ne plus afficher » on the account');
 assert.equal(mayInvite({...ok,state:S(),iosSafari:false}),false,'iPhone: only Safari can add to the home screen');
 assert.equal(mayInvite({...ok,state:S(),platform:'android'}),false,'Android: only when the browser offers its install');
 assert.equal(mayInvite({...ok,state:S(),platform:'android',androidPrompt:true}),true);
 let s=afterShown(S(),ok.now);assert.equal(mayInvite({...ok,state:s,now:ok.now+MIN_GAP_MS-1}),false,'7 days between two');
 s=afterShown(s,ok.now+MIN_GAP_MS);s=afterShown(s,ok.now+2*MIN_GAP_MS);assert.equal(s.shows,MAX_SHOWS);
 assert.equal(mayInvite({...ok,state:s,now:ok.now+10*MIN_GAP_MS}),false,'3 at most per device');
 assert.equal(MAX_SHOWS,3);assert.equal(MIN_GAP_MS,7*24*3600*1000);assert.equal(FIRST_SESSION_QUIET_MS,120000);
 const fresh=readState('garbage',5,()=>'device-0000000000000009');assert.equal(fresh.firstSeenAt,5);assert.equal(fresh.shows,0);
 assert.deepEqual(readState(JSON.stringify(S({shows:2,lastShownAt:9})),99,()=>'x'),S({shows:2,lastShownAt:9}));
 assert.equal(platformOf(IPHONE),'ios');assert.equal(platformOf(ANDROID),'android');assert.equal(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',5),'ios','iPadOS');
 assert.equal(isIosSafari(IPHONE),true);assert.equal(isIosSafari(IPHONE.replace('Version/17.5','CriOS/124.0')),false);
 assert.deepEqual([...urlBase64ToBytes('AQID_-8')],[1,2,3,255,239]);
});

test('invitation wiring — signed-in app only, bottom banner, iPhone steps with the Share icon, Android install button, 3 moments',()=>{
 const layer=read('src/ui/v2/pwa/PwaLayer.tsx');
 assert.match(read('app/page.tsx'),/pwa=\{mode==='live'&&token\?<v2\.PwaLayer api=\{api\} locale=\{locale\}\/>:null\}/,'signed-in app only');
 for(const f of ['src/components/PublicSeoPage.tsx','src/components/LegalPage.tsx','src/ui/v2/public/PublicSite.tsx','src/ui/v2/home/HomeV2.tsx'])assert.doesNotMatch(read(f),/PwaLayer|installMoment/,`never on a public page: ${f}`);
 assert.match(layer,/<aside className="pos-pwa-banner" role="region"/,'a region, not a modal: the page stays usable');
 assert.doesNotMatch(/PWA_CSS=`([^`]*)`/.exec(layer)![1]!,/backdrop|inset:0/,'no backdrop');
 assert.match(layer,/<path d="M12 3v12"\/><path d="M8 7l4-4 4 4"\/>/,'the Share icon, drawn');
 assert.match(layer,/\{kind==='android'&&<Button variant="primary" onClick=\{onInstall\}>\{t\.install\}<\/Button>\}/);
 assert.match(layer,/\{invite&&<InstallBanner kind=\{invite\} locale=\{locale\} onInstall=\{install\} onLater=\{\(\)=>setInvite\(null\)\} onNever=\{never\}\/>\}/);
 assert.match(layer,/const never=async\(\)=>\{setInvite\(null\);event\('invitation_refusee'\);try\{setSettings\(await api\('app\/install\/refuse','POST',\{\}\)\)\}catch\{\}\};/);
 assert.match(layer,/saveState\(afterShown\(state,now\)\);setInvite\(platform\.current==='ios'\?'ios':'android'\);event\('invitation_affichee'\);/,'« Plus tard » closes; the display was counted when shown');
 assert.match(read('src/ui/v2/pwa/SearchMoment.tsx'),/announced\.current=m\.run;installMoment\('search_results'\);/);
 assert.match(read('src/ui/v2/search/SearchNative.tsx'),/<SearchMoment m=\{m\}\/>/);
 assert.match(read('src/components/SignalsPanel.tsx'),/if\(enabling\)installMoment\('monitoring'\)/);
 assert.match(read('src/ui/v2/dedicated/DedicatedViews.tsx'),/if\(next\)installMoment\('delivery_opened'\)/);
 assert.match(layer,/if\(pushSupported\(\)&&settings\.vapid_public_key&&Notification\.permission==='default'\)setOffer\(true\);/,'one offer at the first launch');
 assert.match(read('src/ui/v2/shell/UserMenu.tsx'),/\{live&&<Item icon="signal" label=\{t\.notifications\} onClick=\{act\(\(\)=>window\.dispatchEvent\(new Event\('prospectos:open-notification-settings'\)\)\)\}\/>\}/,'turned off in the settings');
 for(const c of [INSTALL_COPY,PUSH_COPY])assert.deepEqual(Object.keys(c.fr).sort(),Object.keys(c.en).sort(),'FR and EN');
});

test('web push — VAPID keys from the environment; payload {kind,url} only; a gone device is dropped; never throws',async()=>{
 assert.equal(vapidConfig({}),null);
 const env={WEB_PUSH_VAPID_PUBLIC_KEY:'B'+'A'.repeat(86),WEB_PUSH_VAPID_PRIVATE_KEY:'k'.repeat(43)};
 assert.deepEqual(vapidConfig(env),{publicKey:'B'+'A'.repeat(86),privateKey:'k'.repeat(43),subject:'mailto:contact@prospectos.fr'});
 assert.equal(vapidConfig({...env,WEB_PUSH_SUBJECT:'http://x'}),null);
 assert.equal(pushPayload({kind:'DELIVERY',url:'/app#veille'}),'{"kind":"DELIVERY","url":"/app#veille"}');
 const calls:[string,Record<string,unknown>][]=[];const sent:string[]=[];
 const rpc=async(fn:string,a:Record<string,unknown>)=>{calls.push([fn,a]);return fn==='claim_user_push'?[{id:1,kind:'DELIVERY',url:'/app#veille',subscriptions:[{endpoint:'https://a',p256dh:'k',auth:'x'},{endpoint:'https://gone',p256dh:'k',auth:'x'}]}]:true};
 const send=async(sub:{endpoint:string},payload:string)=>{sent.push(payload);if(sub.endpoint==='https://gone')throw Object.assign(Error('Gone'),{statusCode:410});return {statusCode:201}};
 const r=await sendUserPushes({rpc,config:vapidConfig(env),send});
 assert.deepEqual(r,{sent:1,failed:0,gone:1});
 assert.ok(sent.every(p=>p==='{"kind":"DELIVERY","url":"/app#veille"}'),'nothing else travels through the push services');
 assert.deepEqual(calls.slice(1),[['drop_push_subscription',{p_endpoint:'https://gone'}],['finish_user_push',{p_id:1,p_sent:true}]]);
 assert.deepEqual(await sendUserPushes({rpc,config:null,send}),{sent:0,failed:0,gone:0,skipped:'WEB_PUSH_NOT_CONFIGURED'});
 assert.deepEqual(await sendUserPushes({rpc:async()=>{throw Error('x')},config:vapidConfig(env),send}),{sent:0,failed:0,gone:0,skipped:'QUEUE_UNAVAILABLE'});
});

test('API — the account\'s own settings; subscriptions and events validated before the database',async()=>{
 const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
 const args:[string,Record<string,unknown>][]=[];
 const db={rpc:async(fn:string,a:Record<string,unknown>)=>{args.push([fn,a]);return {data:{devices:1},error:null}}} as any;
 const post=(route:string,body:unknown)=>handleApp(new Request('https://x/api/v1/app/'+route,{method:'POST',body:JSON.stringify(body)}),['app',...route.split('/')],db,json,{vapidPublicKey:'PUB'});
 const g=await handleApp(new Request('https://x/api/v1/app/settings'),['app','settings'],db,json,{vapidPublicKey:'PUB'});
 assert.deepEqual(await g!.json(),{devices:1,vapid_public_key:'PUB'});
 assert.equal((await post('push/subscribe',{endpoint:'https://web.push.apple.com/x',keys:{p256dh:'B'+'A'.repeat(86),auth:'a'.repeat(22)},platform:'ios'}))!.status,200);
 assert.equal((await post('push/subscribe',{endpoint:'http://evil/x',keys:{p256dh:'B'+'A'.repeat(86),auth:'a'.repeat(22)},platform:'ios'}))!.status,422);
 assert.equal((await post('events',{kind:'invitation_affichee',device:'device-0000000000000001',platform:'android'}))!.status,200);
 assert.equal((await post('events',{kind:'page_view',device:'device-0000000000000001',platform:'android'}))!.status,422,'only the four measured events');
 assert.equal((await post('push/preferences',{delivery:true,signals:false,trial:true}))!.status,200);
 assert.deepEqual(args.map(a=>a[0]),['app_settings','save_push_subscription','record_app_event','set_push_preferences']);
 assert.match(read('app/api/v1/[...path]/route.ts'),/const appResponse=await handleApp\(request,path,db,json,\{vapidPublicKey:vapidConfig\(process\.env\)\?\.publicKey\?\?null\}\);/);
});

test('sending wired — after a delivery is created, after monitoring, in the daily job; devices removed with the account',()=>{
 const route=read('app/api/v1/[...path]/route.ts');
 assert.match(route,/if\(dedicatedResponse&&request\.method==='POST'&&dedicatedResponse\.ok\)await sendQueuedWebPush\(createAdminClient\(\)\);\n if\(dedicatedResponse\)return dedicatedResponse;/);
 assert.match(route,/if\(leadsResponse&&request\.method==='POST'&&leadsResponse\.ok\)await sendQueuedWebPush\(createAdminClient\(\)\);/);
 assert.ok(route.indexOf("rpc('drop_user_push_subscriptions',{p_user:user.id})")<route.indexOf('await anonymizeAuthUser(user.id)'));
 assert.match(read('app/api/cron/signals/route.ts'),/await sendQueuedWebPush\(admin\);\n  return json\(summary\);/);
 assert.match(read('app/api/cron/cockpit/route.ts'),/const webPush=await sendQueuedWebPush\(admin\);/);
});

test('e-mails — one line in the veille opening e-mail; no other e-mail is added',()=>{
 const m=acceptanceEmails({label:'Veille',organization:'Org',trial_starts_on:'2026-12-01',version:1,sha256:'x',accepted_at:'2026-11-26',userEmail:'a@b.fr'},'https://prospectos.fr');
 assert.ok(m.client.text.includes(EMAIL_INSTALL_LINE));assert.ok(!m.admin.text.includes(EMAIL_INSTALL_LINE),'the administrator\'s copy does not need it');
 assert.match(EMAIL_INSTALL_LINE,/https:\/\/prospectos\.fr\/installer-application$/);
 for(const f of ['src/digest/morning.ts','src/self-outreach/worker.ts','src/demo-share/notify.ts'])assert.doesNotMatch(read(f),/EMAIL_INSTALL_LINE|installer-application/,f);
});
