// "3 prospects de votre zone" (src/domain/prospect-request.ts, app/api/public/demande-prospects, app/prospects-de-votre-zone):
// strict validation, no injection, a honeypot, a throttle, and a notification that only ever goes to ProspectOS itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanLine,createThrottle,notificationMail,parseProspectRequest} from '../src/domain/prospect-request.ts';

const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const VALID={activity:'Création de sites web',target:'Restaurants',department:'31',email:'Kevin@Agence-Exemple.fr',message:'',consent:true,website:''};

test('a valid request is cleaned and keeps only what is needed',()=>{
 const r=parseProspectRequest(VALID);
 assert.ok(r.ok);
 assert.deepEqual(r.request,{activity:'Création de sites web',target:'Restaurants',department:{code:'31',name:'Haute-Garonne'},email:'kevin@agence-exemple.fr',personalMailbox:false,message:''});
 const g=parseProspectRequest({...VALID,email:'jean.dupont@gmail.com'});
 assert.ok(g.ok&&g.request.personalMailbox,'a personal mailbox is accepted, and flagged');
 const dom=parseProspectRequest({...VALID,department:'974'});
 assert.ok(dom.ok&&dom.request.department.name==='La Réunion');
});

test('every invalid field is refused with its own reason',()=>{
 const err=(b:unknown)=>{const r=parseProspectRequest(b);return r.ok?'OK':r.error};
 assert.equal(err(null),'INVALID_REQUEST');
 assert.equal(err([]),'INVALID_REQUEST');
 assert.equal(err({...VALID,activity:'  a '}),'ACTIVITY_REQUIRED');
 assert.equal(err({...VALID,department:'99'}),'DEPARTMENT_INVALID','only a department of the closed list');
 assert.equal(err({...VALID,department:31}),'DEPARTMENT_INVALID');
 for(const email of ['kevin','kevin@','a@b','a b@c.fr','"x"@y.fr','x@y.fr,z@w.fr','x@y.fr\nBcc: z@w.fr'])assert.equal(err({...VALID,email}),'EMAIL_INVALID',email);
 assert.equal(err({...VALID,consent:'on'}),'CONSENT_REQUIRED','consent is an explicit true');
 assert.equal(err({...VALID,consent:false}),'CONSENT_REQUIRED');
 assert.equal(err({...VALID,website:'http://spam.example'}),'SPAM','the honeypot');
});

test('no header or log injection: one line, no control character, bounded',()=>{
 assert.equal(cleanLine('Sites web\r\nBcc: x@y.fr suite',200),'Sites web Bcc: x@y.fr suite');
 assert.equal(cleanLine('x'.repeat(500),160).length,160);
 assert.equal(cleanLine(42,10),'');
 const r=parseProspectRequest({...VALID,activity:'Sites\r\nSubject: piraté',message:'Ligne 1\r\n\r\n\r\n\r\nLigne 2\u0007'});
 assert.ok(r.ok);
 const m=notificationMail(r.request,new Date('2026-11-01T10:00:00Z'));
 assert.doesNotMatch(m.subject,/[\r\n]/);
 assert.equal(m.subject,'[ProspectOS] 3 prospects demandés : Sites Subject: piraté · Haute-Garonne (31)');
 assert.match(m.text,/Message :\nLigne 1\n\nLigne 2/);
 assert.match(m.text,/Email : kevin@agence-exemple\.fr\n/);
 assert.match(m.text,/n’est enregistrée nulle part ailleurs que dans cet email/);
});

test('throttle — a burst from one address is slowed, others are not',()=>{
 const allow=createThrottle({max:2,windowMs:1000});
 assert.equal(allow('1.1.1.1',0),true);
 assert.equal(allow('1.1.1.1',10),true);
 assert.equal(allow('1.1.1.1',20),false);
 assert.equal(allow('2.2.2.2',20),true);
 assert.equal(allow('1.1.1.1',1500),true,'the window slides');
});

test('route — same origin, bounded body, the notification goes to ProspectOS only, never to the requester, nothing stored',()=>{
 const route=read('app/api/public/demande-prospects/route.ts');
 assert.match(route,/new URL\(origin\)\.host!==host\)return json\(403/,'same-origin form posts only');
 assert.match(route,/if\(raw\.length>4000\)return json\(413/);
 assert.match(route,/parsed\.error==='SPAM'\?json\(200,\{ok:true\}\)/,'a robot is answered like a success and never emailed');
 assert.match(route,/transport\.send\(\{to:CONTACT_EMAIL,/,'the recipient is a constant');
 assert.equal((route.match(/\.send\(/g)??[]).length,1,'one email per request');
 assert.doesNotMatch(route,/to:parsed|to:request|request\.email|createClient|supabase|insert\(/i,'never sent to the requester, never stored');
 assert.doesNotMatch(route,/createSmtpTransport/,'the prospecting transport (behind its two flags) is not used here');
});

test('page — the form, the consent text and the honest promise',()=>{
 const page=read('app/prospects-de-votre-zone/page.tsx');
 assert.match(page,/<PublicSeoPage page=\{page\}><ProspectRequestForm\/><\/PublicSeoPage>/);
 assert.match(page,/Je préfère vous en donner 3 sourcées que 50 approximatives/);
 assert.doesNotMatch(page,/leads? (chauds|qualifiés)|hot leads|garanti/i,'no promise that cannot be proven');
 const form=read('src/components/ProspectRequestForm.tsx');
 assert.match(form,/serve uniquement à recevoir ces 3 prospects et à être recontacté à ce sujet\. Pas de newsletter, pas de revente/);
 assert.match(form,/<input name="website" tabIndex=\{-1\}/,'the honeypot is out of the tab order');
 assert.match(form,/aria-hidden="true"/);
 assert.match(read('src/ui/v2/public/PublicSite.tsx'),/<li><Link href="\/prospects-de-votre-zone">3 prospects de votre zone<\/Link><\/li>/,'linked from every public page');
 assert.match(read('src/components/CompanyCreations.tsx'),/href:'\/prospects-de-votre-zone',label:'Recevoir mes 3 prospects'/,'the barometer pages lead to it');
});
