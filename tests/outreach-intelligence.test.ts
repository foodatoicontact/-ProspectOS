// O1/O2 — Outreach intelligence: the generated message kept apart from the human version, a usable APPROVED step,
// a personal style profile learned only from the user's own edits (few-shot, style only), public content kept apart
// from evidence / signals / scores, a deterministic angle selector, and an AI composer that falls back to the
// rule-based template on any failure or unsupported claim. Modules are imported lazily so each case fails on its own
// (RED) while they do not exist yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scoreProspect,DEFAULT_CRITERIA,type Evidence} from '../src/domain/core.ts';
import {scoreIntent,type IntentSignal} from '../src/domain/intent.ts';

const load=async(path:string)=>{try{return await import(path)}catch{return null}};
const need=(m:any,name:string)=>{assert.ok(m,`module for ${name} exists`);return m};
const src=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
const ROUTE='../app/api/v1/[...path]/route.ts';

const NOW=new Date('2026-10-10T12:00:00Z');
const day=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
const ev=(o:Partial<Evidence>={}):Evidence=>({id:'e1',criterion:'need_fit',value:true,status:'VERIFIED',source_url:'https://kerlan.example/a-propos',excerpt:'Kerlan exploite trois sites de production en Bretagne',observed_at:day(5),verified_by:'u1',...o});
const sig=(o:Partial<IntentSignal>={}):IntentSignal=>({id:'s1',signal_type:'hiring_role',status:'VERIFIED',title:'Kerlan recrute un RSSI',excerpt:'Kerlan recrute un responsable de la sécurité des systèmes d’information.',
 source_url:'https://jobs.example/kerlan',source_domain:'jobs.example',confidence:0.8,event_date:null,published_at:day(4),observed_at:day(1),matched_terms:[],...o});
const pc=(o:Record<string,unknown>={})=>({id:'pc1',status:'VERIFIED',pinned:false,source_type:'user_provided',source_url:'https://www.linkedin.com/posts/kerlan-123',author:'Kerlan',
 content:'Nous ouvrons un nouvel atelier de conditionnement à Vannes en 2027.',published_at:day(3),observed_at:day(2),...o});
const PROFILE={types:{hiring_role:25},terms:[]};

// ——— O1.1 generated_content + workflow ———
test('A — generation stores the generated text twice (generated_content = content); an edit never sends generated_content',async()=>{
 const route=await src(ROUTE);
 assert.match(route,/generated_content:composed\.text,content:composed\.text/,'the insert keeps the original next to the editable copy');
 const patch=route.slice(route.indexOf("resource==='outreach'&&request.method==='PATCH'"),route.indexOf("resource==='events'"));
 assert.doesNotMatch(patch,/generated_content/,'the PATCH route never writes generated_content');
});

test('B — Copy sends no content: it only marks the APPROVED message USED (the original and the approved text stay)',async()=>{
 const page=await src('../app/page.tsx');
 assert.match(page,/api\(`outreach\/\$\{draftId\}`,'PATCH',\{status:'USED'\}\)/);
 assert.doesNotMatch(page,/status:'USED',content:draft/);
});

test('C — APPROVED is a real step: Save and Approve in the UI; the API approves only a DRAFT and uses only an APPROVED message',async()=>{
 const page=await src('../app/page.tsx');
 assert.match(page,/tr\('outreach\.save'\)/);assert.match(page,/tr\('outreach\.approve'\)/);
 assert.match(page,/draftStatus==='APPROVED'&&<button[^>]*onClick=\{copyApproved\}/);
 const route=await src(ROUTE);
 assert.match(route,/OUTREACH_TRANSITIONS/);
 const wf=need(await load('../src/outreach/workflow.ts'),'workflow');
 assert.deepEqual(wf.allowedFrom('APPROVED'),['DRAFT']);assert.deepEqual(wf.allowedFrom('USED'),['APPROVED']);assert.deepEqual(wf.allowedFrom('DISCARDED'),['DRAFT','APPROVED']);
 assert.deepEqual(wf.allowedFrom('SAVE'),['DRAFT'],'only a DRAFT can be edited');
});

// ——— O1.2 / O1.3 style ———
test('E — style examples: same user only, really edited, newest first, at most 5; company names masked',async()=>{
 const st=need(await load('../src/outreach/style.ts'),'style');
 const row=(i:number,o:Record<string,unknown>={})=>({id:`o${i}`,created_by:'me',generated_content:`Bonjour l’équipe ACME${i}, texte ${i}.`,content:`Bonjour ACME${i}, texte ${i} revu.`,created_at:day(i),prospect_name:`ACME${i}`,...o});
 const rows=[...Array.from({length:8},(_,i)=>row(i+1)),row(20,{created_by:'other'}),row(21,{content:'Bonjour l’équipe ACME21, texte 21.'}),row(22,{generated_content:null})];
 const ex=st.pickStyleExamples(rows,'me');
 assert.equal(st.MAX_STYLE_EXAMPLES,5);assert.equal(ex.length,5);
 assert.deepEqual(ex.map((e:any)=>e.id),['o1','o2','o3','o4','o5']);
 assert.ok(ex.every((e:any)=>!/ACME/.test(e.generated+e.edited)),'the old prospect is never carried over');
 assert.deepEqual(st.pickStyleExamples(rows,'nobody'),[]);
});

test('D (logic) — style profile: defaults, strict validation, instructions ≤ 1500, banned phrases detected accent/case-insensitively',async()=>{
 const st=need(await load('../src/outreach/style.ts'),'style');
 assert.equal(st.DEFAULT_STYLE_PROFILE.tone,'professional_conversational');assert.equal(st.DEFAULT_STYLE_PROFILE.address_mode,'auto');assert.equal(st.DEFAULT_STYLE_PROFILE.length,'short');
 assert.ok(st.DEFAULT_STYLE_PROFILE.banned_phrases.includes('Je me permets de vous contacter'));
 assert.equal(st.validateStyleProfile({...st.DEFAULT_STYLE_PROFILE,instructions:'x'.repeat(1501)}).ok,false);
 assert.equal(st.validateStyleProfile({...st.DEFAULT_STYLE_PROFILE,user_id:'someone'}).ok,false,'no client-chosen owner');
 assert.deepEqual(st.bannedPhrasesIn('Bonjour, je me PERMETS de vous contacter.',['Je me permets de vous contacter']),['Je me permets de vous contacter']);
});

// ——— O2.2 angle selector ———
test('H — a REJECTED (or unreviewed) public content is never an angle',async()=>{
 const an=need(await load('../src/outreach/angle.ts'),'angle');
 for(const status of ['REJECTED','PENDING_REVIEW'])assert.equal(an.selectAngle({publicContent:[pc({status,pinned:status==='REJECTED'?false:false})],signals:[],profile:PROFILE,evidence:[],evidenceIds:[],now:NOW}).type,'generic');
});
test('I — PINNED + VERIFIED public content wins over a verified signal',async()=>{
 const an=need(await load('../src/outreach/angle.ts'),'angle');
 const a=an.selectAngle({publicContent:[pc({pinned:true})],signals:[sig()],profile:PROFILE,evidence:[ev()],evidenceIds:['e1'],now:NOW});
 assert.equal(a.type,'public_content_pinned');assert.equal(a.source_id,'pc1');assert.equal(a.source_url,'https://www.linkedin.com/posts/kerlan-123');
});
test('J — a VERIFIED signal wins over recent, not pinned public content',async()=>{
 const an=need(await load('../src/outreach/angle.ts'),'angle');
 const a=an.selectAngle({publicContent:[pc()],signals:[sig()],profile:PROFILE,evidence:[ev()],evidenceIds:['e1'],now:NOW});
 assert.equal(a.type,'signal');assert.equal(a.source_id,'s1');
 assert.equal(an.selectAngle({publicContent:[pc()],signals:[],profile:PROFILE,evidence:[ev()],evidenceIds:['e1'],now:NOW}).type,'public_content','then recent verified public content');
 assert.equal(an.selectAngle({publicContent:[pc({published_at:day(200),observed_at:day(200)})],signals:[],profile:PROFILE,evidence:[],evidenceIds:[],now:NOW}).type,'generic','old public content is not "recent"');
});
test('K — fallback to the verified evidence the template quotes',async()=>{
 const an=need(await load('../src/outreach/angle.ts'),'angle');
 const a=an.selectAngle({publicContent:[],signals:[sig({status:'REJECTED'})],profile:PROFILE,evidence:[ev()],evidenceIds:['e1'],now:NOW});
 assert.equal(a.type,'evidence');assert.equal(a.source_id,'e1');
});
test('L — fallback to generic; deterministic (same input, same angle)',async()=>{
 const an=need(await load('../src/outreach/angle.ts'),'angle');
 const input={publicContent:[pc({id:'b',pinned:true}),pc({id:'a',pinned:true})],signals:[],profile:PROFILE,evidence:[],evidenceIds:[],now:NOW};
 assert.deepEqual(an.selectAngle(input),an.selectAngle({...input,publicContent:[...input.publicContent].reverse()}));
 assert.equal(an.selectAngle({publicContent:[],signals:[],profile:PROFILE,evidence:[],evidenceIds:[],now:NOW}).type,'generic');
});

// ——— O2.3 persistence ———
test('M — the outreach row keeps its angle, public_content_ids, signal_ids, evidence_ids and style profile',async()=>{
 const route=await src(ROUTE);
 assert.match(route,/angle:composed\.angle,public_content_ids:composed\.public_content_ids,signal_ids:composed\.signal_ids,evidence_ids:composed\.evidence_ids,style_profile_id:styleProfileId/);
 const cp=need(await load('../src/outreach/compose.ts'),'compose');
 const out=cp.composeRuleBased({name:'Kerlan',offer:'Nous auditons la sécurité des sites industriels.',criteria:DEFAULT_CRITERIA,evidence:[ev()],signals:[],profile:PROFILE,publicContent:[pc({pinned:true})],now:NOW,locale:'fr'});
 assert.equal(out.angle.type,'public_content_pinned');assert.deepEqual(out.public_content_ids,['pc1']);
 assert.match(out.text,/« Nous ouvrons un nouvel atelier de conditionnement à Vannes en 2027 »/,'quoted verbatim');
});

// ——— O2.4 AI composer + fact guard ———
const composerInput=()=>({name:'Kerlan',offer:'Nous auditons la sécurité des sites industriels.',locale:'fr' as const,angle:{type:'signal',source_id:'s1',label:'Kerlan recrute un RSSI',reason:'signal',source_url:'https://jobs.example/kerlan',observed_at:day(1),
 excerpt:'Kerlan recrute un responsable de la sécurité des systèmes d’information.'},sources:['Kerlan recrute un responsable de la sécurité des systèmes d’information.'],style:null as any,examples:[{id:'o9',generated:'Bonjour l’équipe {entreprise}, …',edited:'Bonjour {entreprise}, …',prospect_name:'Société X'}],
 fallback:{text:'Bonjour l’équipe Kerlan, message de secours.',evidence_ids:[],signal_ids:['s1'],public_content_ids:[]}});
test('N — any AI failure (error, timeout, invalid JSON, too long) → the rule-based message, with the reason',async()=>{
 const ai=need(await load('../src/outreach/ai-composer.ts'),'ai composer');
 for(const call of [async()=>{throw Error('AI_UNAVAILABLE')},async()=>'not json',async()=>JSON.stringify({message:'x'.repeat(5000)}),async()=>JSON.stringify({text:'wrong key'})]){
  const r=await ai.composeWithAi(composerInput(),call);
  assert.equal(r.provider,'rule_based_v1');assert.equal(r.text,'Bonjour l’équipe Kerlan, message de secours.');assert.ok(r.fallback_reason);
 }
 const ok=await ai.composeWithAi(composerInput(),async()=>JSON.stringify({message:'Bonjour, j’ai vu que Kerlan recrute un responsable de la sécurité des systèmes d’information. Nous auditons la sécurité des sites industriels. Seriez-vous ouvert à un court échange ?'}));
 assert.equal(ok.provider,'ai_composer_v1',JSON.stringify(ok));
});
test('O — an unsupported claim, invented quote, invented figure, banned phrase or an old example’s company → fail closed',async()=>{
 const ai=need(await load('../src/outreach/ai-composer.ts'),'ai composer');
 const bad=['Bonjour, bravo pour votre levée de fonds récente ! Nous auditons la sécurité des sites industriels.',
  'Bonjour, vous avez écrit « la cybersécurité est notre priorité ». Nous auditons la sécurité des sites industriels.',
  'Bonjour, avec vos 450 salariés, Kerlan recrute un responsable de la sécurité des systèmes d’information.',
  'Je me permets de vous contacter : Kerlan recrute un responsable de la sécurité des systèmes d’information.',
  'Bonjour, comme pour Société X, Kerlan recrute un responsable de la sécurité des systèmes d’information.'];
 for(const message of bad){const r=await ai.composeWithAi(composerInput(),async()=>JSON.stringify({message}));assert.equal(r.provider,'rule_based_v1',message);assert.ok(r.fallback_reason)}
});
test('AI composer prompt: style examples are labelled style-only, no tool, no browsing; the model gets only the angle and verified sources',async()=>{
 const ai=need(await load('../src/outreach/ai-composer.ts'),'ai composer');
 const req=ai.buildComposerRequest(composerInput());
 assert.match(req.system,/jamais des faits|never facts/i);assert.doesNotMatch(JSON.stringify(req),/tools|web_search|browse/i);
 const user=JSON.parse(req.user);assert.deepEqual(Object.keys(user).sort(),['angle','company','examples','language','offer','sources','style']);
});

// ——— F/G public content never moves FIT or INTENT; P copy ≠ contacted ———
test('F/G — FIT and INTENT take no public content: same evidence + same signals ⇒ same scores, whatever the public content',async()=>{
 const fit=()=>scoreProspect(DEFAULT_CRITERIA,[ev()],NOW).score,intent=()=>scoreIntent([sig()],PROFILE,NOW).score;
 const before=[fit(),intent()];
 const an=await load('../src/outreach/angle.ts');
 if(an)for(const p of [pc(),pc({pinned:true}),pc({status:'REJECTED'})])an.selectAngle({publicContent:[p],signals:[sig()],profile:PROFILE,evidence:[ev()],evidenceIds:['e1'],now:NOW});
 assert.deepEqual([fit(),intent()],before);
 for(const f of ['../src/domain/core.ts','../src/domain/intent.ts','../src/domain/feedback.ts','../src/signals/context.ts'])assert.doesNotMatch(await src(f),/public_content|publicContent/,f);
});
test('P — Copy is never "Contacted": the outreach routes never write the prospect status',async()=>{
 const route=await src(ROUTE);
 const outreach=route.slice(route.indexOf("resource==='outreach'&&request.method==='POST'"),route.indexOf("resource==='events'"));
 assert.doesNotMatch(outreach,/from\('prospects'\)\.update/);
 const page=await src('../app/page.tsx');
 const copy=page.slice(page.indexOf('async function copyApproved'),page.indexOf('async function copyApproved')+400);
 assert.ok(copy.length>30,'copyApproved exists');assert.doesNotMatch(copy,/status\('Contacté'\)|Contacté/);
});
test('no LinkedIn scraping: no outreach module fetches anything',async()=>{
 for(const f of ['angle','compose','style','ai-composer','workflow','fact-guard']){
  const s=await src(`../src/outreach/${f}.ts`).catch(()=>null);assert.ok(s,`${f}.ts exists`);
  assert.doesNotMatch(s!,/fetch\(|playwright|puppeteer|cookie/i,f);
 }
});
