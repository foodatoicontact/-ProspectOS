// ZF1.1 — fixes from the first interactive ZF1 canary (docs/ZERO_FRICTION.md): the measurement that wrote nothing,
// the summary that counted the same companies twice, prototype plurals, a level 1 too long, a vague "Vérifier", and a
// place shown as "Hérault (34)". Engine decisions are not touched. Fictitious companies, .example domains.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildTodayModel,cardOf,type TodayRow} from '../src/nba/today.ts';
import {buildOpportunity,type NbaSignal} from '../src/nba/engine.ts';
import {ZfSession,zfEventRequest} from '../src/ux/zf-session.ts';
import {handleZfEvent,recordZfEvent,zfWritesAllowed,ZfEventBody,ZF_KINDS} from '../src/server/ux-events.ts';
import {placePhrase,placeName} from '../src/ux/place-phrase.ts';
import {todaySummary} from '../src/i18n/format.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';

const read=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
const NOW=new Date('2026-10-17T14:37:21Z');const daysAgo=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
const USER='00000000-0000-4000-8000-000000000001',ORG='00000000-0000-4000-8000-0000000000a1',PROJECT='00000000-0000-4000-8000-0000000000b1',SESSION='00000000-0000-4000-8000-0000000000c1';
const ICP=[{key:'target_fit',label:'Restauration en Occitanie',weight:35,rules:{type:'target_fit' as const,config:{locations:['Occitanie'],match:'any_defined' as const}}},
 {key:'local_decision',label:'Décision d’achat locale',weight:25},{key:'need_fit',label:'Besoin d’un canal direct',weight:25},{key:'contactability',label:'Canal de contact documenté',weight:15}];
const loc=(text:string,departments:string[],regions=['Occitanie'])=>({text,departments,regions,basis:'EVENT_MENTION'});
let n=0;
const sig=(o:Partial<NbaSignal>&{location?:unknown}={}):NbaSignal=>{const {location,...rest}=o;return {id:`s${++n}`,signal_type:'new_site',status:'VERIFIED',title:'Kantina ouvre',excerpt:'Kantina ouvre un restaurant.',
 source_url:`https://presse.example/k-${n}`,source_domain:'presse.example',source_type:'search_snippet',confidence:0.6,event_date:null,published_at:daysAgo(6),observed_at:daysAgo(6),matched_terms:[],
 provider:'discovery_recycled',raw_metadata:{origin:'signal_discovery',location:location??loc('Toulouse',['31'])},...rest}};
const ev=(criterion:string)=>({id:`e${++n}`,criterion,value:true,status:'VERIFIED',source_url:'https://presse.example/a',excerpt:'Restaurant en Occitanie.',observed_at:daysAgo(3),verified_by:'u'});
const rowOf=(name:string,o:{evidence?:any[];signals?:NbaSignal[]}):TodayRow=>{
 const op=buildOpportunity({prospect:{id:`p-${name}`,project_id:'proj',name,status:'À analyser'},criteria:ICP,evidence:o.evidence??[],signals:o.signals??[],publicContent:[],profile:null,now:NOW});
 const p=op.primary;
 return {id:`a-${name}`,prospect_id:op.prospect_id,recommended_action:op.recommended_action,rule:op.rule,state:'PENDING',opportunity_score:op.scores.opportunity.score,fit_score:op.scores.fit.score,
  fit_basis:op.scores.fit.basis,intent_score:op.scores.intent.score,timing_score:op.scores.timing.score,freshness_score:op.scores.freshness.score,evidence_quality_score:op.scores.evidence_quality.score,
  primary_kind:p?.kind??null,primary_signal_type:p?.kind==='signal'?p.commercial_type:null,primary_evidence_status:p?.kind==='signal'?p.evidence_status:null,signal_age_days:p?.age_days??null,
  primary_detail:p as any,scores:op.scores as any,target:op.target,explanation:op.explanation,prospects:{name}};
};
// The 6XPOS shape after the human review: target_fit verified, three criteria unknown, verified fresh signals in the zone.
const MOJO=rowOf('Mojo',{evidence:[ev('target_fit')],signals:[sig()]});
const OCROUSTI=rowOf('Crousti',{evidence:[ev('target_fit')],signals:[sig({location:loc('Carcassonne',['11'])})]});
const QUICK=rowOf('Quick',{evidence:[ev('target_fit')],signals:[sig({signal_type:'expansion',published_at:daysAgo(25),observed_at:daysAgo(25),location:loc('Hérault (34)',['34'])})]});
const PENDING_SIG=rowOf('Popote',{signals:[sig({status:'PENDING_REVIEW'})]});
const NOTHING=rowOf('Vide',{});

// A fake privileged writer: records every read and insert on public.events.
function writer(existing:unknown[]=[],insertError:unknown=null){
 const calls:{op:string;row?:any}[]=[];
 const admin:any={from:(t:string)=>({
  select:()=>{const q:any={eq:()=>q,is:()=>q,limit:async()=>{calls.push({op:`select:${t}`});return {data:existing,error:null}}};return q},
  insert:async(row:any)=>{calls.push({op:`insert:${t}`,row});return {error:insertError}}})};
 return {admin,calls};
}
// The user's RLS client: it can read PROJECT only.
const rls:any={from:()=>({select:()=>({eq:(_k:string,v:string)=>({maybeSingle:async()=>({data:v===PROJECT?{organization_id:ORG}:null})})})})};
const body=(kind:string,o:Record<string,unknown>={})=>({...zfEventRequest(kind as any,1200,0,SESSION,PROJECT)!.body,...o});

// ------------------------------------------------------------ 1–5 measurement
test('1 — the client path emits ux.zf_*: ZfSession → zfEventRequest → a body the route accepts; page sends through the latest api',async()=>{
 const sent:any[]=[];
 const s=new ZfSession((k,e,i,id)=>{const r=zfEventRequest(k,e,i,id,PROJECT);if(r)sent.push(r)},SESSION,()=>1200,0);
 s.emit('ZF_SESSION_STARTED');
 assert.deepEqual(sent,[{path:'zf-events',method:'POST',body:{kind:'ZF_SESSION_STARTED',project_id:PROJECT,session_id:SESSION,elapsed_ms:1200,interactions:0}}]);
 assert.ok(ZfEventBody.safeParse(sent[0].body).success,'exactly the schema the route validates');
 assert.equal(zfEventRequest('ZF_TODAY_VIEWED',1,0,SESSION,''),null,'no project yet: nothing to attach the event to');
 const page=await read('app/page.tsx');
 assert.match(page,/const zfApi=useRef\(api\);zfApi\.current=api;/,'the long-lived session reads the latest api (fresh access token)');
 assert.match(page,/const r=zfEventRequest\(kind,elapsed_ms,interactions,session_id,zfProject\.current\);if\(r\)void zfApi\.current\(r\.path,r\.method,r\.body\)/);
 const route=await read('app/api/v1/[...path]/route.ts');
 assert.match(route,/if\(resource==='zf-events'&&request\.method==='POST'\)\{[\s\S]{0,300}await handleZfEvent\(body,db,user,/);
});
test('2 — authenticated route: writes on the Preview even when VERCEL_ENV is not visible (the canary defect); explicit Production never writes',async()=>{
 // The defect observed on the canary: the Preview runtime does not expose VERCEL_ENV (ux-config answered "unknown"), so the
 // former gate skipped every event while answering 202.
 const logs:any[]=[];
 const w=writer();
 const out=await handleZfEvent(body('ZF_TODAY_VIEWED'),rls,{id:USER},{admin:()=>w.admin,env:{},enabled:true,log:l=>logs.push(l)});
 assert.equal(out,'recorded');
 const ins=w.calls.find(c=>c.op==='insert:events')!;
 assert.deepEqual({...ins.row,payload:undefined},{organization_id:ORG,prospect_id:null,actor_id:null,kind:'ux.zf_today_viewed',payload:undefined});
 assert.deepEqual(ins.row.payload,{schema:1,experiment:'zero_friction_today',session_id:SESSION,elapsed_ms:1200,interactions:0,user_id:USER});
 assert.deepEqual(logs,[{component:'zf-events',kind:'ZF_TODAY_VIEWED',outcome:'recorded'}],'outcome logged, no personal data');
 const prod=writer();
 assert.equal(await handleZfEvent(body('ZF_TODAY_VIEWED'),rls,{id:USER},{admin:()=>prod.admin,env:{VERCEL_ENV:'production'},enabled:true,log:()=>{}}),'production');
 assert.equal(prod.calls.length,0);
 assert.equal(await handleZfEvent(body('ZF_TODAY_VIEWED',{project_id:'00000000-0000-4000-8000-0000000000ff'}),rls,{id:USER},{admin:()=>writer().admin,env:{},enabled:true,log:()=>{}}),'invalid','a project the user cannot read');
 assert.equal(await handleZfEvent(body('ZF_TODAY_VIEWED',{user_id:USER}),rls,{id:USER},{admin:()=>writer().admin,env:{},enabled:true,log:()=>{}}),'invalid','closed body');
 assert.equal(await handleZfEvent(body('ZF_TODAY_VIEWED'),rls,{id:USER},{admin:()=>null,env:{},enabled:true,log:()=>{}}),'no_writer','a missing writer is named, not hidden');
 assert.equal(await handleZfEvent(body('ZF_TODAY_VIEWED'),rls,{id:USER},{admin:()=>writer([],{message:'x'}).admin,env:{},enabled:true,log:()=>{}}),'failed');
});
test('3 — one event per kind and session: client once, server deduplicates by session',async()=>{
 const w=writer([{id:'already'}]);
 assert.equal(await recordZfEvent({admin:w.admin,env:{},enabled:true,userId:USER,organizationId:ORG,kind:'ZF_TODAY_VIEWED',sessionId:SESSION,elapsedMs:5,interactions:0}),'duplicate');
 assert.ok(!w.calls.some(c=>c.op.startsWith('insert')));
 const sent:string[]=[];const s=new ZfSession(k=>sent.push(k),SESSION,()=>0,0);
 for(const k of ZF_KINDS){s.emit(k);s.emit(k)}
 assert.deepEqual(sent,[...ZF_KINDS]);
});
test('4 — automatic events, renders and recomputations are never interactions',async()=>{
 const sent:[string,number][]=[];const s=new ZfSession((k,_e,i)=>sent.push([k,i]),SESSION,()=>0,0);
 s.emit('ZF_SESSION_STARTED');s.emit('ZF_TODAY_VIEWED');s.emit('ZF_FIRST_RECOMMENDATION_VISIBLE');
 assert.equal(s.observe({isTrusted:false,type:'click',target:{closest:()=>({})}}),false,'a programmatic click');
 assert.deepEqual(sent.map(x=>x[1]),[0,0,0]);
 const panel=await read('src/components/TodayPanel.tsx');
 assert.doesNotMatch(panel,/observe\(/,'the panel never counts anything itself');
});
test('5 — FIRST_MEANINGFUL_ACTION only after a real human action',async()=>{
 const sent:string[]=[];const s=new ZfSession(k=>sent.push(k),SESSION,()=>0,0);
 s.emit('ZF_SESSION_STARTED');s.emit('ZF_TODAY_VIEWED');s.emit('ZF_FIRST_RECOMMENDATION_VISIBLE');
 assert.ok(!sent.includes('ZF_FIRST_MEANINGFUL_ACTION'),'opening Today and seeing cards is not an action');
 const panel=await read('src/components/TodayPanel.tsx');
 const fma=[...panel.matchAll(/track\('ZF_FIRST_MEANINGFUL_ACTION'\)/g)].map(m=>panel.slice(Math.max(0,m.index!-160),m.index));
 assert.equal(fma.length,2);
 assert.match(fma[0],/const onPrimary=\(c:TodayCard\)=>\{$/,'the primary button click');
 assert.match(fma[1],/await api\(`signals\/\$\{c\.primary\.signalId\}\/review`,'POST',\{decision\}\);$/,'after the review the person confirmed');
});

// ------------------------------------------------------------ 6–7 summary
test('6 — the summary never counts a company twice ("à vérifier" ≠ "surveillé")',()=>{
 const m=buildTodayModel([MOJO,OCROUSTI,QUICK,NOTHING]);
 assert.equal(m.sections.verify.length,3);assert.equal(m.watched,0,'the 3 cards to verify are not also "watched"');
 assert.deepEqual(todaySummary('fr',{contact:0,verify:m.sections.verify.length,watched:m.watched}),['Aucune entreprise à contacter aujourd’hui.','3 entreprises sont à vérifier.']);
 // A WATCH with nothing to check is a distinct set: watched, mentioned once.
 const quiet={...MOJO,id:'a-quiet',prospect_id:'p-quiet',scores:{fit:{profile:{state:'SUFFICIENT',supporting:['x'],missing:[]}}}} as TodayRow;
 const m2=buildTodayModel([MOJO,quiet]);
 assert.deepEqual([m2.sections.verify.length,m2.sections.watch.length,m2.watched],[1,1,1]);
 assert.deepEqual(todaySummary('fr',{contact:0,verify:1,watched:m2.watched}),['Aucune entreprise à contacter aujourd’hui.','1 entreprise est à vérifier.','Nous surveillons 1 entreprise.']);
});
test('7 — real singular / plural forms, no "(s)" / "(nt)"',async()=>{
 assert.deepEqual(todaySummary('fr',{contact:1,verify:3,watched:2}),['1 entreprise à contacter aujourd’hui.','3 entreprises sont à vérifier.','Nous surveillons 2 entreprises.']);
 assert.deepEqual(todaySummary('fr',{contact:2,verify:1,watched:1}),['2 entreprises à contacter aujourd’hui.','1 entreprise est à vérifier.','Nous surveillons 1 entreprise.']);
 assert.deepEqual(todaySummary('en',{contact:1,verify:3,watched:1}),['1 company to contact today.','3 companies to verify.','We are watching 1 company.']);
 assert.deepEqual(todaySummary('en',{contact:0,verify:1,watched:2}),['No company to contact today.','1 company to verify.','We are watching 2 companies.']);
 for(const dict of [fr,en])for(const [k,v] of Object.entries(dict))if(k.startsWith('today.'))assert.doesNotMatch(v,/\((s|nt|ies)\)/,k);
 assert.doesNotMatch(await read('src/components/TodayPanel.tsx'),/today\.(verifyCount|watchedCount|contactCount)/);
});

// ------------------------------------------------------------ 8–10 cards
test('8 — level 1 no longer lists the missing ICP criteria',async()=>{
 const c=cardOf(MOJO);
 assert.equal(c.missingSummary,'Des informations manquent encore avant de décider si ce compte doit être contacté.');
 assert.equal((c as any).toVerify,undefined);
 for(const crit of ['Décision d’achat locale','Besoin d’un canal direct','Canal de contact documenté'])
  assert.ok(![c.whyNow,c.whyCompany,c.missingSummary].join(' ').includes(crit),crit);
 assert.ok(c.whyCompany.split(/[.!?]\s/).length===1&&c.whyCompany.length<=80,'one short sentence');
 const panel=await read('src/components/TodayPanel.tsx');
 const why=panel.indexOf('<details className="today-why"');
 assert.ok(why>0&&panel.indexOf('card.details.missing')>why,'the complete list only inside "Voir pourquoi"');
});
test('9 — level 2 keeps the full transparency: favourable, complete missing list, timing, place, proof and source',()=>{
 const c=cardOf(MOJO);
 assert.deepEqual(c.details.favourable,['Restauration en Occitanie']);
 assert.deepEqual(c.details.missing,['Décision d’achat locale','Besoin d’un canal direct','Canal de contact documenté']);
 assert.equal(c.details.timing,'Signal il y a 6 jours');assert.equal(c.details.place,'Toulouse — dans votre zone');
 assert.ok(c.proof?.text&&c.proof.url);
 const p=cardOf(PENDING_SIG);
 assert.equal(p.details.missing[0],'Le signal lui-même : sa source n’a pas encore été vérifiée.','the signal to check is listed in level 2');
 assert.equal(p.missingSummary,'Le signal doit être vérifié avant toute décision.');
 const q=cardOf(QUICK);
 assert.ok(q.advanced.scores.some(s=>s.label==='Lieu (données)'&&s.value==='Hérault (34)'),'the structured label stays in the advanced details');
});
test('10 — the incomplete-FIT action is explicit but never causal; signal and CONTACT/ENGAGE labels unchanged',async()=>{
 assert.equal(fr['today.action.completeInfo'],'Compléter les informations');assert.equal(en['today.action.completeInfo'],'Complete the information');
 assert.equal((fr as any)['today.action.verify'],undefined,'the vague "Vérifier" is gone');
 assert.equal(fr['today.action.verifySignal'],'Vérifier le signal');
 assert.equal(fr['today.action.prepare'],'Préparer le message');assert.equal(fr['today.action.conversation'],'Voir la conversation');
 const panel=await read('src/components/TodayPanel.tsx');
 assert.match(panel,/VERIFY_INFORMATION:'today\.action\.completeInfo'/);
 const words=[fr['today.action.completeInfo'],cardOf(MOJO).missingSummary].join(' ');
 assert.doesNotMatch(words,/débloqu|le fait qui|une seule information|1 information|il suffit/i,'no claim about which single fact would change the decision (ZF5)');
});

// ------------------------------------------------------------ 11 place wording
test('11 — level 1 places are worded naturally from the stored label; the GEO model is not touched',()=>{
 assert.equal(placePhrase('Toulouse'),'à Toulouse');assert.equal(placePhrase('Carcassonne'),'à Carcassonne');
 assert.equal(placePhrase('Hérault (34)'),'dans l’Hérault');assert.equal(placePhrase('Hérault'),'dans l’Hérault');
 assert.equal(placePhrase('Occitanie'),'en Occitanie');
 assert.equal(placePhrase('Haute-Garonne (31)'),'dans la Haute-Garonne');assert.equal(placePhrase('Gard'),'dans le Gard');
 assert.equal(placePhrase('Pyrénées-Orientales'),'dans les Pyrénées-Orientales');assert.equal(placePhrase('Aude'),'dans l’Aude');
 assert.equal(placePhrase('Lozère'),'dans la Lozère');assert.equal(placePhrase('Grand Est'),'dans le Grand Est');
 assert.equal(placePhrase('Les Ulis'),'aux Ulis');assert.equal(placePhrase('Le Mans'),'au Mans');
 assert.equal(placeName('Hérault (34)'),'Hérault');
 assert.equal(cardOf(MOJO).whyNow,'Nouvelle implantation à Toulouse, il y a 6 jours.');
 assert.equal(cardOf(OCROUSTI).whyNow,'Nouvelle implantation à Carcassonne, il y a 6 jours.');
 assert.equal(cardOf(QUICK).whyNow,'Expansion dans l’Hérault, il y a 25 jours.');
 const region=rowOf('Region',{evidence:[ev('target_fit')],signals:[sig({location:loc('Occitanie',[])})]});
 assert.equal(cardOf(region).whyNow,'Nouvelle implantation en Occitanie, il y a 6 jours.');
 for(const r of [MOJO,OCROUSTI,QUICK,region])assert.doesNotMatch(cardOf(r).whyNow!,/\(\d+\)/,'no department code in level 1');
});

// ------------------------------------------------------------ 12–13 engine and flag
test('12 — NBA decisions identical to the v1.3 canary fixtures (and the freshness cliff, accepted for ZF1)',()=>{
 for(const r of [MOJO,OCROUSTI,QUICK])assert.deepEqual([r.recommended_action,r.rule],['WATCH','INCOMPLETE_FIT_FRESH_SIGNAL'],r.prospects!.name);
 assert.equal(NOTHING.recommended_action,'DISMISS');assert.equal(PENDING_SIG.recommended_action,'WATCH');
 // Groupe Bertrand on the canary: a verified expansion in Toulouse, half-life 45 days, WATCH needs freshness ≥ 0.5.
 const at=(d:number)=>rowOf(`Bertrand-${d}`,{evidence:[ev('target_fit')],signals:[sig({signal_type:'expansion',published_at:daysAgo(d),observed_at:daysAgo(d)})]});
 assert.deepEqual([at(45).recommended_action,at(45).freshness_score],['WATCH',50]);
 assert.deepEqual([at(46).recommended_action,at(46).freshness_score],['DISMISS',49],'it leaves Today when the signal crosses the threshold — by time alone');
});
test('13 — flag OFF: nothing written, historical behaviour unchanged',async()=>{
 assert.equal(zfWritesAllowed(false,{VERCEL_ENV:'preview'}),'flag_off');assert.equal(zfWritesAllowed(true,{}),'ok');assert.equal(zfWritesAllowed(true,{VERCEL_ENV:'production'}),'production');
 let read_=0;const db:any={from:()=>{read_++;return rls.from()}};const w=writer();
 assert.equal(await handleZfEvent(body('ZF_TODAY_VIEWED'),db,{id:USER},{admin:()=>w.admin,env:{VERCEL_ENV:'preview'},enabled:false,log:()=>{}}),'flag_off');
 assert.equal(w.calls.length,0);
 const page=await read('app/page.tsx');
 assert.match(page,/const \[view,setView\]=useState\('prospects'\)/);
 assert.match(page,/\.\.\.\(mode==='live'&&zfOn\?\[\['today','☀',tr\('nav\.today'\)\]\]:\[\]\)/);
 assert.match(page,/useEffect\(\(\)=>\{if\(mode!=='live'\|\|!zfOn\)return;/,'no ZF session without the flag');
});
