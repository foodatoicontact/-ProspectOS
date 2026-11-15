// Veille dédiée, suivi au résultat (migration 043, src/dedicated): the pure logic (amount, 15-day window, deadlines,
// counters, alerts, exports, pasted delivery), the routes behind their flag, the monthly job and its wiring. The
// database rules themselves are proved on PostgreSQL by tests/dedicated-tracking-db.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {statementAmount,knownClientOpen,knownClientDeadline,statementDeadline,previousMonth,counters,alerts,exportCsv,parseDelivery,parisDate,ATTESTATION,
 type AdminContract,type AdminItem,type ExportRow} from '../src/dedicated/model.ts';
import {exportPdf} from '../src/dedicated/pdf.ts';
import {handleDedicated,byteaToBytes} from '../src/dedicated/api.ts';
import {dedicatedTrackingEnabled,dedicatedNotifyEmail} from '../src/dedicated/flag.ts';
import {runDedicatedStatements,reminderEmail,acceptanceEmails} from '../src/dedicated/notify.ts';
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const json=(value:unknown,status=200)=>Response.json(value,{status});

test('statement: max(99 €, 179 € × signatures) with 0, 1 and 3 signatures',()=>{
 assert.equal(statementAmount(0,9900,17900),9900);
 assert.equal(statementAmount(1,9900,17900),17900);
 assert.equal(statementAmount(3,9900,17900),53700);
 assert.throws(()=>statementAmount(-1,9900,17900));assert.throws(()=>statementAmount(1.5,9900,17900));
});
test('« déjà client »: open through day 15 after the delivery, closed on day 16 (the database rule)',()=>{
 assert.equal(knownClientOpen('2026-11-16','2026-11-16',15),true);
 assert.equal(knownClientOpen('2026-11-16','2026-12-01',15),true);
 assert.equal(knownClientOpen('2026-11-16','2026-12-02',15),false);
 assert.equal(knownClientDeadline('2026-11-16',15),'2026-12-01');
});
test('statement month and deadline: generated on the 1st for the previous month (Paris), to validate before the 5th',()=>{
 assert.equal(previousMonth(new Date('2026-12-01T05:30:00Z')),'2026-11-01');
 assert.equal(previousMonth(new Date('2026-11-30T23:30:00Z')),'2026-11-01','00:30 on Dec 1st in Paris: the previous month is November');
 assert.equal(previousMonth(new Date('2027-01-01T06:00:00Z')),'2026-12-01');
 assert.equal(statementDeadline('2026-12-01'),'2027-01-04');
 assert.equal(parisDate(new Date('2026-11-30T23:30:00Z')),'2026-12-01');
 assert.equal(ATTESTATION,'J\'atteste l\'exactitude de ce relevé');
});

const NOW=new Date('2027-03-10T09:00:00Z');
const ago=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
const it=(o:Partial<AdminItem>&{reference:string}):AdminItem=>({id:o.reference,name:'X',status:'A_CONTACTER',delivered_on:'2026-12-01',status_changed_at:null,signed_at:null,opened:false,first_export_at:null,reached:{},...o});
const contract=(items:AdminItem[],statements:AdminContract['statements']=[]):AdminContract=>({contract:{id:'c',label:'Veille IDF',organization:'EXEMPLE',minimum_ht_cents:9900,commission_ht_cents:17900,known_client_days:15,first_statement_month:'2026-12-01'},deliveries:1,items,statements});
test('admin counters: delivered, opened, exported, contacted, quotes, signed, lost',()=>{
 const c=counters([it({reference:'a',opened:true,first_export_at:ago(5)}),it({reference:'b',status:'CONTACTE',reached:{CONTACTE:ago(3)}}),
  it({reference:'c',status:'PERDU',reached:{CONTACTE:ago(9),DEVIS_ENVOYE:ago(8),PERDU:ago(1)}}),it({reference:'d',status:'SIGNE',reached:{DEVIS_ENVOYE:ago(9),SIGNE:ago(2)}}),
  it({reference:'e',status:'DEJA_CLIENT'})]);
 assert.deepEqual(c,{delivered:5,opened:1,exported:1,contacted:3,quoted:2,signed:1,lost:1,known:1});
});
test('admin alerts: quote > 60 days, export idle 30 days, signatures/quotes < 10 % over 3 months, statement not validated',()=>{
 const a=alerts(contract([
  it({reference:'L1-F001',status:'DEVIS_ENVOYE',status_changed_at:ago(61),reached:{DEVIS_ENVOYE:ago(61)}}),
  it({reference:'L1-F002',status:'DEVIS_ENVOYE',status_changed_at:ago(59),reached:{DEVIS_ENVOYE:ago(59)}}),
  it({reference:'L1-F003',first_export_at:ago(31)}),
  it({reference:'L1-F004',first_export_at:ago(40),status:'CONTACTE',status_changed_at:ago(10)}),
  it({reference:'L1-F005',first_export_at:ago(40),status:'PERDU',status_changed_at:ago(35)}),
 ],[{id:'s',month:'2027-02-01',signed_count:0,amount_ht_cents:9900,validated_at:null,reminder_sent_at:null}]),NOW);
 assert.deepEqual(a.find(x=>x.kind==='QUOTE_STALE')?.items,['L1-F001']);
 assert.deepEqual(a.find(x=>x.kind==='EXPORT_IDLE')?.items,['L1-F003'],'a recent change or a closed status is not idle');
 assert.match(a.find(x=>x.kind==='LOW_CONVERSION')!.text,/0 % sur 3 mois \(0 \/ 2\)/);
 assert.match(a.find(x=>x.kind==='STATEMENT_UNVALIDATED')!.text,/février 2027/);
 const fine=alerts(contract([it({reference:'a',reached:{DEVIS_ENVOYE:ago(20)}}),it({reference:'b',status:'SIGNE',reached:{DEVIS_ENVOYE:ago(30),SIGNE:ago(5)}})],
  [{id:'s',month:'2027-02-01',signed_count:1,amount_ht_cents:17900,validated_at:ago(8),reminder_sent_at:null}]),NOW);
 assert.deepEqual(fine,[],'1 signature for 2 quotes, a validated statement: no alert');
 assert.deepEqual(alerts(contract([it({reference:'a'})],[{id:'s',month:'2027-02-01',signed_count:0,amount_ht_cents:9900,validated_at:null,reminder_sent_at:null}]),new Date('2027-03-04T10:00:00Z')),[],'not late before the 5th');
});

const ROWS:ExportRow[]=[{id:'i1',delivery_number:3,reference:'L3-F001',siren:'123456789',name:'=HYPERLINK("x")',city:'Meaux',source_label:'BODACC',source_url:'https://www.bodacc.fr/a',delivered_on:'2026-11-16',status:'A_CONTACTER'},
 {id:'i2',delivery_number:3,reference:'L3-F002',siren:'987654321',name:'SARL L’ÉTÉ; « Feu »',city:null,source_label:'BODACC',source_url:'https://www.bodacc.fr/b',delivered_on:'2026-11-16',status:'SIGNE'}];
test('CSV export: every line carries the delivery number and the item identifier; formulas are neutralized',()=>{
 const csv=exportCsv(ROWS);const lines=csv.replace('﻿','').trim().split('\r\n');
 assert.equal(lines[0],'N° livraison;N° fiche;Identifiant fiche;Entreprise;Département;Ville;Précisions;Source;Date;Le fait;Pourquoi maintenant;Votre accroche;Lien de la source;SIREN;Date de livraison;Statut');
 assert.ok(lines[1].startsWith('3;1;L3-F001;"\'=HYPERLINK(""x"")";;Meaux;;BODACC;;;;;https://www.bodacc.fr/a;123456789;2026-11-16;À contacter'),lines[1]);
 assert.ok(lines[2].startsWith('3;2;L3-F002;"SARL L’ÉTÉ; « Feu »";'));
});
test('PDF export: a valid PDF whose text carries the delivery number and the item identifier',()=>{
 const bytes=exportPdf({title:'Veille dédiée — Test',subtitle:'Livraison n° 3',rows:ROWS,generatedAt:new Date('2026-11-16T10:00:00Z')});
 const s=Buffer.from(bytes).toString('latin1');
 assert.ok(s.startsWith('%PDF-1.4'));assert.ok(s.trimEnd().endsWith('%%EOF'));
 assert.match(s,/\(Liv\. 3 \\267 L3-F001\) Tj/);assert.match(s,/SIREN 123456789/);
 // The xref offsets point at the objects.
 const xref=Number(/startxref\n(\d+)/.exec(s)![1]);assert.equal(s.slice(xref,xref+4),'xref');
 const first=Number(/0000000000 65535 f \n(\d{10})/.exec(s)![1]);assert.equal(s.slice(first,first+7),'1 0 obj');
 assert.doesNotMatch(s,/\/JavaScript|\/OpenAction|\/URI/);
});
test('pasted delivery: SIREN;Entreprise;Ville;Source;Lien — header skipped, https only, errors named',()=>{
 const r=parseDelivery('SIREN;Entreprise;Ville;Source;Lien\n123 456 789;ACME;Meaux;BODACC — création;https://www.bodacc.fr/x\n12345;BAD;;BODACC;https://x.fr\n987654321;NOLINK;;BODACC;http://x.fr\n111111111\tTAB SARL\t\tRNE\thttps://annuaire-entreprises.data.gouv.fr/entreprise/111111111');
 assert.deepEqual(r.items.map(i=>i.siren),['123456789','111111111']);assert.equal(r.items[0].city,'Meaux');assert.equal(r.items[1].city,null);
 assert.deepEqual(r.errors,['Ligne 3 : SIREN invalide','Ligne 4 : lien de source https requis']);
});

test('routes: off by default (404); on, refusals map to clear French messages; nothing for another path',async()=>{
 assert.equal(dedicatedTrackingEnabled({}),false);assert.equal(dedicatedTrackingEnabled({DEDICATED_TRACKING_ENABLED:'true'}),true);
 const db={rpc:async(fn:string)=>({data:null,error:{message:fn==='set_dedicated_item_status'?'known_window_closed':'Admin access required',code:'P0001'}}),from:()=>{throw Error('no direct read here')}} as never;
 const req=(m:string,u:string,b?:unknown)=>new Request(`https://prospectos.fr/api/v1/${u}`,{method:m,...(b?{body:JSON.stringify(b)}:{})});
 assert.equal(await handleDedicated(req('GET','prospects'),['prospects'],db,json,{enabled:true,now:()=>NOW}),null);
 assert.equal((await handleDedicated(req('GET','dedicated'),['dedicated'],db,json,{enabled:false,now:()=>NOW}))!.status,404);
 const id='00000000-0000-4000-8000-000000000001';
 const r=await handleDedicated(req('POST',`dedicated/items/${id}/status`,{status:'DEJA_CLIENT',proof:{kind:'facture',dated_on:'2026-01-02',reference:'F-12'}}),['dedicated','items',id,'status'],db,json,{enabled:true,now:()=>NOW});
 assert.equal(r!.status,409);assert.equal((await r!.json()).code,'KNOWN_WINDOW_CLOSED');
 const bad=await handleDedicated(req('POST',`dedicated/items/${id}/status`,{status:'GAGNE'}),['dedicated','items',id,'status'],db,json,{enabled:true,now:()=>NOW});
 assert.equal(bad!.status,400);
 const admin=await handleDedicated(req('GET','dedicated/admin'),['dedicated','admin'],db,json,{enabled:true,now:()=>NOW});
 assert.equal(admin!.status,403);
});

test('monthly job: generates, then reminds once; a failed send is released for the next run',async()=>{
 const calls:string[]=[];const due=[{id:'s1',month:'2026-12-01',signed_count:2,amount_ht_cents:35800,contract:'Veille IDF',organization:'EXEMPLE SÉCURITÉ'},{id:'s2',month:'2026-12-01',signed_count:0,amount_ht_cents:9900,contract:'B',organization:'Autre'}];
 const rpc=async(n:string,a:Record<string,unknown>)=>{calls.push(`${n}:${JSON.stringify(a)}`);return n==='generate_dedicated_statements'?{generated:2}:n==='claim_dedicated_reminders'?due:true};
 let n=0;const sentTo:string[]=[];
 const transport=async()=>({send:async(m:{to:string})=>{sentTo.push(m.to);return n++===0?{kind:'SENT' as const,messageId:'x'}:{kind:'FAILED' as const,reason:'x'}},close:async()=>{}}) as never;
 const r=await runDedicatedStatements({rpc,month:'2026-12-01',notifyTo:'contact@prospectos.fr',siteUrl:'https://prospectos.fr',messageDomain:'prospectos.fr',transport,id:()=>'1'});
 assert.deepEqual(r,{month:'2026-12-01',generated:2,reminders:2,sent:1,failed:1});
 assert.deepEqual(sentTo,['contact@prospectos.fr','contact@prospectos.fr']);
 assert.ok(calls.includes('release_dedicated_reminder:{"p_statement_id":"s2"}'));assert.ok(!calls.some(c=>c.includes('"s1"')&&c.startsWith('release')));
 const noSmtp=await runDedicatedStatements({rpc,month:'2026-12-01',notifyTo:'x@y.fr',siteUrl:'https://prospectos.fr',messageDomain:null,transport:null,id:()=>'1'});
 assert.equal(noSmtp.failed,2,'without SMTP every reminder is released, none is lost');
 const mail=reminderEmail(due[0],'https://prospectos.fr');
 assert.equal(mail.subject,'Relevé décembre 2026 non validé — EXEMPLE SÉCURITÉ');assert.match(mail.text,/358,00\s€/);
 assert.equal(dedicatedNotifyEmail({},'contact@prospectos.fr'),'contact@prospectos.fr');
 assert.equal(dedicatedNotifyEmail({DEDICATED_NOTIFY_EMAIL:'admin@exemple.fr'},'contact@prospectos.fr'),'admin@exemple.fr');
});

test('wiring: the route module, the account flag, one daily cron behind the flag; no client data in the repository',()=>{
 const route=read('app/api/v1/[...path]/route.ts');
 assert.match(route,/handleDedicated\(request,path,db,json,\{enabled:dedicatedTrackingEnabled\(process\.env\),now:\(\)=>new Date\(\),userEmail:user\.email\?\?null,/);
 // Before the general 20 kB body parsing (a delivery or a proposal PDF is larger), and with no entitlement check.
 assert.ok(route.indexOf('const dedicatedResponse=await handleDedicated(')<route.indexOf(" let body:Record<string,any>={};"));
 const block=route.slice(route.indexOf('const dedicatedResponse='),route.indexOf('if(dedicatedResponse)return dedicatedResponse;'));
 assert.doesNotMatch(block,/requireActiveEntitlement|requireEntitlement|billing|stripe/i,'the veille is independent of the subscription');
 assert.match(route,/dedicated_tracking:await dedicatedTrackingFor\(db\)/);
 const vercel=JSON.parse(read('vercel.json'));
 assert.equal(vercel.crons.filter((c:{path:string})=>c.path==='/api/cron/dedicated-statements').length,1);
 const cron=read('app/api/cron/dedicated-statements/route.ts');
 assert.match(cron,/if\(!dedicatedTrackingEnabled\(process\.env\)\)return json\(\{skipped:'DEDICATED_TRACKING_DISABLED'\}\)/);
 assert.match(cron,/cronAuthorized\(request\.headers\.get\('authorization'\),process\.env\.CRON_SECRET\)/);
 for(const f of ['src/dedicated/model.ts','src/dedicated/api.ts','src/dedicated/pdf.ts','src/dedicated/notify.ts','db/migrations/043_dedicated_tracking.sql','tests/dedicated-tracking-db.mjs','tests/dedicated-tracking.test.ts'])
  // The pattern is assembled so that this file does not match itself.
  assert.doesNotMatch(read(f),new RegExp(['DE'+'TEC','Gal'+'lone','989 ?875 ?'+'547','Annet-sur-'+'Marne'].join('|'),'i'),`${f}: no client data`);
});

test('screens: v2 only, behind the account flag; the client entry needs a contract, the admin entry the INTERNAL plan',async()=>{
 const page=read('app/page.tsx');
 assert.ok(page.includes("dedicated:mode==='live'&&dedicatedAccess.client?"));
 assert.ok(page.includes("dedicatedAdmin:mode==='live'&&dedicatedAccess.enabled&&entitlementPlan==='INTERNAL'?"));
 assert.ok(page.includes(":view==='dedicated-admin'&&mode==='live'&&dedicatedAccess.enabled&&entitlementPlan==='INTERNAL'?<v2.DedicatedAdmin api={api}/>"));
 const legacy=page.slice(page.indexOf(' return <div className="shell">'));
 assert.doesNotMatch(legacy,/Dedicated|dedicated/,'nothing in the legacy shell');
 const {withoutSelfOutreach}=await import('./self-outreach-strip.ts');
 assert.doesNotMatch(withoutSelfOutreach(page),/dedicated/i,'every fragment is known to the strip used by the byte-identical pins');
 const menu=read('src/ui/v2/shell/UserMenu.tsx');
 assert.match(menu,/\{live&&p\.dedicated&&<Item icon="signal" label=\{t\.dedicated\}/);assert.match(menu,/\{live&&p\.dedicatedAdmin&&<Item icon="activity" label=\{t\.dedicatedAdmin\}/);
 assert.match(read('src/ui/v2/shell/AppShell.tsx'),/export \{DedicatedClient,DedicatedAdmin\} from '\.\.\/dedicated\/Dedicated\.tsx';/);
 const views=read('src/ui/v2/dedicated/DedicatedViews.tsx');
 assert.match(read('src/ui/v2/dedicated/DeliveryView.tsx'),/disabled=\{s==='DEJA_CLIENT'&&!knownOpen&&it\.status!=='DEJA_CLIENT'\}/,'« déjà client » greyed out after the window');
 assert.match(views,/disabled=\{!checked\|\|busy\}/,'validation needs the attestation box');
 assert.match(read('app/ui-v2/veille-dediee/page.tsx'),/DedicatedBench/);
 assert.match(read('src/ui/v2/dedicated/DedicatedBench.tsx'),/FICTITIOUS data/);
});

test('client space: only the caller’s own organizations, even for the administrator who reads every contract',async()=>{
 const seen:string[]=[];
 const chain=(t:string)=>{const q:any={select:()=>q,in:(c:string,v:string[])=>{seen.push(`${t}:${c}=${v.join(',')}`);return q},order:()=>q,limit:async()=>({data:[],error:null}),
  then:(r:(v:unknown)=>void)=>r({data:t==='memberships'?[{organization_id:'org-own'}]:[],error:null})};return q};
 const db={from:chain,rpc:async()=>({data:null,error:null})} as never;
 const r=await handleDedicated(new Request('https://prospectos.fr/api/v1/dedicated'),['dedicated'],db,json,{enabled:true,now:()=>NOW});
 assert.equal(r!.status,200);
 assert.deepEqual(seen.sort(),['dedicated_contracts:organization_id=org-own','dedicated_deliveries:organization_id=org-own','dedicated_items:organization_id=org-own','dedicated_proposals:organization_id=org-own','dedicated_statements:organization_id=org-own']);
 assert.match(read('app/api/v1/[...path]/route.ts'),/select\('id',\{count:'exact',head:true\}\)\.in\('organization_id',orgs\)/);
});

test('proposal: acceptance with the shown fingerprint, then the two e-mails; uploads up to 4 MB for the administrator only',async()=>{
 const id='00000000-0000-4000-8000-000000000009',SHA='a'.repeat(64);const calls:unknown[]=[];const sent:unknown[]=[];
 const db={rpc:async(fn:string,args:Record<string,unknown>)=>{calls.push([fn,args]);return fn==='accept_dedicated_proposal'?{data:{label:'Veille IDF',organization:'Exemple',trial_starts_on:'2026-11-16',version:2,sha256:SHA,accepted_at:'2026-11-15T10:00:00Z'},error:null}:{data:null,error:{message:'dedicated_proposal_changed',code:'P0001'}}}} as never;
 const deps={enabled:true,now:()=>NOW,userEmail:'client@exemple.fr',notifyAccepted:async(a:unknown)=>{sent.push(a)}};
 const post=(path:string[],body:unknown)=>handleDedicated(new Request(`https://prospectos.fr/api/v1/${path.join('/')}`,{method:'POST',body:JSON.stringify(body)}),path,db,json,deps);
 assert.equal((await post(['dedicated','proposals',id,'accept'],{sha256:'nope'}))!.status,400,'a fingerprint is required');
 const ok=await post(['dedicated','proposals',id,'accept'],{sha256:SHA});assert.equal(ok!.status,200);
 assert.deepEqual(calls.at(-1),['accept_dedicated_proposal',{p_contract_id:id,p_sha256:SHA}]);
 assert.equal((sent[0] as {userEmail:string;sha256:string}).userEmail,'client@exemple.fr');assert.equal((sent[0] as {sha256:string}).sha256,SHA);
 // A body over 20 kB is refused outside the administrator's uploads; an upload may reach 4 MB.
 const big={status:'CONTACTE',pad:'x'.repeat(25000)};
 assert.equal((await post(['dedicated','items',id,'status'],big))!.status,413);
 const upload=await post(['dedicated','admin','proposals'],{organization_id:id,label:'X',minimum_eur:99,commission_eur:179,trial_starts_on:'2026-11-16',first_statement_month:'2026-12-01',file_name:'p.pdf',pdf_base64:'J'.repeat(100000)});
 assert.notEqual(upload!.status,413);
 assert.deepEqual([...byteaToBytes('\\x255044462d')],[0x25,0x50,0x44,0x46,0x2d]);
 const m=acceptanceEmails({label:'Veille IDF',organization:'Exemple',trial_starts_on:'2026-11-16',version:2,sha256:SHA,accepted_at:'2026-11-15T10:00:00Z',userEmail:'client@exemple.fr'},'https://prospectos.fr');
 assert.equal(m.client.subject,'Votre espace de veille est ouvert');assert.match(m.client.text,/https:\/\/prospectos\.fr/);assert.match(m.client.text,/16 novembre 2026/);
 assert.match(m.admin.text,new RegExp(SHA));assert.match(m.admin.subject,/Proposition acceptée — Exemple/);
});

test('proposal screens: « J’accepte la proposition » before the space; termination keeps 6 months of access; attach by organization',()=>{
 const views=read('src/ui/v2/dedicated/DedicatedViews.tsx');
 assert.match(views,/if\(c\.status==='PROPOSED'\)return <ProposalCard /);
 assert.match(views,/onClick=\{\(\)=>onAccept\(c\.id,prop\.sha256\)\}>J’accepte la proposition<\/button>/);
 assert.match(views,/Proposer une veille/);assert.match(views,/Aucun compte n’est créé/);
 assert.doesNotMatch(views,/client_email/,'no attachment by e-mail address');
 assert.match(read('src/dedicated/api.ts'),/p_organization_id:p\.data\.organization_id/);
});
