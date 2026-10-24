// UI-4 — USER_DECLARED: an ICP criterion completed from what a person knows, WITHOUT a source (migration 033).
// USER_DECLARED ≠ VERIFIED: it may move the ESTIMATED FIT (manual confidence 0.7), never the verified score or coverage,
// never CONTACT, never OFF_TARGET, never a quote in a message. API contract (closed body, author from the session),
// FIT semantics, Outreach safety, Today 2.0 flow and display, and — without any declaration — byte-for-byte the outputs
// of main before UI-4. Fictitious companies, .example domains; no network, no database (DB: user-declared-evidence-db.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {execSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleUserDeclared,UserDeclaredBody,USER_DECLARED_NOTE_MAX} from '../src/server/user-declared.ts';
import {estimateFit,evidenceConfidence} from '../src/domain/fit-estimate.ts';
import {scoreProspect,generateOutreach,type Criterion,type Evidence} from '../src/domain/core.ts';
import {buildOpportunity,type NbaInput,type NbaSignal,type Opportunity} from '../src/nba/engine.ts';
import {prepareContent} from '../src/nba/content.ts';
import {composeRuleBased} from '../src/outreach/compose.ts';
import {selectAngle} from '../src/outreach/angle.ts';
import {cardOf,type TodayRow} from '../src/nba/today.ts';
import {todayV2} from '../src/ui/v2/today/model.ts';
import {evidenceStatusLabel,declaredValueLabel} from '../src/i18n/labels.ts';

const ROOT=new URL('..',import.meta.url);
const read=(p:string)=>readFileSync(new URL(p,ROOT),'utf8');
const NOW=new Date('2026-10-18T12:00:00Z');
const daysAgo=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
const USER='00000000-0000-4000-8000-000000000001',ORG='00000000-0000-4000-8000-0000000000a1',PROJECT='00000000-0000-4000-8000-0000000000b1',PROSPECT='00000000-0000-4000-8000-0000000000c1';
let n=0;
const ICP:Criterion[]=[
 {key:'target_fit',label:'Restauration en Occitanie',weight:35,rules:{type:'target_fit' as const,config:{locations:['Occitanie'],match:'any_defined' as const}}},
 {key:'local_decision',label:'Décision d’achat locale',weight:25},
 {key:'need_fit',label:'Besoin d’un canal direct',weight:25},
 {key:'contactability',label:'Canal de contact documenté',weight:15}];
const declared=(criterion:string,value=true,o:Partial<Evidence>={}):Evidence=>({id:`d${++n}`,criterion,value,status:'USER_DECLARED',source_url:null as unknown as string,
 excerpt:null as unknown as string,observed_at:daysAgo(1),verified_by:null,...o});
const verified=(criterion:string,value=true):Evidence=>({id:`v${++n}`,criterion,value,status:'VERIFIED',source_url:'https://presse.example/a',excerpt:'Restaurant ouvert à Toulouse.',
 observed_at:daysAgo(3),verified_by:'u'});
const unverified=(criterion:string,value=true):Evidence=>({...verified(criterion,value),id:`u${++n}`,status:'NOT_VERIFIED',verified_by:null});
const TOULOUSE={text:'Toulouse',departments:['31'],regions:['Occitanie'],basis:'EVENT_MENTION'};
const sdr=(o:Partial<NbaSignal>={}):NbaSignal=>({id:`s${++n}`,signal_type:'hiring_role',status:'VERIFIED',title:'Kantina recrute un SDR',
 excerpt:'Kantina recrute un SDR pour son pipeline outbound.',source_url:`https://jobs.example/k-${n}`,source_domain:'jobs.example',source_type:'job_board',confidence:0.8,
 event_date:null,published_at:daysAgo(2),observed_at:daysAgo(2),matched_terms:[],provider:'web_search',raw_metadata:{location:TOULOUSE},...o});
const input=(o:Partial<NbaInput>):NbaInput=>({prospect:{id:`p${++n}`,project_id:'proj',name:'Kantina',status:'À analyser'},criteria:ICP,
 evidence:[],signals:[],publicContent:[],profile:null,now:NOW,...o});
const run=(o:Partial<NbaInput>):Opportunity=>buildOpportunity(input(o));

// ------------------------------------------------------------ API (src/server/user-declared.ts)
function fakeDb(o:{prospect?:object|null;criteria?:unknown;insertError?:unknown}={}){
 const inserts:any[]=[];
 const db:any={from:(t:string)=>({
  select:()=>({eq:()=>({maybeSingle:async()=>t==='prospects'?{data:o.prospect===undefined?{id:PROSPECT,project_id:PROJECT,organization_id:ORG}:o.prospect,error:null}
   :{data:{criteria:o.criteria===undefined?ICP:o.criteria},error:null}})}),
  insert:(row:any)=>{inserts.push({table:t,row});return {select:()=>({single:async()=>o.insertError?{data:null,error:o.insertError}:{data:{id:'e1',...row,declared_by:USER},error:null}})}}})};
 return {db,inserts};
}
const body=(o:Record<string,unknown>={})=>({prospect_id:PROSPECT,criterion:'local_decision',value:true,status:'USER_DECLARED',...o});

test('API — USER_DECLARED true and false without any URL are accepted; nothing about a source or an author is written',async()=>{
 for(const value of [true,false]){
  const {db,inserts}=fakeDb();
  const r=await handleUserDeclared(body({value,note:'  Le gérant me l’a dit au salon.  '}),db,{id:USER},NOW);
  assert.equal(r.status,201);
  assert.deepEqual(inserts,[{table:'evidence',row:{prospect_id:PROSPECT,organization_id:ORG,criterion:'local_decision',value,status:'USER_DECLARED',
   source_url:null,excerpt:null,note:'Le gérant me l’a dit au salon.',observed_at:NOW.toISOString()}}]);
  assert.ok(!('declared_by' in inserts[0].row)&&!('verified_by' in inserts[0].row),'the author is stamped by the database guard from the session');
 }
 const {db,inserts}=fakeDb();
 assert.equal((await handleUserDeclared(body({note:'   '}),db,{id:USER},NOW)).status,201);assert.equal(inserts[0].row.note,null,'a blank note is no note');
});
test('API — author imposed server-side: the closed body refuses any author, source, status trick or extra field',async()=>{
 for(const extra of [{declared_by:USER},{verified_by:USER},{source_url:'https://acme.example'},{excerpt:'x'},{observed_at:NOW.toISOString()},{organization_id:ORG},{user_id:USER}]){
  const {db,inserts}=fakeDb();
  assert.equal((await handleUserDeclared(body(extra),db,{id:USER},NOW)).status,400,JSON.stringify(extra));assert.equal(inserts.length,0);
 }
 for(const bad of [{value:'true'},{value:null},{value:undefined},{criterion:''},{prospect_id:'x'},{status:'VERIFIED'},{note:'x'.repeat(USER_DECLARED_NOTE_MAX+1)}]){
  const {db,inserts}=fakeDb();
  assert.equal((await handleUserDeclared(body(bad),db,{id:USER},NOW)).status,400,JSON.stringify(bad));assert.equal(inserts.length,0);
 }
 assert.ok(UserDeclaredBody.safeParse(body({note:'x'.repeat(USER_DECLARED_NOTE_MAX)})).success,'280 characters accepted');
 assert.equal((await handleUserDeclared(body(),fakeDb().db,null,NOW)).status,401);
});
test('API — criterion outside the project ICP refused; a prospect the caller cannot read is not found; failures are named',async()=>{
 const out=fakeDb();assert.deepEqual(await handleUserDeclared(body({criterion:'budget'}),out.db,{id:USER},NOW),{status:400,body:{error:'Critère hors ICP'}});assert.equal(out.inserts.length,0);
 const noIcp=fakeDb({criteria:null});assert.equal((await handleUserDeclared(body(),noIcp.db,{id:USER},NOW)).status,400);
 const hidden=fakeDb({prospect:null});assert.equal((await handleUserDeclared(body(),hidden.db,{id:USER},NOW)).status,404);assert.equal(hidden.inserts.length,0);
 assert.equal((await handleUserDeclared(body(),fakeDb({insertError:{message:'x'}}).db,{id:USER},NOW)).status,500);
});
test('API — the route sends USER_DECLARED to its own contract; the sourced path (VERIFIED needs a real source) is unchanged',()=>{
 const route=read('app/api/v1/[...path]/route.ts');
 assert.match(route,/if\(resource==='evidence'&&request\.method==='POST'\)\{\n[^\n]*\n if\(body\?\.status==='USER_DECLARED'\)\{const r=await handleUserDeclared\(body,db,user\);return json\(r\.body,r\.status\)\}/);
 // The sourced path: unchanged list of statuses (no USER_DECLARED), a safe http(s) link and an excerpt still required.
 assert.match(route,/!safeLink\(String\(body\.source_url\?\?''\)\)\|\|typeof body\.excerpt!=='string'\|\|!body\.excerpt\.trim\(\)\|\|body\.excerpt\.length>1500\|\|!\['VERIFIED','NOT_VERIFIED','CONTRADICTED','INFERRED_UNCONFIRMED'\]\.includes\(body\.status\)/);
 const main=execSync('git show 2f4dfa3:app/api/v1/[...path]/route.ts',{cwd:ROOT,encoding:'utf8'});
 const sourced=(t:string)=>t.slice(t.indexOf(" if(typeof body.criterion!=='string'||typeof body.value!=='boolean'"),t.indexOf(" if(resource==='channels'"));
 assert.equal(sourced(route),sourced(main),'sourced evidence path byte-identical to main');
});

// ------------------------------------------------------------ FIT semantics
test('FIT — a positive declaration feeds the estimate at the existing manual confidence, never the verified score or coverage',()=>{
 assert.equal(evidenceConfidence(declared('local_decision')),0.7);
 const f=estimateFit(ICP,[declared('local_decision')],NOW);
 const line=f.estimated.breakdown.find(b=>b.key==='local_decision')!;
 assert.deepEqual([line.state,line.confidence,line.points,line.declared],['ESTIMATED',0.7,Math.round(25*0.7),true]);
 assert.equal(f.verified.score,0);assert.equal(f.verified.coverage,0);
 assert.equal(scoreProspect(ICP,[declared('local_decision'),declared('target_fit')],NOW).score,0,'scoreProspect ignores declarations');
 assert.equal(f.to_verify.count,0,'a declaration is never a source "to verify"');
 const o=run({evidence:[declared('target_fit'),declared('local_decision'),declared('need_fit'),declared('contactability')]});
 const p=o.scores.fit.profile;
 assert.deepEqual([p.verified_score,p.verified_coverage,p.level],[0,0,Math.round(35*0.7)+Math.round(25*0.7)+Math.round(25*0.7)+Math.round(15*0.7)]);
 assert.equal(o.scores.fit.basis,'estimated');assert.equal(o.scores.fit.coverage,0,'evidence quality reads the verified coverage: unchanged');
 assert.equal(o.scores.evidence_quality.score,0);
 assert.deepEqual(p.declared,['Restauration en Occitanie','Décision d’achat locale','Besoin d’un canal direct','Canal de contact documenté']);
 assert.deepEqual(p.verified_supporting,[]);
 // Old declarations leave the window like every other row (90 days).
 assert.equal(estimateFit(ICP,[declared('local_decision',true,{observed_at:daysAgo(91)})],NOW).estimated.score,0);
 // A verified fact wins over a declaration, either way.
 assert.equal(estimateFit(ICP,[declared('target_fit',false),verified('target_fit')],NOW).estimated.breakdown[0]!.state,'VERIFIED');
});
test('CONTACT safety — declarations alone, however many, never make CONTACT eligible, even with a fresh verified contact signal',()=>{
 const all=[declared('target_fit'),declared('local_decision'),declared('need_fit'),declared('contactability')];
 const o=run({evidence:all,signals:[sdr()]});
 assert.notEqual(o.recommended_action,'CONTACT');assert.equal(o.scores.fit.profile.verified_score,0);
 // The same account with VERIFIED facts does reach CONTACT: the difference is the verification, nothing else.
 const v=run({evidence:[verified('target_fit'),verified('local_decision'),verified('need_fit')],signals:[sdr()]});
 assert.equal(v.recommended_action,'CONTACT');
 // Declarations next to verified facts add nothing to the verified score.
 const mix=run({evidence:[verified('target_fit'),declared('local_decision'),declared('need_fit')],signals:[sdr()]});
 assert.equal(mix.scores.fit.profile.verified_score,35);assert.notEqual(mix.recommended_action,'CONTACT');
});
test('OFF_TARGET safety — a declared FALSE is never a verified counter-proof: no OFF_TARGET, recorded and said apart',()=>{
 const o=run({evidence:[declared('target_fit',false),declared('local_decision',false),declared('need_fit',false),declared('contactability',false)]});
 const p=o.scores.fit.profile;
 assert.notEqual(o.rule,'OFF_TARGET');assert.equal(p.state,'UNKNOWN');assert.equal(p.negative_weight,0);assert.deepEqual(p.against,[]);
 assert.equal(o.rule,'FIT_UNKNOWN_NO_TIMING');
 assert.equal(p.declared_false!.length,4);
 assert.ok(o.explanation.unknown.some(s=>/^Déclaré non rempli par vous, sans source \(non vérifié, ce n’est pas une contre-preuve\)/.test(s.text)));
 // Verified FALSE still is a counter-proof (OFF_TARGET path unchanged).
 const off=run({evidence:[verified('local_decision'),verified('target_fit',false)]});assert.equal(off.rule,'OFF_TARGET');
});
test('explanation — a declaration is never called a proof nor a fact',()=>{
 const o=run({evidence:[declared('target_fit'),declared('local_decision')]});
 const all=[...o.explanation.why_this_account,...o.explanation.why_now,...o.explanation.why_this_action,...o.explanation.inferred,...o.explanation.unknown];
 assert.ok(o.explanation.why_this_account.some(s=>s.kind==='inference'&&/à partir de vos seules déclarations, sans source/.test(s.text)));
 assert.ok(o.explanation.inferred.some(s=>s.kind==='inference'&&/^Déclaré par vous, sans source \(non vérifié\) : Restauration en Occitanie, Décision d’achat locale\.$/.test(s.text)));
 assert.ok(!all.some(s=>s.kind==='fact'&&/Restauration en Occitanie|Décision d’achat locale/.test(s.text)),'never a fact');
 assert.ok(!all.some(s=>/preuves? (non )?vérifiée?s? : .*(Restauration en Occitanie)/.test(s.text)),'never listed as a proof');
 assert.ok(all.every(s=>s.refs.every(r=>r.source_url===null||/^https:\/\/(presse|jobs)\.example\//.test(r.source_url))),'no invented source');
});

// ------------------------------------------------------------ Outreach
test('Outreach — a prospect with only USER_DECLARED rows produces no factual quote from them, in every composer',()=>{
 const NOTE='Le gérant cherche à réduire sa dépendance aux plateformes';
 const ev=[declared('target_fit',true,{note:NOTE} as Partial<Evidence>),declared('local_decision'),declared('need_fit'),declared('contactability')];
 for(const locale of ['fr','en'] as const){
  const g=generateOutreach('Kantina','Nous aidons les restaurants à vendre en direct.',ICP,ev,NOW,locale);
  assert.deepEqual(g.evidence_ids,[]);assert.doesNotMatch(g.text,/«|“|j’ai remarqué|I noticed/,'the generic sentence, no quote');
  const c=composeRuleBased({name:'Kantina',offer:'Nous aidons les restaurants à vendre en direct.',criteria:ICP,evidence:ev,signals:[],profile:null,publicContent:[],now:NOW,locale});
  assert.deepEqual([c.evidence_ids,c.angle.type,c.angle.excerpt],[[],'generic',null]);assert.ok(!c.text.includes(NOTE));
 }
 // Even when an id is forced into the angle selector, a declaration is never an evidence angle.
 assert.equal(selectAngle({publicContent:[],signals:[],profile:null,evidence:ev,evidenceIds:ev.map(e=>e.id),now:NOW}).type,'generic');
 // NBA drafts: CONTACT is impossible on declarations; the prepared content never cites them either.
 const o=run({evidence:ev,signals:[sdr()]});
 const prepared=prepareContent({opportunity:o,name:'Kantina',offer:'Nous aidons les restaurants à vendre en direct.',criteria:ICP,evidence:ev,signals:[sdr()],publicContent:[],profile:null,now:NOW});
 assert.ok(!JSON.stringify(prepared).includes(NOTE));assert.ok(!('evidence_ids' in prepared)||(prepared as {evidence_ids:string[]}).evidence_ids.every(id=>!ev.some(e=>e.id===id)));
 // The AI composer's sources are built from VERIFIED excerpts only (route), and its fact guard checks against those.
 assert.match(read('app/api/v1/[...path]/route.ts'),/const verifiedExcerpts=\(p\.evidence\?\?\[\]\)\.filter\(\(e:\{id:string;status:string\}\)=>composed\.evidence_ids\.includes\(e\.id\)&&e\.status==='VERIFIED'\)/);
});

// ------------------------------------------------------------ Without any declaration: main's outputs, exactly
async function mainModules(){
 const dir=mkdtempSync(join(tmpdir(),'ui4-main-'));
 const files=['src/nba/engine.ts','src/domain/fit-estimate.ts'];
 const local=new Map(files.map(f=>[f,join(dir,f)]));
 for(const f of files){
  const src=execSync(`git show 2f4dfa3:${f}`,{cwd:ROOT,encoding:'utf8'}).replace(/from '(\.{1,2}\/[^']+)'/g,(_,rel)=>{
   const target=new URL(rel,new URL(f,ROOT)).pathname.slice(new URL('.',ROOT).pathname.length);
   return `from '${local.has(target)?local.get(target):new URL(target,ROOT).href}'`;});
  mkdirSync(join(dir,f,'..'),{recursive:true});writeFileSync(join(dir,f),src);
 }
 return {engine:await import(local.get('src/nba/engine.ts')!) as typeof import('../src/nba/engine.ts'),fit:await import(local.get('src/domain/fit-estimate.ts')!) as typeof import('../src/domain/fit-estimate.ts')};
}
test('no regression — without any declaration, estimate and NBA outputs equal main (2f4dfa3) exactly (new label lists aside)',async()=>{
 const m=await mainModules();
 const strip=(o:any)=>JSON.parse(JSON.stringify(o,(k,v)=>['verified_supporting','declared','declared_false','declarations'].includes(k)?undefined:v));
 const values=[undefined,true,false] as const;let cases=0;
 for(const a of values)for(const b of values)for(const c of values)for(const kind of ['VERIFIED','NOT_VERIFIED','INFERRED_UNCONFIRMED','CONTRADICTED'])for(const sig of [[],[sdr()],[sdr({status:'PENDING_REVIEW'})]]){
  const evidence=([['target_fit',a],['local_decision',b],['need_fit',c]] as const).filter(([,v])=>v!==undefined).map(([k,v])=>({...verified(k,v as boolean),status:kind,verified_by:kind==='VERIFIED'||kind==='CONTRADICTED'?'u':null}));
  const inp=input({evidence,signals:sig as NbaSignal[]});
  assert.deepEqual(strip(estimateFit(ICP,evidence,NOW)),strip(m.fit.estimateFit(ICP,evidence,NOW)));
  assert.deepEqual(estimateFit(ICP,evidence,NOW).declarations,[],'no declaration: empty identity');
  assert.deepEqual(strip(buildOpportunity(inp)),strip(m.engine.buildOpportunity(inp)));
  assert.equal(buildOpportunity(inp).fingerprint,m.engine.buildOpportunity(inp).fingerprint,'fingerprint strictly identical to main');
  cases++;
 }
 assert.equal(cases,27*4*3);
});

// ------------------------------------------------------------ Today 2.0
const row=(o:Opportunity):TodayRow=>({id:`a-${o.prospect_id}`,prospect_id:o.prospect_id,recommended_action:o.recommended_action,rule:o.rule,state:'PENDING',
 opportunity_score:o.scores.opportunity.score,fit_score:o.scores.fit.score,fit_basis:o.scores.fit.basis,intent_score:o.scores.intent.score,timing_score:o.scores.timing.score,
 freshness_score:o.scores.freshness.score,evidence_quality_score:o.scores.evidence_quality.score,primary_kind:o.primary?.kind??null,
 primary_signal_type:o.primary?.kind==='signal'?o.primary.commercial_type:null,primary_evidence_status:o.primary?.kind==='signal'?o.primary.evidence_status:null,
 signal_age_days:o.primary?.age_days??null,primary_detail:o.primary as TodayRow['primary_detail'],scores:o.scores as TodayRow['scores'],target:o.target,
 explanation:o.explanation,prepared_content:null,computed_at:o.computed_at,prospects:{name:'Kantina'}});
test('Today — Level 2 tells verified, declared by you, estimated and not documented apart; Level 3 shows the raw USER_DECLARED',()=>{
 const o=run({evidence:[verified('target_fit'),declared('local_decision'),unverified('need_fit'),declared('contactability',false)],signals:[sdr({status:'PENDING_REVIEW'})]});
 const r=row(o);
 for(const locale of ['fr','en'] as const){
  const v=todayV2([r],locale);const card=[...v.cards,...v.watched].find(c=>c.id===r.id)!;
  assert.deepEqual(card.level2.favourableItems,[{label:'Restauration en Occitanie',basis:'verified'},{label:'Décision d’achat locale',basis:'declared'},{label:'Besoin d’un canal direct',basis:'estimated'}]);
  // The unchecked signal line (pre-UI-4 behaviour of a VERIFY_SIGNAL card) stays first; the declared FALSE is said as such.
  assert.deepEqual(card.level2.missingItems,[{label:'Le signal lui-même : sa source n’a pas encore été vérifiée.',basis:'undocumented'},{label:'Canal de contact documenté',basis:'declared_false'}]);
  assert.deepEqual(card.level3.evidence.slice(3),[{label:'USER_DECLARED true',value:'Décision d’achat locale'},{label:'USER_DECLARED false',value:'Canal de contact documenté'}]);
 }
 // A row stored before UI-4 (no detail): displayed exactly as before.
 const legacy={...r,scores:{fit:{profile:{state:'INCOMPLETE',coverage:35,supporting:['Restauration en Occitanie'],missing:['Décision d’achat locale']}}}} as TodayRow;
 const lc=[...todayV2([legacy],'fr').cards,...todayV2([legacy],'fr').watched][0]!;
 assert.deepEqual(lc.level2.favourableItems,[{label:'Restauration en Occitanie',basis:'legacy'}]);assert.deepEqual(lc.level2.missingItems.map(m=>m.basis),['undocumented','undocumented']);
 assert.deepEqual(cardOf(legacy).details.declared,[]);
});
test('Today — the declaration form: same panel, warning always visible, loading and double-click guard, clean error, FR + EN, keyboard',()=>{
 const src=read('src/ui/v2/today/TodayV2.tsx');const css=read('src/ui/v2/today/today.css');
 // Same Sheet (mobile) / ContextDrawer (desktop): the form renders inside the one ContextPanel, no page, no route.
 assert.match(read('src/ui/v2/panels.tsx'),/return useIsDesktop\(\)\?<ContextDrawer \{\.\.\.props\}\/>:<Sheet \{\.\.\.props\}\/>;/);
 const panel=src.slice(src.indexOf('<ContextPanel open='),src.indexOf('</ContextPanel>'));
 assert.match(panel,/\{current&&panel\?\.mode==='declare'&&<DeclareForm key=\{current\.id\} card=\{current\} criteria=\{criteria\} locale=\{locale\} busy=\{busy\} error=\{declareError\}/);
 assert.match(src,/panel\?\.mode==='declare'\?t\.declareTitle/);
 // Form: criterion, met / not met, optional bounded note, the warning, one primary "Enregistrer".
 const form=src.slice(src.indexOf('function DeclareForm('),src.indexOf('// Level 2 — never a score.'));
 assert.match(form,/<select id=\{`\$\{id\}-criterion`\}/);assert.equal((form.match(/type="radio"/g)??[]).length,2);
 assert.match(form,/<textarea id=\{`\$\{id\}-note`\} rows=\{3\} maxLength=\{280\}/);
 assert.match(form,/<p id=\{`\$\{id\}-warning`\} className="pos-declare__warning">/);assert.match(form,/aria-describedby=\{`\$\{id\}-warning`\}/);
 assert.match(form,/<Button type="submit" variant="primary" size="md" fullWidth loading=\{busy\} disabled=\{!ready\}>\{t\.declareSave\}<\/Button>/);
 assert.match(form,/onSubmit=\{e=>\{e\.preventDefault\(\);if\(ready\)onSubmit/);assert.match(form,/const ready=!!criterion&&value!==null&&!busy;/);
 assert.match(form,/\{error&&<p className="pos-declare__error" role="alert">\{error\}<\/p>\}/);
 // Keyboard: native controls only (label/for, fieldset/legend, radios, submit), visible focus.
 assert.match(form,/<fieldset className="pos-field" disabled=\{busy\}><legend className="pos-field__label">/);assert.match(form,/htmlFor=\{`\$\{id\}-criterion`\}/);
 assert.doesNotMatch(form,/onKeyDown|tabIndex=\{-1\}|role="button"/);
 assert.match(css,/\.pos-ui \.pos-field select:focus-visible,\.pos-ui \.pos-field textarea:focus-visible,\.pos-ui \.pos-radio input:focus-visible\{outline:2px solid var\(--pos-accent\)/);
 // One request at a time; success closes the form, says it clearly and recomputes ONCE through the existing dirty flag.
 const declare=src.slice(src.indexOf('const declare=async'),src.indexOf('const toggle='));
 assert.match(declare,/if\(declaring\.current\)return;declaring\.current=true;setBusy\(true\)/);assert.match(declare,/finally\{declaring\.current=false;setBusy\(false\)\}/);
 assert.match(declare,/setPanel\(null\);setNote\(t\.declareSaved\)/);assert.match(declare,/catch\(e\)\{setDeclareError\(/);
 assert.doesNotMatch(declare,/ensure-fresh|load\(|setTodayDirty|next-best-actions/,'no recomputation of its own');
 assert.match(read('src/ux/zero-friction.ts'),/\/\^evidence\(\\\/\|\$\)\//,'POST evidence already marks Today as dirty (changesNbaInputs)');
 // Colour: the declared tone (slate, person icon), never the verified green.
 assert.match(css,/\.pos-ui \.pos-checks__declared\{color:var\(--pos-status-declared-fg\)/);assert.doesNotMatch(css.slice(css.indexOf('UI-4')),/status-verified|pos-checks__ok/);
 assert.match(src,/<Icon name="declared" size=\{18\} className="pos-checks__declared"\/>/);
 // FR + EN.
 for(const [k,fr,en] of [['declareWarning','Cette information vient de vous. Elle n’est pas considérée comme une preuve vérifiée.','This information comes from you. It is not considered verified evidence.'],
  ['declareMet','Ce critère est rempli','This criterion is met'],['declareNotMet','Ce critère n’est pas rempli','This criterion is not met'],['declareSave','Enregistrer','Save'],
  ['declaredByYou','Déclaré par vous','Declared by you']])assert.ok(src.includes(`${k}:'${fr}'`)&&src.includes(`${k}:'${en}'`),k);
 assert.equal(evidenceStatusLabel('USER_DECLARED',null,'fr'),'Déclaré par vous, sans source (non vérifié)');assert.equal(evidenceStatusLabel('USER_DECLARED',null,'en'),'Declared by you, without a source (not verified)');
 assert.equal(declaredValueLabel(false,'en'),'Criterion not met, according to you');
});
test('flag OFF — the legacy Today panel is untouched; the legacy record only learns to show a declaration without a fake source link',()=>{
 const diff=(f:string)=>execSync(`git diff 2f4dfa3 -- ${f}`,{cwd:ROOT,encoding:'utf8'});
 assert.equal(diff('src/components/TodayPanel.tsx'),'');
 const page=read('app/page.tsx');
 assert.match(page,/\{manual\.map\(e=>e\.status==='USER_DECLARED'\?<div key=\{e\.id\} data-basis="declared"><p>\{declaredValueLabel\(e\.value,locale\)\}/);
 const declaredBranch=page.slice(page.indexOf("e.status==='USER_DECLARED'?"),page.indexOf(':<div key={e.id}><p>{e.excerpt}</p>'));
 assert.doesNotMatch(declaredBranch,/href|verifyEvidence|safeLink/,'no source link, no "verify the source" button');
 // Today 2.0 is only rendered by the v2 shell (UI_V2 + ZF): the flag-OFF path never mounts it.
 assert.match(page,/screen=\{view==='today'&&mode==='live'&&zfOn&&project\?<v2\.TodayV2 /);
});
