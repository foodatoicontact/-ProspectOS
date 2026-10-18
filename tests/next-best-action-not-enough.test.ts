// NBA v1.3.x — the former terminal rule NOT_ENOUGH (DISMISS) split by FIT state: FIT_UNKNOWN_NO_TIMING and
// FIT_INCOMPLETE_NO_TIMING ("à documenter", not rejected), LOW_FIT_NO_TIMING (KNOWN_LOW between dismissBelow and
// watchMin). Same actions, same thresholds: on a grid of inputs the recommended action equals the one of the v1.3 engine
// (a54539d, read from git), and only NOT_ENOUGH changes name. Today counts "à documenter" apart, and reads the
// NOT_ENOUGH rows already stored from their FIT state. Fictitious companies, .example domains; no network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildOpportunity,NBA_DEFAULT_CONFIG,RULES,type NbaInput,type NbaSignal,type Opportunity} from '../src/nba/engine.ts';
import {buildTodayModel,hiddenKindOf,type TodayRow} from '../src/nba/today.ts';
import {todayV2} from '../src/ui/v2/today/model.ts';
import type {Criterion,Evidence} from '../src/domain/core.ts';

const ROOT=new URL('..',import.meta.url);
const NOW=new Date('2026-10-18T12:00:00Z');
const daysAgo=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
let n=0;
// Weights 35 / 25 / 25 / 15: every FIT level of the grid below is reachable.
const ICP:Criterion[]=[
 {key:'target_fit',label:'Restauration en Occitanie',weight:35,rules:{type:'target_fit' as const,config:{locations:['Occitanie'],match:'any_defined' as const}}},
 {key:'local_decision',label:'Décision d’achat locale',weight:25},
 {key:'need_fit',label:'Besoin d’un canal direct',weight:25},
 {key:'contactability',label:'Canal de contact documenté',weight:15}];
const ev=(criterion:string,value=true,status:'VERIFIED'|'NOT_VERIFIED'='VERIFIED'):Evidence=>({id:`e${++n}`,criterion,value,status,source_url:'https://presse.example/x',
 excerpt:'Restaurant ouvert à Toulouse.',observed_at:daysAgo(3),verified_by:status==='VERIFIED'?'u':null});
const TOULOUSE={text:'Toulouse',departments:['31'],regions:['Occitanie'],basis:'EVENT_MENTION'};
const opening=(o:Partial<NbaSignal>={}):NbaSignal=>({id:`s${++n}`,signal_type:'new_site',status:'VERIFIED',title:'Kantina ouvre un restaurant',
 excerpt:'Kantina vient d’ouvrir un nouveau restaurant.',source_url:`https://presse.example/k-${n}`,source_domain:'presse.example',source_type:'search_snippet',confidence:0.6,
 event_date:null,published_at:daysAgo(5),observed_at:daysAgo(5),matched_terms:[],provider:'discovery_recycled',raw_metadata:{origin:'signal_discovery',location:TOULOUSE},...o});
const sdr=(o:Partial<NbaSignal>={}):NbaSignal=>({id:`s${++n}`,signal_type:'hiring_role',status:'VERIFIED',title:'Kantina recrute un SDR',
 excerpt:'Kantina recrute un SDR pour son pipeline outbound.',source_url:`https://jobs.example/k-${n}`,source_domain:'jobs.example',source_type:'job_board',confidence:0.8,
 event_date:null,published_at:daysAgo(2),observed_at:daysAgo(2),matched_terms:[],provider:'web_search',raw_metadata:{location:TOULOUSE},...o});
const input=(o:Partial<NbaInput>):NbaInput=>({prospect:{id:`p${++n}`,project_id:'proj',name:'Kantina',status:'À analyser'},criteria:ICP,
 evidence:[],signals:[],publicContent:[],profile:null,now:NOW,...o});
const run=(o:Partial<NbaInput>):Opportunity=>buildOpportunity(input(o));
const action=(o:Opportunity)=>o.explanation.why_this_action[0]!.text;
const fp=(o:Opportunity)=>o.scores.fit.profile;

test('rules — UNKNOWN / INCOMPLETE / KNOWN_LOW 30–49 without timing; KNOWN_LOW < 30 still OFF_TARGET',()=>{
 const unknown=run({});
 assert.deepEqual([fp(unknown).state,unknown.rule,unknown.recommended_action],['UNKNOWN','FIT_UNKNOWN_NO_TIMING','DISMISS']);
 const incomplete=run({evidence:[ev('target_fit')]});
 assert.deepEqual([fp(incomplete).state,incomplete.rule,incomplete.recommended_action],['INCOMPLETE','FIT_INCOMPLETE_NO_TIMING','DISMISS']);
 // 35 TRUE + 15 FALSE (verified) → level 35, KNOWN_LOW, OFF_TARGET not reached.
 const low=run({evidence:[ev('target_fit'),ev('contactability',false)]});
 assert.deepEqual([fp(low).state,fp(low).level,low.rule,low.recommended_action],['KNOWN_LOW',35,'LOW_FIT_NO_TIMING','DISMISS']);
 // 25 TRUE + 35 FALSE → level 25 < 30: OFF_TARGET, unchanged.
 const off=run({evidence:[ev('local_decision'),ev('target_fit',false)]});
 assert.deepEqual([fp(off).state,fp(off).level,off.rule],['KNOWN_LOW',25,'OFF_TARGET']);
 // Boundaries: level 30 is LOW_FIT_NO_TIMING (not OFF_TARGET), level 49 too; 50 is no longer low.
 const cfg=NBA_DEFAULT_CONFIG.fit;assert.deepEqual(cfg,{contactMin:60,engageMin:50,watchMin:50,dismissBelow:30},'thresholds unchanged');
 const w=(weights:number[])=>ICP.map((c,i)=>({...c,weight:weights[i]!}));
 const at30=run({criteria:w([30,20,25,25]),evidence:[ev('target_fit'),ev('local_decision',false)]});
 assert.deepEqual([fp(at30).level,at30.rule],[30,'LOW_FIT_NO_TIMING']);
 const at29=run({criteria:w([29,21,25,25]),evidence:[ev('target_fit'),ev('local_decision',false)]});
 assert.deepEqual([fp(at29).level,at29.rule],[29,'OFF_TARGET']);
 const at49=run({criteria:w([49,21,15,15]),evidence:[ev('target_fit'),ev('local_decision',false)]});
 assert.deepEqual([fp(at49).level,at49.rule],[49,'LOW_FIT_NO_TIMING']);
 const at50=run({criteria:w([50,20,15,15]),evidence:[ev('target_fit'),ev('local_decision',false)]});
 assert.deepEqual([fp(at50).level,at50.rule,at50.recommended_action],[50,'FIT_WITHOUT_TIMING','WAIT']);
 assert.ok(!RULES.some(r=>(r.id as string)==='NOT_ENOUGH'),'NOT_ENOUGH is never decided any more');
});
test('rules — a fresh signal keeps UNKNOWN / INCOMPLETE in WATCH; FIT ≥ 50 without timing is WAIT; CONTACT unchanged',()=>{
 const u=run({signals:[opening()]});assert.deepEqual([u.rule,u.recommended_action],['UNKNOWN_FIT_FRESH_SIGNAL','WATCH']);
 const i=run({evidence:[ev('target_fit')],signals:[opening()]});assert.deepEqual([i.rule,i.recommended_action],['INCOMPLETE_FIT_FRESH_SIGNAL','WATCH']);
 const wait=run({evidence:[ev('target_fit'),ev('local_decision')]});assert.deepEqual([wait.rule,wait.recommended_action],['FIT_WITHOUT_TIMING','WAIT']);
 const contact=run({evidence:[ev('target_fit'),ev('local_decision'),ev('need_fit')],signals:[sdr()]});
 assert.equal(contact.recommended_action,'CONTACT');assert.ok(['EXPLICIT_RECENT_NEED','CONTACT_SIGNAL'].includes(contact.rule));
});
test('explanations — exactly the FIT state; an UNKNOWN or INCOMPLETE FIT is never called off target or low',()=>{
 const LOW=/hors cible|ne correspond pas|insuffisant|défavorable/i;
 const unknown=action(run({}));
 assert.match(unknown,/^L’adéquation à l’ICP n’est pas encore documentée/);assert.doesNotMatch(unknown.replace('correspond ou non à la cible',''),LOW);
 assert.doesNotMatch(unknown,/hors cible/);
 const incomplete=action(run({evidence:[ev('target_fit')]}));
 assert.match(incomplete,/^Les éléments disponibles sont favorables, mais une partie de l’ICP reste non documentée \(35 % documenté ; à documenter : Décision d’achat locale, Besoin d’un canal direct, Canal de contact documenté\)/);
 assert.doesNotMatch(incomplete,LOW);
 const low=action(run({evidence:[ev('target_fit'),ev('contactability',false)]}));
 assert.match(low,/^Des éléments vérifiés sont défavorables \(Canal de contact documenté ; FIT 35\/100\), sans atteindre le seuil qui écarte un compte comme hors cible/);
 // A faded signal is named, never denied.
 const faded=run({signals:[opening({published_at:daysAgo(80),observed_at:daysAgo(80)})]});
 if(faded.rule==='FIT_UNKNOWN_NO_TIMING'&&faded.signal_ids.length)assert.match(action(faded),/le meilleur signal encore pris en compte/);
});

// The v1.3 engine (a54539d) loaded from git: its relative imports point at today's modules, which the v1.3.x change
// does not touch (registry, geo, domain — pinned byte-identical in zero-friction-today.test.ts).
async function legacyEngine():Promise<typeof import('../src/nba/engine.ts')>{
 const src=execSync('git show a54539d:src/nba/engine.ts',{cwd:ROOT,encoding:'utf8'})
  .replace(/from '\.\/([^']+)'/g,(_,f)=>`from '${new URL(`src/nba/${f}`,ROOT).href}'`)
  .replace(/from '\.\.\/([^']+)'/g,(_,f)=>`from '${new URL(`src/${f}`,ROOT).href}'`);
 const file=join(mkdtempSync(join(tmpdir(),'nba-a54539d-')),'engine.ts');writeFileSync(file,src);
 return import(file);
}
test('decisions unchanged — on a grid of FIT × signals × status the action equals v1.3; only NOT_ENOUGH is renamed, by FIT state',async()=>{
 const old=await legacyEngine();
 const values=[undefined,true,false] as const;
 const sigs:(()=>NbaSignal[])[]=[()=>[],()=>[opening()],()=>[opening({status:'PENDING_REVIEW'})],()=>[opening({published_at:daysAgo(40),observed_at:daysAgo(40)})],
  ()=>[opening({published_at:daysAgo(200),observed_at:daysAgo(200)})],()=>[sdr()],()=>[sdr({status:'PENDING_REVIEW'})],()=>[opening({raw_metadata:{origin:'signal_discovery',location:{text:'Vannes',departments:['56'],regions:['Bretagne'],basis:'EVENT_MENTION'}}})]];
 let cases=0;const renamed:Record<string,number>={};
 for(const a of values)for(const b of values)for(const c of values)for(const d of values)for(const s of sigs)for(const status of ['À analyser','Perdu']){
  const evidence=([['target_fit',a],['local_decision',b],['need_fit',c],['contactability',d]] as const).filter(([,v])=>v!==undefined).map(([k,v])=>ev(k,v as boolean));
  const signals=s();const id=`p${++n}`;
  const inp=input({prospect:{id,project_id:'proj',name:'Kantina',status},evidence,signals});
  const now=buildOpportunity(inp),before=old.buildOpportunity(inp);
  assert.equal(now.recommended_action,before.recommended_action,`${JSON.stringify({a,b,c,d,status})}`);
  assert.equal(now.fingerprint,before.fingerprint,'same fingerprint: no stored recommendation is superseded by this change');
  assert.equal(now.config_version,'nba-v1.3-2026-10');
  if(before.rule==='NOT_ENOUGH'){
   const want={UNKNOWN:'FIT_UNKNOWN_NO_TIMING',INCOMPLETE:'FIT_INCOMPLETE_NO_TIMING',KNOWN_LOW:'LOW_FIT_NO_TIMING'}[fp(now).state as 'UNKNOWN'];
   assert.equal(now.rule,want,fp(now).state);renamed[now.rule]=(renamed[now.rule]??0)+1;
  }else assert.equal(now.rule,before.rule);
  cases++;
 }
 assert.equal(cases,81*sigs.length*2);
 for(const r of ['FIT_UNKNOWN_NO_TIMING','FIT_INCOMPLETE_NO_TIMING','LOW_FIT_NO_TIMING'])assert.ok((renamed[r]??0)>0,`grid reaches ${r}`);
});

// ------------------------------------------------------------ Today
const row=(o:Opportunity,over:Partial<TodayRow>={}):TodayRow=>({id:`a-${o.prospect_id}`,prospect_id:o.prospect_id,recommended_action:o.recommended_action,rule:o.rule,state:'PENDING',
 opportunity_score:o.scores.opportunity.score,fit_score:o.scores.fit.score,fit_basis:o.scores.fit.basis,intent_score:o.scores.intent.score,timing_score:o.scores.timing.score,
 freshness_score:o.scores.freshness.score,evidence_quality_score:o.scores.evidence_quality.score,primary_kind:o.primary?.kind??null,
 primary_signal_type:o.primary?.kind==='signal'?o.primary.commercial_type:null,primary_evidence_status:o.primary?.kind==='signal'?o.primary.evidence_status:null,
 signal_age_days:o.primary?.age_days??null,primary_detail:o.primary as TodayRow['primary_detail'],scores:o.scores as TodayRow['scores'],target:o.target,
 explanation:o.explanation,prepared_content:null,computed_at:o.computed_at,prospects:{name:`Société ${o.prospect_id}`},...over});
const UNKNOWN_ROW=row(run({})),INCOMPLETE_ROW=row(run({evidence:[ev('target_fit')]})),LOW_ROW=row(run({evidence:[ev('target_fit'),ev('contactability',false)]}));
const OFF_ROW=row(run({evidence:[ev('local_decision'),ev('target_fit',false)]}));
const CLOSED_ROW=row(run({prospect:{id:'pc',project_id:'proj',name:'Fermée',status:'Perdu'},signals:[opening()]}));
const WAIT_ROW=row(run({evidence:[ev('target_fit'),ev('local_decision')]})),WATCH_ROW=row(run({evidence:[ev('target_fit')],signals:[opening()]}));
const CONTACT_ROW=row(run({evidence:[ev('target_fit'),ev('local_decision'),ev('need_fit')],signals:[sdr()]}));
// Stored before v1.3.x: same row, rule NOT_ENOUGH (never rewritten in the database).
const legacy=(r:TodayRow):TodayRow=>({...r,id:`legacy-${r.id}`,rule:'NOT_ENOUGH'});

test('Today — hidden.document counts UNKNOWN / INCOMPLETE apart; hidden.dismiss is only the accounts set aside',()=>{
 assert.deepEqual([UNKNOWN_ROW,INCOMPLETE_ROW,LOW_ROW,OFF_ROW,CLOSED_ROW,WAIT_ROW].map(r=>[r.rule,hiddenKindOf(r)]),[
  ['FIT_UNKNOWN_NO_TIMING','document'],['FIT_INCOMPLETE_NO_TIMING','document'],['LOW_FIT_NO_TIMING','dismiss'],['OFF_TARGET','dismiss'],['CLOSED_PROSPECT','dismiss'],['FIT_WITHOUT_TIMING','wait']]);
 assert.equal(hiddenKindOf(WATCH_ROW),null);assert.equal(hiddenKindOf(CONTACT_ROW),null);
 const m=buildTodayModel([UNKNOWN_ROW,INCOMPLETE_ROW,LOW_ROW,OFF_ROW,CLOSED_ROW,WAIT_ROW,WATCH_ROW,CONTACT_ROW]);
 assert.deepEqual(m.hidden,{wait:1,dismiss:3,document:2});
 assert.equal(m.watched,m.sections.watch.length+1,'"en veille" = WATCH with nothing to do + WAIT, never a document account');
 const shown=Object.values(m.sections).flat().map(c=>c.id);
 for(const r of [UNKNOWN_ROW,INCOMPLETE_ROW])assert.ok(!shown.includes(r.id),'no card for an account to document');
 // Only PENDING rows count.
 assert.equal(buildTodayModel([{...UNKNOWN_ROW,state:'REJECTED'}]).hidden.document,0);
});
test('Today — NOT_ENOUGH rows already stored are read from their stored FIT state, before any recomputation',()=>{
 assert.equal(hiddenKindOf(legacy(UNKNOWN_ROW)),'document');
 assert.equal(hiddenKindOf(legacy(INCOMPLETE_ROW)),'document');
 assert.equal(hiddenKindOf(legacy(LOW_ROW)),'dismiss');
 assert.equal(hiddenKindOf({...legacy(UNKNOWN_ROW),scores:null}),'dismiss','no stored FIT state: nothing to base "à documenter" on — kept where it was');
 const m=buildTodayModel([legacy(UNKNOWN_ROW),legacy(INCOMPLETE_ROW),legacy(LOW_ROW)]);
 assert.deepEqual(m.hidden,{wait:0,dismiss:1,document:2});assert.equal(m.total,0);
});
test('Today 2.0 — "À documenter · N": a plain count, no card in the default view nor in "en veille", no filter',()=>{
 const rows=[UNKNOWN_ROW,legacy(INCOMPLETE_ROW),LOW_ROW,WAIT_ROW,WATCH_ROW,CONTACT_ROW];
 const v=todayV2(rows,'fr');
 assert.equal(v.counts.document,2);
 const ids=new Set([...v.cards,...v.watched].map(c=>c.id));
 for(const r of [UNKNOWN_ROW,legacy(INCOMPLETE_ROW)])assert.ok(!ids.has(r.id),'never a card, default view or "en veille"');
 assert.equal(v.counts.watched,v.watched.length);
 const tsx=readFileSync(new URL('src/ui/v2/today/TodayV2.tsx',ROOT),'utf8');
 assert.match(tsx,/\{model&&model\.counts\.document>0&&<p className="pos-today__document" data-testid="today-document">\{t\.toDocument\} · \{model\.counts\.document\}<\/p>\}/,
  'a paragraph, not a button or a chip');
 assert.match(tsx,/toDocument:'À documenter'/);assert.match(tsx,/toDocument:'To document'/);
 assert.doesNotMatch(tsx,/type Filter='contact'\|'verify'\|'watch'\|'document'|toggle\('document'\)/,'no new filter');
});
