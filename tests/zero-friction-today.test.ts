// Zero-Friction ZF1 — "Aujourd'hui" (docs/ZERO_FRICTION.md). The flag, the destination, the automatic recomputation
// policy, the card model built from REAL engine output (src/nba/engine.ts unchanged), progressive disclosure, the
// measurement session and the copy. Fictitious companies, .example domains; no network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execSync} from 'node:child_process';
import {zeroFrictionTodayEnabled,shouldRecompute,changesNbaInputs,TODAY_RECOMPUTE_TTL_MS} from '../src/ux/zero-friction.ts';
import {buildTodayModel,cardOf,primaryActionOf,type TodayRow} from '../src/nba/today.ts';
import {buildOpportunity,type NbaSignal} from '../src/nba/engine.ts';
import {handleNextBestActions,dropClosedUnchanged} from '../src/nba/api.ts';
import {ZfSession} from '../src/ux/zf-session.ts';
import {zfPayload,ZF_KINDS} from '../src/server/ux-events.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';
import {getSeoPage} from '../src/domain/seo.ts';

const read=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
const NOW=new Date('2026-10-17T12:00:00Z');const daysAgo=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
// A stored row exactly as save_nba_actions stores it, from a real engine opportunity.
const ICP=[{key:'target_fit',label:'Restauration en Occitanie',weight:35,rules:{type:'target_fit' as const,config:{locations:['Occitanie'],match:'any_defined' as const}}},
 {key:'local_decision',label:'Décision d’achat locale',weight:25},{key:'need_fit',label:'Besoin d’un canal direct',weight:25},{key:'contactability',label:'Canal de contact documenté',weight:15}];
const TOULOUSE={text:'Toulouse',departments:['31'],regions:['Occitanie'],basis:'EVENT_MENTION'};
let n=0;
const sig=(o:Partial<NbaSignal>={}):NbaSignal=>({id:`s${++n}`,signal_type:'new_site',status:'VERIFIED',title:'Kantina ouvre un restaurant',excerpt:'Kantina vient d’ouvrir un restaurant place du Capitole.',
 source_url:`https://presse.example/k-${n}`,source_domain:'presse.example',source_type:'search_snippet',confidence:0.6,event_date:null,published_at:daysAgo(6),observed_at:daysAgo(6),matched_terms:[],
 provider:'discovery_recycled',raw_metadata:{origin:'signal_discovery',location:TOULOUSE},...o});
const ev=(criterion:string,value=true)=>({id:`e${++n}`,criterion,value,status:'VERIFIED',source_url:'https://presse.example/a',excerpt:'Restaurant à Toulouse.',observed_at:daysAgo(3),verified_by:'u'});
const rowOf=(name:string,o:{evidence?:any[];signals?:NbaSignal[];sdr?:boolean}):TodayRow=>{
 const op=buildOpportunity({prospect:{id:`p-${name}`,project_id:'proj',name,status:'À analyser'},criteria:ICP,evidence:o.evidence??[],signals:o.signals??[],publicContent:[],profile:null,now:NOW});
 const p=op.primary;
 return {id:`a-${name}`,prospect_id:op.prospect_id,recommended_action:op.recommended_action,rule:op.rule,state:'PENDING',opportunity_score:op.scores.opportunity.score,fit_score:op.scores.fit.score,
  fit_basis:op.scores.fit.basis,intent_score:op.scores.intent.score,timing_score:op.scores.timing.score,freshness_score:op.scores.freshness.score,evidence_quality_score:op.scores.evidence_quality.score,
  primary_kind:p?.kind??null,primary_signal_type:p?.kind==='signal'?p.commercial_type:null,primary_evidence_status:p?.kind==='signal'?p.evidence_status:null,signal_age_days:p?.age_days??null,
  primary_detail:p as any,scores:op.scores as any,target:op.target,explanation:op.explanation,prospects:{name}};
};
const MOJO=rowOf('Mojo',{evidence:[ev('target_fit')],signals:[sig()]});                      // INCOMPLETE FIT + verified fresh signal → WATCH
const PENDING_SIG=rowOf('Popote',{signals:[sig({status:'PENDING_REVIEW'})]});                 // unknown FIT + signal to verify → WATCH
const STRONG=rowOf('Acme',{evidence:[ev('target_fit'),ev('local_decision'),ev('need_fit')],signals:[sig({signal_type:'hiring_role',title:'Kantina recrute un SDR',excerpt:'Kantina recrute un SDR pour son pipeline.',source_type:'job_board',confidence:0.8,published_at:daysAgo(2)})]});
const NOTHING=rowOf('Vide',{});                                                                // DISMISS
const LOW=rowOf('Loin',{evidence:[ev('target_fit',false),ev('local_decision',false)],signals:[sig()]});

// ------------------------------------------------------------ 1–2 flag and destination
test('1 — flag OFF: everything as before (no Today, NBA routes only with their own flag)',async()=>{
 assert.equal(zeroFrictionTodayEnabled({}),false);assert.equal(zeroFrictionTodayEnabled({ZERO_FRICTION_TODAY_ENABLED:'false'}),false);
 assert.equal(zeroFrictionTodayEnabled({ZERO_FRICTION_TODAY_ENABLED:'true'}),true);
 const page=await read('app/page.tsx');
 assert.match(page,/\.\.\.\(mode==='live'&&zfOn\?\[\['today','☀',tr\('nav\.today'\)\]\]:\[\]\)/,'Today in the nav only with the flag');
 assert.match(page,/\{view==='today'&&mode==='live'&&zfOn&&project&&<TodayPanel/);
 assert.match(page,/const \[view,setView\]=useState\('prospects'\)/,'the historical default view is unchanged');
 const route=await read('app/api/v1/[...path]/route.ts');
 assert.match(route,/enabled:nextBestActionEnabled\(process\.env\)\|\|zeroFrictionTodayEnabled\(process\.env\)/);
 const off=await handleNextBestActions(new Request('http://x',{method:'POST'}),['projects','00000000-0000-4000-8000-000000000001','next-best-actions','ensure-fresh'],{reason:'open'},{} as any,
  (v,s=200)=>new Response(JSON.stringify(v),{status:s}),{enabled:false,now:()=>NOW,requireEntitlement:async()=>{}});
 assert.equal(off!.status,404);
});
test('2 — flag ON + a project with prospects: Today becomes the destination, once; every other view stays reachable',async()=>{
 const page=await read('app/page.tsx');
 assert.match(page,/if\(mode==='live'&&zfOn&&project&&prospects\.length>0&&!zfLanded\.current&&view==='prospects'&&!selected&&!showQuickStart\)\{zfLanded\.current=true;setView\('today'\)\}/);
 for(const v of ["'prospects'","'dashboard'","'icp'","'actions'"])assert.ok(page.includes(`[${v}`)||page.includes(`view===${v}`),v);
 const nav=await read('src/discovery/back-navigation.ts');assert.match(nav,/'actions', 'today'\] as const/);
});

// ------------------------------------------------------------ 3 automatic recomputation
test('3 — no manual "Recalculer" on the happy path: recompute on open only when stale, once after a data change',async()=>{
 assert.equal(shouldRecompute('open',null,NOW),true,'never computed');
 assert.equal(shouldRecompute('open',new Date(NOW.getTime()-60000).toISOString(),NOW),false,'fresh: read only');
 assert.equal(shouldRecompute('open',new Date(NOW.getTime()-TODAY_RECOMPUTE_TTL_MS).toISOString(),NOW),true,'older than the TTL');
 assert.equal(shouldRecompute('data_changed',new Date(NOW.getTime()-1000).toISOString(),NOW),true);
 assert.equal(changesNbaInputs('POST','signals/abc/review'),true);assert.equal(changesNbaInputs('POST','evidence'),true);
 assert.equal(changesNbaInputs('GET','prospects?project_id=x'),false);
 assert.equal(changesNbaInputs('POST','projects/p/next-best-actions/ensure-fresh'),false,'a recomputation never marks itself dirty (no loop)');
 assert.equal(changesNbaInputs('POST','zf-events'),false);
 const panel=await read('src/components/TodayPanel.tsx');
 assert.doesNotMatch(panel,/next-best-actions\/compute/,'Today never calls the manual compute');
 assert.match(panel,/next-best-actions\/ensure-fresh/);assert.doesNotMatch(panel,/setInterval|setTimeout/,'no polling');
 // Fresh → the server reads only (no compute, no write).
 const calls:string[]=[];
 const db:any={from:(t:string)=>({select:()=>({eq:()=>({order:()=>({limit:async()=>{calls.push(`read:${t}`);return {data:[{computed_at:new Date(NOW.getTime()-60000).toISOString()}],error:null}}})})})}),rpc:async(f:string)=>{calls.push(`rpc:${f}`);return {data:null,error:null}}};
 const r=await handleNextBestActions(new Request('http://x',{method:'POST'}),['projects','00000000-0000-4000-8000-000000000001','next-best-actions','ensure-fresh'],{reason:'open'},db,
  (v,s=200)=>new Response(JSON.stringify(v),{status:s}),{enabled:true,now:()=>NOW,requireEntitlement:async()=>{}});
 assert.deepEqual(await r!.json(),{recomputed:false,reason:'FRESH',computed_at:new Date(NOW.getTime()-60000).toISOString()});
 assert.deepEqual(calls,['read:nba_actions'],'no save_nba_actions, no refresh');
});
test('3b — the automatic recomputation never re-proposes, unchanged, what a person closed',()=>{
 const items=[{prospect_id:'p1',fingerprint:'v:WATCH:s1'},{prospect_id:'p2',fingerprint:'v:WATCH:s2'},{prospect_id:'p3',fingerprint:'v:CONTACT:s9'}];
 const history=[{prospect_id:'p1',fingerprint:'v:WATCH:s1',state:'REJECTED',created_at:'2026-10-16'},{prospect_id:'p2',fingerprint:'v:WATCH:s0',state:'DONE',created_at:'2026-10-16'},
  {prospect_id:'p3',fingerprint:'v:CONTACT:s9',state:'DONE',created_at:'2026-10-10'},{prospect_id:'p3',fingerprint:'v:CONTACT:s9',state:'EXPIRED',created_at:'2026-10-15'}];
 assert.deepEqual(dropClosedUnchanged(items,history).map(i=>i.prospect_id),['p2','p3'],'p1 rejected unchanged → dropped; p2 changed → kept; p3 latest is not closed → kept');
});

// ------------------------------------------------------------ 4–8 cards
test('4 — 0 CONTACT is a valid day: honest summary, no forced urgency',()=>{
 const m=buildTodayModel([MOJO,PENDING_SIG,NOTHING]);
 assert.equal(m.sections.contact.length,0);assert.ok(m.total>0);
 const empty=buildTodayModel([NOTHING]);assert.equal(empty.total,0);assert.equal(empty.hidden.dismiss,1);
 assert.equal(fr['today.noContact'],'Aucune entreprise à contacter aujourd’hui.');assert.equal(fr['today.nothingRecent'],'Aucun signal suffisamment récent aujourd’hui.');
});
test('5 — WATCH is never presented as CONTACT; the engine’s CONTACT is',()=>{
 assert.equal(MOJO.recommended_action,'WATCH');assert.equal(STRONG.recommended_action,'CONTACT');
 const m=buildTodayModel([MOJO,PENDING_SIG,STRONG]);
 assert.deepEqual(m.sections.contact.map(c=>c.name),['Acme']);
 for(const s of ['verify','watch','engage'] as const)for(const c of m.sections[s])assert.notEqual(c.action,'CONTACT');
 assert.ok(m.sections.verify.every(c=>c.primary.kind!=='PREPARE_MESSAGE'));
});
test('6 — DISMISS and WAIT do not take space on Today (counted only)',()=>{
 const m=buildTodayModel([NOTHING,LOW,MOJO]);
 assert.equal(LOW.recommended_action,'DISMISS');
 assert.ok(Object.values(m.sections).flat().every(c=>c.action!=='DISMISS'&&c.action!=='WAIT'));
 assert.equal(m.hidden.dismiss,2);
});
test('6b — one primary action, derived from the engine state',()=>{
 assert.deepEqual(primaryActionOf(STRONG),{kind:'PREPARE_MESSAGE'});
 assert.deepEqual(primaryActionOf(PENDING_SIG).kind,'VERIFY_SIGNAL','the driving signal is not reviewed yet');
 assert.ok(primaryActionOf(PENDING_SIG).signalId);
 assert.equal(primaryActionOf(MOJO).kind,'VERIFY_INFORMATION','INCOMPLETE FIT: missing ICP information');
 assert.equal(primaryActionOf({...MOJO,scores:{fit:{profile:{state:'SUFFICIENT',supporting:['x'],missing:[]}}}}).kind,'NONE','nothing useful to verify → just watched');
});
test('7 — level 1 speaks human: who, why now, why this company, what is left to verify — no score, no rule, no jargon',()=>{
 const c=cardOf(MOJO);
 assert.equal(c.name,'Mojo');assert.equal(c.section,'verify');
 assert.equal(c.whyNow,'Nouvelle implantation à Toulouse, il y a 6 jours.');
 assert.equal(c.whyCompany,'Correspond à votre cible : Restauration en Occitanie.');
 assert.deepEqual(c.toVerify,['Décision d’achat locale','Besoin d’un canal direct','Canal de contact documenté'],'the engine’s missing criteria, not a guessed "blocking" fact');
 const level1=[c.name,c.whyNow,c.whyCompany,...c.toVerify].join(' ');
 assert.doesNotMatch(level1,/\bFIT\b|INTENT|TIMING|INCOMPLETE|WATCH|VERIFIED|INFERRED|\/100|score|règle/i);
 assert.equal(fr['today.moreInfo'],'Informations supplémentaires nécessaires :','never claimed as "the one blocking fact"');
});
test('7b — the panel renders scores only inside "Détails avancés"',async()=>{
 const panel=await read('src/components/TodayPanel.tsx');
 const advancedAt=panel.indexOf('<details className="today-advanced"');
 assert.ok(advancedAt>0);assert.ok(panel.indexOf('card.advanced.scores')>advancedAt,'scores after the advanced summary');
 assert.equal((panel.match(/card\.advanced\.scores/g)??[]).length,1);
 assert.ok(panel.indexOf('<details className="today-why"')<advancedAt,'level 2 before level 3');
});
test('8 — advanced details keep every explanation statement and its provenance',()=>{
 const c=cardOf(STRONG);
 const all=[...STRONG.explanation.why_this_account,...STRONG.explanation.why_now,...STRONG.explanation.why_this_action,...STRONG.explanation.inferred,...STRONG.explanation.unknown];
 assert.deepEqual(c.advanced.statements,all);
 assert.ok(c.advanced.statements.some(s=>s.refs.some(r=>r.source_url)),'sources kept');
 assert.ok(c.advanced.scores.some(s=>s.label==='FIT')&&c.advanced.scores.some(s=>s.label==='Couverture ICP'));
 assert.equal(c.advanced.rule,STRONG.rule);
 assert.match(c.proof!.text,/Kantina recrute un SDR/);assert.ok(c.proof!.url);
});

// ------------------------------------------------------------ 9 engine untouched
test('9 — NBA v1.3 decisions unchanged: engine, registry and content identical to a54539d',()=>{
 for(const f of ['src/nba/engine.ts','src/nba/registry.ts','src/nba/content.ts','src/geo/model.ts','src/domain/fit-estimate.ts','src/domain/core.ts']){
  const before=execSync(`git show a54539d:${f}`,{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  const now=execSync(`cat ${f}`,{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.equal(now,before,f);
 }
 assert.equal(MOJO.rule,'INCOMPLETE_FIT_FRESH_SIGNAL');assert.equal(STRONG.rule,'EXPLICIT_RECENT_NEED');
});

// ------------------------------------------------------------ 10 measurement
test('10 — only trusted user clicks/submits count; automatic events, renders and loads never do; one event per kind',()=>{
 const sent:[string,number,number][]=[];let t=0;
 const s=new ZfSession((k,e,i)=>sent.push([k,e,i]),'00000000-0000-4000-8000-0000000000aa',()=>t,0);
 const button={closest:(q:string)=>q.includes('button')?{}:null},div={closest:()=>null};
 assert.equal(s.observe({isTrusted:false,type:'click',target:button}),false,'programmatic click');
 assert.equal(s.observe({isTrusted:true,type:'click',target:div}),false,'a click on nothing interactive');
 assert.equal(s.observe({isTrusted:true,type:'scroll',target:button}),false);
 t=1200;s.emit('ZF_TODAY_VIEWED');
 assert.equal(s.observe({isTrusted:true,type:'click',target:button}),true);
 t=4500;assert.equal(s.emit('ZF_FIRST_MEANINGFUL_ACTION'),true);assert.equal(s.emit('ZF_FIRST_MEANINGFUL_ACTION'),false,'once per session');
 assert.deepEqual(sent,[['ZF_TODAY_VIEWED',1200,0],['ZF_FIRST_MEANINGFUL_ACTION',4500,1]]);
 assert.deepEqual([...ZF_KINDS],['ZF_SESSION_STARTED','ZF_TODAY_VIEWED','ZF_FIRST_RECOMMENDATION_VISIBLE','ZF_FIRST_MEANINGFUL_ACTION','ZF_ADVANCED_DETAILS_OPENED']);
 const p=zfPayload({kind:'ZF_TODAY_VIEWED',sessionId:'00000000-0000-4000-8000-0000000000aa',elapsedMs:1200,interactions:0,userId:'00000000-0000-4000-8000-000000000001'});
 assert.deepEqual(Object.keys(p!).sort(),['elapsed_ms','experiment','interactions','schema','session_id','user_id'],'closed numeric payload, no text');
 assert.equal(zfPayload({kind:'ZF_HACK',sessionId:'00000000-0000-4000-8000-0000000000aa',elapsedMs:1,interactions:0,userId:'00000000-0000-4000-8000-000000000001'}),null);
});

// ------------------------------------------------------------ 11 copy
test('11 — no "essai gratuit / 7 jours gratuits / free trial" promise in the modified journey',async()=>{
 const FREE=/essai gratuit|jours gratuit|gratuitement|free trial|free for 7|7-day trial|7 days/i;
 for(const k of ['landing.trialCta','landing.trialFullSub','pricing.trialLimits','demoBanner.trial','demoBanner.full','icp.demoAnalyzeNote'] as const){
  assert.doesNotMatch(fr[k],FREE,`fr ${k}`);if(en[k as keyof typeof en])assert.doesNotMatch(en[k as keyof typeof en],FREE,`en ${k}`);
 }
 const t=getSeoPage('tarifs')!;assert.doesNotMatch(JSON.stringify(t),FREE);
 assert.doesNotMatch(await read('src/components/PricingPage.tsx'),/Essai gratuit|Essayer gratuitement|essai gratuit/);
 for(const k of Object.keys(fr).filter(k=>k.startsWith('today.')))assert.doesNotMatch(fr[k as keyof typeof fr],FREE,k);
});

// ------------------------------------------------------------ 12 isolation
test('12 — no Self-Outreach dependency or code',async()=>{
 const pkg=JSON.parse(await read('package.json'));
 for(const d of ['nodemailer','imapflow','mailparser'])assert.ok(!pkg.dependencies[d],d);
 for(const f of ['src/nba/today.ts','src/components/TodayPanel.tsx','src/ux/zero-friction.ts','src/ux/zf-session.ts','app/page.tsx','src/nba/api.ts'])
  assert.doesNotMatch(await read(f),/self-outreach|nodemailer|imap|smtp/i,f);
});
