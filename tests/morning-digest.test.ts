// Morning recap email (migration 040, src/digest): off unless flag + secret + SMTP; a signed one-click unsubscribe that
// nobody can forge; one email only when there is something new, listing signals with their source and never a person's
// data; a failed send is never recorded as sent; the cron, the account route and the Today toggle are wired as designed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {digestEmail,digestSecret,morningDigestAvailable,parisDayStart,unsubscribeToken,unsubscribeUrl,verifyUnsubscribe,MAX_SIGNALS_IN_EMAIL,type DigestSignal} from '../src/digest/morning.ts';
import {runMorningDigest} from '../src/digest/send.ts';
import {MockTransport,smtpTransportFrom,type SendResult} from '../src/self-outreach/transport.ts';

const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const SECRET='s'.repeat(40);
const USER='3f2b6c1e-8a4d-4f7e-9b21-6c0d5e4a7b19';
const SMTP={OUTREACH_SMTP_HOST:'smtp.example',OUTREACH_SMTP_USER:'u',OUTREACH_SMTP_PASSWORD:'p',OUTREACH_FROM_EMAIL:'contact@prospectos.fr'};
const sig=(o:Partial<DigestSignal>={}):DigestSignal=>({project_name:'Agences web',prospect_name:'Boulangerie Durand',signal_type:'acquisition',title:'Vente et cession — BOULANGERIE DURAND',
 excerpt:'Achat d’un fonds de commerce de boulangerie',source_url:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A1',published_at:'2026-10-29T00:00:00.000Z',...o});

test('availability — flag, a 32+ character secret and a complete SMTP configuration, all three',()=>{
 assert.equal(morningDigestAvailable({}),false);
 assert.equal(morningDigestAvailable({MORNING_DIGEST_ENABLED:'true',MORNING_DIGEST_SECRET:SECRET}),false,'no SMTP');
 assert.equal(morningDigestAvailable({MORNING_DIGEST_ENABLED:'true',MORNING_DIGEST_SECRET:'short',...SMTP}),false,'weak secret');
 assert.equal(morningDigestAvailable({MORNING_DIGEST_SECRET:SECRET,...SMTP}),false,'flag off');
 assert.equal(morningDigestAvailable({MORNING_DIGEST_ENABLED:'true',MORNING_DIGEST_SECRET:SECRET,...SMTP}),true);
 assert.equal(digestSecret({MORNING_DIGEST_SECRET:'x'.repeat(31)}),null);
});

test('unsubscribe link — signed per user, verified in constant time, never forgeable or transferable',()=>{
 const t=unsubscribeToken(SECRET,USER);
 assert.match(t,/^[A-Za-z0-9_-]{32}$/);
 assert.equal(verifyUnsubscribe(SECRET,USER,t),USER);
 assert.equal(verifyUnsubscribe(SECRET,USER.toUpperCase(),t),USER,'case of the id does not matter');
 assert.equal(verifyUnsubscribe(SECRET,'00000000-0000-4000-8000-000000000001',t),null,'another user');
 assert.equal(verifyUnsubscribe('t'.repeat(40),USER,t),null,'another secret');
 assert.equal(verifyUnsubscribe(null,USER,t),null,'no secret, no unsubscribe link');
 assert.equal(verifyUnsubscribe(SECRET,'not-a-uuid',t),null);
 assert.equal(verifyUnsubscribe(SECRET,USER,t.slice(0,31)+(t.endsWith('A')?'B':'A')),null);
 assert.equal(unsubscribeUrl('https://prospectos.fr',SECRET,USER),`https://prospectos.fr/api/public/recap/desabonnement?u=${USER}&t=${t}`);
});

test('day boundary — midnight in Paris, winter and summer time',()=>{
 assert.equal(parisDayStart(new Date('2026-11-02T06:41:00Z')).toISOString(),'2026-11-01T23:00:00.000Z');
 assert.equal(parisDayStart(new Date('2026-07-15T05:00:00Z')).toISOString(),'2026-07-14T22:00:00.000Z');
 assert.equal(parisDayStart(new Date('2026-11-01T23:30:00Z')).toISOString(),'2026-11-01T23:00:00.000Z');
});

test('email — only when something is new; each signal with its source; single-line subject; the unsubscribe link',()=>{
 const o={siteUrl:'https://prospectos.fr',unsubscribe:'https://prospectos.fr/api/public/recap/desabonnement?u=x&t=y',contact:'contact@prospectos.fr'};
 assert.equal(digestEmail([],o),null,'nothing new: no email');
 assert.equal(digestEmail([sig({source_url:'javascript:alert(1)'})],o),null,'no usable source: no email');
 const m=digestEmail([sig(),sig({prospect_name:'Garage\r\nBcc: x@evil.example',signal_type:'leadership_change',title:'Nouveau gérant',excerpt:'Nouveau gérant',published_at:null})],o)!;
 assert.equal(m.subject,'ProspectOS · 2 nouveaux signaux sur vos prospects');
 assert.match(m.text,/1\. Boulangerie Durand \(Agences web\) · Rachat ou cession\n   Vente et cession — BOULANGERIE DURAND\n   « Achat d’un fonds de commerce de boulangerie »\n   Source \(publiée le 29 octobre 2026\) : https:\/\/www\.bodacc\.fr\//);
 assert.match(m.text,/2\. Garage Bcc: x@evil\.example \(Agences web\) · Changement de dirigeant\n   Nouveau gérant\n   Source : /,'one line per value, no header injection, no repeated excerpt');
 assert.match(m.text,/rien n’est validé sans vous/);
 assert.match(m.text,/Ne plus le recevoir, en un clic : https:\/\/prospectos\.fr\/api\/public\/recap\/desabonnement\?u=x&t=y/);
 assert.equal(digestEmail([sig()],o)!.subject,'ProspectOS · 1 nouveau signal sur vos prospects');
 const many=digestEmail(Array.from({length:MAX_SIGNALS_IN_EMAIL+3},()=>sig()),o)!;
 assert.match(many.text,/Et 3 autres dans ProspectOS\./);
 assert.equal(m.text.split('\n').at(-1),'ProspectOS · contact@prospectos.fr');
});

// A fake database: the claimed subscribers, the signals per user, every call recorded.
function fakeDb(claimed:Array<{user_id:string;email:string}>,signals:Record<string,DigestSignal[]>){
 const calls:Array<[string,Record<string,unknown>]>=[];
 const rpc=async(name:string,args:Record<string,unknown>)=>{calls.push([name,args]);
  if(name==='claim_morning_digests')return claimed.map(c=>({...c,since:'2026-10-31T06:41:00Z',claimed_at:'2026-11-01T06:41:00Z'}));
  if(name==='morning_digest_signals')return signals[args.p_user as string]??[];
  return true};
 return {rpc,calls};
}
const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b1',C='00000000-0000-4000-8000-0000000000c1';
const deps=(rpc:ReturnType<typeof fakeDb>['rpc'],t:MockTransport)=>({rpc,transport:async()=>t,secret:SECRET,siteUrl:'https://prospectos.fr',contact:'contact@prospectos.fr',messageDomain:'prospectos.fr',now:()=>new Date('2026-11-01T06:41:00Z')});

test('batch — sends to whoever has news, marks the others checked, never marks a failed send as sent',async()=>{
 const db=fakeDb([{user_id:A,email:'a@client.fr'},{user_id:B,email:'b@client.fr'},{user_id:C,email:'c@client.fr'}],{[A]:[sig()],[C]:[sig()]});
 const t=new MockTransport([{kind:'SENT',providerMessageId:'1'},{kind:'RETRY',code:'SMTP_421',retryAfterSeconds:900}]);
 const s=await runMorningDigest(deps(db.rpc,t));
 assert.deepEqual(s,{claimed:3,sent:1,nothing_new:1,failed:1,stopped:null});
 assert.deepEqual(db.calls[0],['claim_morning_digests',{p_limit:50,p_day_start:'2026-10-31T23:00:00.000Z'}]);
 const marks=db.calls.filter(c=>c[0]==='mark_morning_digest').map(c=>[c[1].p_user,c[1].p_sent]);
 assert.deepEqual(marks,[[A,true],[B,false]],'C (failed) is not marked: its signals come back tomorrow');
 assert.equal(t.sent.length,1);assert.equal(t.sent[0]!.to,'a@client.fr');
 assert.equal(t.sent[0]!.unsubscribeUrl,unsubscribeUrl('https://prospectos.fr',SECRET,A));
 assert.match(t.sent[0]!.messageId,/^<recap-[0-9a-f-]{36}@prospectos\.fr>$/);
});

test('batch — an SMTP authorization problem stops at once; nobody claimed means no transport opened',async()=>{
 const db=fakeDb([{user_id:A,email:'a@client.fr'},{user_id:B,email:'b@client.fr'}],{[A]:[sig()],[B]:[sig()]});
 const t=new MockTransport([{kind:'AUTH',code:'SMTP_AUTH'} as SendResult]);
 const s=await runMorningDigest(deps(db.rpc,t));
 assert.equal(s.stopped,'SMTP_AUTH');assert.equal(s.failed,1);assert.equal(s.sent,0);
 let opened=false;const empty=fakeDb([],{});
 const none=await runMorningDigest({...deps(empty.rpc,t),transport:async()=>{opened=true;return t}});
 assert.deepEqual(none,{claimed:0,sent:0,nothing_new:0,failed:0,stopped:null});assert.equal(opened,false);
});

test('transport — the one-click unsubscribe header is added only for a valid https link',async()=>{
 let seen:any;
 const nm={createTransport:()=>({sendMail:async(m:any)=>{seen=m;return {messageId:'x',accepted:['a']}},close:()=>{}})};
 const t=smtpTransportFrom({host:'h',port:465,secure:true,user:'u',password:'p',fromEmail:'contact@prospectos.fr',fromName:'ProspectOS'},nm);
 await t.send({to:'a@b.fr',subject:'s',text:'t',messageId:'<m@x>',unsubscribeUrl:'https://prospectos.fr/api/public/recap/desabonnement?u=1&t=2'});
 assert.equal(seen.headers['List-Unsubscribe'],'<https://prospectos.fr/api/public/recap/desabonnement?u=1&t=2>, <mailto:contact@prospectos.fr?subject=STOP>');
 assert.equal(seen.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
 await t.send({to:'a@b.fr',subject:'s',text:'t',messageId:'<m@x>',unsubscribeUrl:'http://evil>, <x'});
 assert.deepEqual(seen.headers,{'List-Unsubscribe':'<mailto:contact@prospectos.fr?subject=STOP>'});
});

test('wiring — cron guarded and gated, account route, unsubscribe page, Today toggle, privacy policy',()=>{
 const cron=read('app/api/cron/morning-digest/route.ts');
 assert.match(cron,/cronAuthorized\(request\.headers\.get\('authorization'\),process\.env\.CRON_SECRET\)/);
 assert.match(cron,/if\(!morningDigestAvailable\(process\.env\)\|\|!secret\|\|!cfg\)return json\(\{skipped:'MORNING_DIGEST_DISABLED'\}\);/);
 const vercel=JSON.parse(read('vercel.json'));
 assert.deepEqual(vercel.crons.filter((c:any)=>c.path==='/api/cron/morning-digest'),[{path:'/api/cron/morning-digest',schedule:'41 6 * * *'}],'once a day, after the 5:17 monitoring');
 assert.match(read('app/api/v1/[...path]/route.ts'),/handleMorningDigest\(request,path,body,db,json,\{env:process\.env,userId:user\.id\}\)/);
 const api=read('src/digest/api.ts');
 assert.match(api,/if\(parsed\.data\.enabled&&!available\)return json/,'it can only be turned on where it can work; off is always accepted');
 const unsub=read('app/api/public/recap/desabonnement/route.ts');
 assert.match(unsub,/export async function GET[^]*?<form method="post"/,'GET only shows a button: a link scanner never unsubscribes anyone');
 assert.match(unsub,/export async function POST[^]*?admin\.rpc\('unsubscribe_morning_digest',\{p_user:user\}\)/);
 const toggle=read('src/ui/v2/today/MorningDigestToggle.tsx');
 assert.match(toggle,/if\(!state\|\|\(!state\.available&&!state\.enabled\)\)return null;/);
 assert.match(read('src/ui/v2/today/TodayV2.tsx'),/<MorningDigestToggle api=\{api\} locale=\{locale\}\/>/);
 const privacy=read('app/confidentialite/page.tsx');
 assert.match(privacy,/3\.7 Récap du matin \(si vous l’activez\)/);
 assert.match(privacy,/Envoi du récap du matin<\/b> — votre consentement/);
});
