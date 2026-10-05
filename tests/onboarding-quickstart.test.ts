// Bloc 15 — quick start (offer → target → review → first Discovery). An activation layer over the existing
// project / ICP / Discovery models: these tests pin that it proposes, never decides, and changes no engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildTargetingProposal,applyEdits,parseTarget,extractLocations,proposalCriteria,readyForDiscovery,canAnalyzeOffer,projectNameFrom} from '../src/domain/onboarding.ts';
import {DEFAULT_CRITERIA,scoreProspect,validateCriteria,type Evidence} from '../src/domain/core.ts';
import {CriterionContextSchema} from '../src/discovery/types.ts';
import {DiscoveryInputSchema} from '../src/discovery/types.ts';
import {evaluateTargetFit} from '../src/discovery/strategies/target-fit.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';

const read=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
const page=await read('../app/page.tsx');
const quick=await read('../src/components/QuickStart.tsx');
const panel=await read('../src/components/DiscoveryPanel.tsx');
const domain=await read('../src/domain/onboarding.ts');
// Code only: the explanatory comments legitimately mention evidence, scoring or authorship.
const code=(src:string)=>src.replace(/\/\/.*$/gm,'').replace(/\{\/\*[\s\S]*?\*\/\}/g,'');
const OFFER='Foodatoi aide les restaurants à recevoir leurs commandes en direct, avec un abonnement fixe sans commission.';
const TARGET='Restaurants indépendants en Occitanie, 1 à 5 établissements, avec commande à emporter';

test('1 — description only: a usable proposal without URL and without AI',()=>{
 const p=buildTargetingProposal({offerText:OFFER,targetText:TARGET});
 assert.equal(p.offerSummary,null,'no AI summary invented');
 assert.equal(p.offer.value,OFFER);assert.equal(p.offer.origin,'user');
 assert.deepEqual(p.discovery,{query:'restaurants indépendants',location:'Occitanie',categories:['restaurant']});
 assert.equal(readyForDiscovery(p),true);assert.deepEqual(p.missing,[]);
 assert.equal(canAnalyzeOffer(OFFER),false,'no URL → the existing analysis route cannot be called');
 assert.match(quick,/if\(aiPossible&&useAi&&!analysis\)/,'the AI step only runs when possible AND opted in');
});
test('2 — with a URL: the existing analyze-company route, with its own input rules; the site is never read',()=>{
 assert.equal(canAnalyzeOffer(OFFER,'https://www.foodatoi.fr'),true);
 assert.equal(canAnalyzeOffer('trop court','https://www.foodatoi.fr'),false,'the route needs 30+ characters');
 assert.equal(canAnalyzeOffer(OFFER,'javascript:alert(1)'),false);
 assert.match(page,/analyzeOffer:async\(id,url,text\)=>\{const r=await api\('analyze-company','POST',\{source_url:url,text,project_id:id\}\);/);
 assert.equal(projectNameFrom(OFFER,'https://www.foodatoi.fr','Occitanie'),'Foodatoi · Occitanie');
 assert.match(fr['quick.urlHonesty'],/ne lit pas votre site/);assert.match(fr['quick.aiOptIn'],/1 analyse d’offre/);
});
test('3 — ICP proposal: type of business, area and observable needs come from the user’s own words',()=>{
 assert.deepEqual(parseTarget(TARGET),{query:'restaurants indépendants',categories:['restaurant'],locations:['Occitanie'],signals:['commande à emporter'],notes:['1 à 5 établissements']});
 assert.deepEqual(parseTarget('PME industrielles de Haute-Garonne, 10-50 salariés, ayant un site e-commerce').locations,['Haute-Garonne']);
 assert.deepEqual(parseTarget('Cabinets comptables à Lyon qui proposent la paie en ligne').signals,['paie en ligne']);
 assert.deepEqual(extractLocations('agences immobilières'),[],'no area written → none invented');
 const p=buildTargetingProposal({offerText:OFFER,targetText:'agences immobilières'});
 assert.ok(p.missing.includes('location'));assert.equal(readyForDiscovery(p),false,'no area → Discovery is not proposed until the user gives one');
});
test('4 — proposed criteria: the existing default criteria, same keys and weights, valid for the existing ICP route',()=>{
 const c=proposalCriteria(['restaurant'],['Occitanie'],['commande à emporter']);
 assert.deepEqual(c.map(x=>[x.key,x.label,x.weight]),DEFAULT_CRITERIA.map(x=>[x.key,x.label,x.weight]));
 assert.doesNotThrow(()=>validateCriteria(c));
 for(const x of c)assert.doesNotThrow(()=>CriterionContextSchema.parse(x),x.key);
 assert.deepEqual(c[0].rules,{type:'target_fit',config:{match:'any_defined',categories:['restaurant'],locations:['Occitanie']}});
 assert.deepEqual(c[1].rules,{type:'need_fit',config:{signals:['commande à emporter']}});
 assert.equal(c[2].rules,undefined);assert.equal(c[3].rules,undefined);
 // The rule is read by the existing deterministic matcher exactly like a hand-written one.
 assert.equal(evaluateTargetFit({lines:['Restaurant de burgers à Toulouse']},c[0].rules!.config).satisfied,true);
});
test('5 — human edits before Discovery rebuild the criteria and the search',()=>{
 const p=buildTargetingProposal({offerText:OFFER,targetText:'agences immobilières'});
 const e=applyEdits(p,{projectName:'X',offer:'Mon offre',categories:['agence'],locations:['Bordeaux','Gironde'],signals:['estimation en ligne'],query:'agences immobilières'});
 assert.equal(readyForDiscovery(e),true);assert.equal(e.locations.origin,'user');
 assert.deepEqual(e.discovery,{query:'agences immobilières',location:'Bordeaux',categories:['agence']});
 assert.deepEqual(e.criteria[0].rules,{type:'target_fit',config:{match:'any_defined',categories:['agence'],locations:['Bordeaux','Gironde']}});
 assert.match(quick,/onClick=\{\(\)=>\{if\(editing&&current\)setProposal\(current\);setEditing\(v=>!v\)\}\}/,'leaving edit mode keeps the edits');
 assert.match(quick,/onApi\.confirm\(projectId!,current\)/,'what is saved is what the user reviewed');
});
test('6 — manual mode stays one click away (before and after the proposal)',()=>{
 assert.match(page,/manual:async\(id,p\)=>\{if\(!id\)\{setModal\('project'\);return\}if\(p\)await saveTargeting\(id,p\.criteria,p\.offer\.value\);quickStartProject\.current=null;setModal\(''\);setView\('icp'\)\}/);
 assert.match(quick,/tr\('quick\.manual'\)/);assert.match(quick,/tr\('quick\.advanced'\)/);
 assert.equal(fr['quick.manual'],'Configurer manuellement');assert.match(fr['quick.advanced'],/Paramètres avancés/);
});
test('7 — AI unavailable / analysis failure: non-blocking fallback to the user’s own text',()=>{
 assert.match(quick,/try\{const a=await onApi\.analyzeOffer\(id,offerUrl\.trim\(\),offerText\.trim\(\)\);setAnalysis\(a\);if\(!a\)setAiNote\(tr\('quick\.aiFailed'\)\)\}\n\s*catch\{setAiNote\(tr\('quick\.aiFailed'\)\)\}\n\s*\}\n\s*setStep\(2\);/,'failure → note, and step 2 anyway');
 assert.match(page,/return typeof r\?\.summary==='string'&&typeof r\?\.target==='string'\?\{summary:r\.summary,target:r\.target\}:null/,'malformed answer → no summary, never a guess');
 assert.match(quick,/aiPossible=aiAvailable&&canAnalyzeOffer\(offerText,offerUrl\)/);
 assert.match(page,/<QuickStart locale=\{locale\} aiAvailable=\{betaActive===true\}/);
});
test('8 — no proposal is ever turned into evidence, a status or a score',()=>{
 const p=buildTargetingProposal({offerText:OFFER,offerUrl:'https://www.foodatoi.fr',targetText:TARGET,aiSummary:'Résumé IA'});
 const json=JSON.stringify(p);
 for(const k of ['VERIFIED','NOT_VERIFIED','INFERRED','CONTRADICTED','evidence','excerpt','verified_by','score'])assert.equal(json.includes(k),false,k);
 assert.doesNotMatch(code(domain),/Evidence|status:|verified_by|scoreProspect/,'the domain builds configuration only');
 assert.doesNotMatch(code(quick),/api\(|evidence|VERIFIED/,'the component calls only the page-provided operations');
 assert.equal(p.offerSummary?.origin,'ai');assert.equal(p.offer.value,OFFER,'the AI summary is a separate proposal, never silently stored as the offer');
 for(const v of [fr['quick.reviewIntro'],fr['quick.criteriaNote'],en['quick.reviewIntro']])assert.doesNotMatch(v,/validé|validated|meilleurs prospects|best prospects|correspondent à votre cible|match your target/i);
 assert.equal(fr['quick.reviewIntro'],'ProspectOS a préparé une proposition de ciblage à partir de votre offre. Vérifiez-la avant de lancer la recherche.');
});
test('9 — scoring unchanged: a proposal-configured project scores exactly like the default one',()=>{
 const c=proposalCriteria(['restaurant'],['Occitanie'],['commande à emporter']);
 const ev=(criterion:string,status:Evidence['status'],verified_by:string|null):Evidence=>({id:criterion+status,criterion,value:true,status,excerpt:'Restaurant à Toulouse',source_url:'https://example.test/',observed_at:new Date().toISOString(),verified_by});
 assert.equal(scoreProspect(c,[]).score,0);assert.equal(scoreProspect(c,[]).coverage,0);
 assert.equal(scoreProspect(c,[ev('target_fit','NOT_VERIFIED',null)]).score,0,'a proposal-driven observation stays at 0 until verified');
 assert.equal(scoreProspect(c,[ev('target_fit','VERIFIED','user')]).score,scoreProspect(DEFAULT_CRITERIA,[ev('target_fit','VERIFIED','user')]).score);
});
test('10 — Discovery unchanged: the form is pre-filled once, never launched; the inputs pass the existing schema',()=>{
 const p=buildTargetingProposal({offerText:OFFER,targetText:TARGET});
 assert.doesNotThrow(()=>DiscoveryInputSchema.parse({project_id:'p1',query:p.discovery.query,location:p.discovery.location,categories:p.discovery.categories,max_results:20}));
 const effect=panel.slice(panel.indexOf('const prefillApplied'),panel.indexOf('const prefillApplied')+400);
 assert.match(effect,/useEffect\(\(\)=>\{if\(!prefill\|\|activeRunId\)return;setFields\(f=>\(\{\.\.\.f,query:f\.query\|\|prefill\.query,location:f\.location\|\|prefill\.location,categories:f\.categories\|\|prefill\.categories\.join\(', '\)\}\)\);/);
 assert.doesNotMatch(effect,/search\(|api\(/,'pre-filling never searches');
 assert.match(panel,/prefill=null,onPrefillUsed\}/,'absent by default: the panel behaves as before');
 assert.match(page,/prefill=\{discoveryPrefill\?\.projectId===projectId\?discoveryPrefill:discoveryPrefillFromIcp\(criteria\)\} onPrefillUsed=\{\(\)=>setDiscoveryPrefill\(null\)\}/);
});
test('11, 12 — auth and billing untouched by the quick start',()=>{
 for(const src of [quick,domain])assert.doesNotMatch(code(src),/\bauth\b|supabase|signIn|signUp|billing|checkout|portal|entitlement|price_/i);
 assert.match(page,/await loadProjects\(t\);await loadAccount\(t\);setMode\('live'\)/,'session entry unchanged');
});
test('14 — existing users: the quick start appears only without a project, for an unfinished onboarding project, or on demand',()=>{
 assert.match(page,/const showQuickStart=mode==='live'&&view==='prospects'&&\(!projects\.length\|\|!!resumeProject\);/);
 assert.match(page,/onClick=\{\(\)=>\{setQuickResume\(null\);setModal\(mode==='live'\?'quickstart':'project'\)\}\}>\{tr\('nav\.newProject'\)\}/);
 assert.match(page,/\{view==='prospects'&&!showQuickStart&&<div className="prospect-grid">/);
});
test('15 — the manual path still works: same creation calls, same starter ICP, same ICP editor',()=>{
 assert.match(page,/async function createLiveProject\(name:string,projectOffer:string,starter:Criterion\[\]\):Promise<Project>\{let orgs=await api\('organizations'\);let org=orgs\[0\]\?\.id;if\(!org\)org=await api\('organizations','POST',\{name:tr\('project\.defaultOrgName'\)\}\);const row=await api\('projects','POST',\{name,organization_id:org,offer:projectOffer\}\);await api\('icps','POST',\{project_id:row\.id,criteria:starter\}\);return \{\.\.\.row,criteria:starter\}\}/);
 assert.match(page,/else p=await createLiveProject\(name,projectOffer,starter\);setProjects\(ps=>\[\.\.\.ps,p\]\);setProjectId\(p\.id\);setSelected\(''\);if\(mode==='live'\)setProspects\(\[\]\);setModal\(''\);setView\('icp'\);setNotice\(tr\('project\.createdNotice'\)\)/);
 assert.match(page,/async function saveIcp\(\)\{await work\(async\(\)=>\{scoreProspect\(weights,\[\]\);if\(mode==='live'\)\{await api\('icps','POST',\{project_id:projectId,criteria:weights\}\);await api\(`projects\/\$\{projectId\}`,'PATCH',\{offer\}\)\}/);
});
test('13 — mobile: one question per step, full-width CTA, advanced settings folded behind a link',async()=>{
 const css=await read('../app/globals.css');
 assert.match(css,/@media\(max-width:700px\)\{\.quickstart\{padding:20px 16px\}[^}]*\}\.quick-actions \.primary\{width:100%\}/);
 assert.match(quick,/\{step===1&&<form[\s\S]*?<\/form>\}/);assert.match(quick,/\{step===2&&<form/);assert.match(quick,/\{step===3&&current&&/);
 assert.equal((quick.match(/<h2 id="quickstart-title">/g)??[]).length,3,'one heading (one question) per step');
});
test('i18n — every quick start key exists in FR and EN',()=>{
 const keys=[...new Set([...quick.matchAll(/'(quick\.[A-Za-z0-9]+)'/g),...panel.matchAll(/'(quick\.[A-Za-z0-9]+)'/g),...page.matchAll(/'(quick\.[A-Za-z0-9]+)'/g)].map(m=>m[1]))];
 for(const k of [...keys,'quick.step1','quick.step2','quick.step3'])assert.ok((fr as Record<string,string>)[k]&&(en as Record<string,string>)[k],k);
});

// ---------------------------------------------------------------- canary inputs (PR #15 review)
test('canary A — simple target: category, area and need come from the user’s words; brand used as project name',()=>{
 const p=buildTargetingProposal({offerText:'Foodatoi permet aux restaurants de recevoir directement leurs commandes click & collect sans commission.',targetText:'Restaurants indépendants en Occitanie, avec commande à emporter.'});
 assert.equal(p.projectName.value,'Foodatoi · Occitanie');
 assert.deepEqual([p.discovery.query,p.categories.value,p.locations.value,p.signals.value],['restaurants indépendants',['restaurant'],['Occitanie'],['commande à emporter']]);
 assert.equal(readyForDiscovery(p),true);
});
test('canary B — a size class is not a sector: category and search "À préciser"; needs split and kept verbatim',()=>{
 const p=buildTargetingProposal({offerText:'Nous accompagnons les PME dans la sécurisation de leur infrastructure informatique.',targetText:'PME de 20 à 200 salariés en Île-de-France ayant des besoins en cybersécurité ou en sécurisation de leur SI.'});
 assert.deepEqual(p.categories.value,[]);assert.equal(p.discovery.query,'');assert.ok(p.missing.includes('category'));
 assert.deepEqual(p.locations.value,['Île-de-France']);
 assert.deepEqual(p.signals.value,['cybersécurité','sécurisation de leur SI']);
 assert.deepEqual(p.notes,['20 à 200 salariés'],'size stays a note, never a rule');
 assert.equal(p.projectName.value,'Mon projet · Île-de-France','a pronoun is never used as a name');
 assert.equal(readyForDiscovery(p),false,'the user completes the search before Discovery');
});
test('canary C — ambiguous input: nothing invented, the user completes then continues',()=>{
 const p=buildTargetingProposal({offerText:'Nous aidons les entreprises à améliorer leurs opérations.',targetText:'Entreprises autour de Toulouse qui pourraient avoir besoin de nous.'});
 assert.deepEqual([p.discovery.query,p.categories.value,p.signals.value],['',[],[]]);
 assert.deepEqual(p.locations.value,['Toulouse']);assert.equal(readyForDiscovery(p),false);
 assert.equal(p.criteria[1].rules,undefined,'no need rule from a wish about the vendor');
 const e=applyEdits(p,{projectName:'',offer:p.offer.value,categories:['garage'],locations:['Toulouse'],signals:['prise de rendez-vous en ligne'],query:'garages automobiles'});
 assert.equal(readyForDiscovery(e),true);
 assert.deepEqual(e.discovery,{query:'garages automobiles',location:'Toulouse',categories:['garage']});
});


// ---------------------------------------------------------------- resume (refresh / return)
import {isStarterIcp,isUnfinishedOnboarding} from '../src/domain/onboarding.ts';
const starter=()=>DEFAULT_CRITERIA.map(c=>({...c}));
test('resume — only an untouched project is an unfinished onboarding; every signal of real use excludes it',()=>{
 const base={projectCount:1,criteria:starter(),prospectCount:0,discoveryRunCount:0};
 assert.equal(isUnfinishedOnboarding(base),true);
 assert.equal(isUnfinishedOnboarding({...base,projectCount:2}),false,'several projects → ambiguous → never');
 assert.equal(isUnfinishedOnboarding({...base,projectCount:0}),false);
 assert.equal(isUnfinishedOnboarding({...base,prospectCount:1}),false,'a prospect → the project is used');
 assert.equal(isUnfinishedOnboarding({...base,discoveryRunCount:1}),false,'a Discovery run → used');
 assert.equal(isUnfinishedOnboarding({...base,discoveryRunCount:null}),false,'unknown history → not resumed');
 const edited=(f:(c:ReturnType<typeof starter>)=>void)=>{const c=starter();f(c);return isUnfinishedOnboarding({...base,criteria:c})};
 assert.equal(edited(c=>{c[0].weight=30;c[1].weight=25}),false,'weights edited');
 assert.equal(edited(c=>{c[2].label='Signal renommé'}),false,'label edited');
 assert.equal(edited(c=>{c[0].rules={type:'target_fit',config:{match:'any_defined',categories:['x']}}}),false,'a rule = configured');
 assert.equal(edited(c=>{c.push({key:'extra',label:'Extra',weight:0}as never)}),false,'criteria added');
 assert.equal(isUnfinishedOnboarding({...base,criteria:buildTargetingProposal({offerText:OFFER,targetText:TARGET}).criteria}),false,'a confirmed quick start is configured');
 assert.equal(isStarterIcp(null),false);
});
test('resume — the page checks the existing read-only Discovery history route; any failure means no resume',()=>{
 assert.match(page,/api\(`projects\/\$\{only\.id\}\/discovery\?limit=1&offset=0`\)\.then\(runs=>\{if\(!cancelled\)setResumeProjectId\(Array\.isArray\(runs\)&&isUnfinishedOnboarding\(\{projectCount:1,criteria:only\.criteria,prospectCount:0,discoveryRunCount:runs\.length\}\)\?only\.id:null\)\}\)\.catch\(\(\)=>\{if\(!cancelled\)setResumeProjectId\(null\)\}\)/);
 assert.match(page,/if\(mode!=='live'\|\|!only\|\|!isUnfinishedOnboarding\(\{projectCount:projects\.length,criteria:only\.criteria,prospectCount:prospects\.filter\(p=>p\.project_id===only\.id\)\.length,discoveryRunCount:0\}\)\)\{setResumeProjectId\(null\);return\}/,'local signals first: a used project is excluded before any read');
});
test('resume — the same project id is reused, the saved offer restored, the user continues at step 2 (no second project)',()=>{
 assert.match(page,/resume=\{resumeProject\?\{projectId:resumeProject\.id,offer:resumeProject\.offer\?\?''\}:null\}/);
 assert.match(quick,/const \[projectId,setProjectId\]=useState<string\|null>\(resume\?\.projectId\?\?null\);/);
 assert.match(quick,/const \[step,setStep\]=useState<1\|2\|3>\(resume\?\.offer\.trim\(\)\?2:1\);/,'the offer was saved at step 1: resume at step 2');
 assert.match(quick,/const id=projectId\?\?await onApi\.createProject\(draftName,offerText\.trim\(\)\);/,'an existing project id is never re-created');
 assert.match(page,/createProject:async\(name,projectOffer\)=>\{const first=!projects\.length;const p=await createLiveProject\(name,projectOffer,DEFAULT_CRITERIA\.map\(c=>\(\{\.\.\.c\}\)\)\);if\(first\)\{quickStartProject\.current=p\.id;setResumeProjectId\(p\.id\)\}/,'the in-progress quick start keeps its own project without a remount');
});
test('resume — a configured account never sees the quick start by itself; "Nouveau projet" still creates on demand',()=>{
 assert.match(page,/onClick=\{\(\)=>\{setQuickResume\(null\);setModal\(mode==='live'\?'quickstart':'project'\)\}\}>\{tr\('nav\.newProject'\)\}/);
 assert.doesNotMatch(page,/setResumeProjectId\(projects\[0\]\.id\)/,'never "one project = resume"');
});

test('canary fix — while the quick start is shown, the header no longer offers the historical "Créer un projet" form',()=>{
 assert.match(page,/\{!showQuickStart&&<button disabled=\{busy\} className="primary" onClick=\{\(\)=>\{setQuickResume\(null\);setModal\(project\?'prospect':mode==='live'\?'quickstart':'project'\)\}\}>/);
 // Live: the manual form is reached only through the quick start's "Configurer manuellement"; the remaining
 // direct entry is the historical empty state, kept for the demo (and never shown with the quick start).
 assert.equal([...page.matchAll(/setModal\((?:project\?'prospect':)?'project'\)/g)].length,2);
 assert.match(page,/manual:async\(id,p\)=>\{if\(!id\)\{setModal\('project'\);return\}/);
 assert.match(page,/const showQuickStart=mode==='live'&&view==='prospects'&&\(!projects\.length\|\|!!resumeProject\);/);
});


// ---------------------------------------------------------------- activation CTAs (second canary)
import {discoveryPrefillFromIcp} from '../src/domain/onboarding.ts';
const emptyBlock=page.slice(page.indexOf('className="empty activation-empty"'),page.indexOf('className="empty activation-empty"')+1200);
test('1 — 0 prospect + generic ICP: primary "Préparer mon ciblage" opens the quick start on THIS project',()=>{
 assert.match(page,/\{!visible\.length&&mode==='live'&&project&&!all\.length&&<div className="empty activation-empty">\{isStarterIcp\(project\.criteria\)/);
 assert.match(emptyBlock,/<button className="primary" disabled=\{busy\} onClick=\{\(\)=>\{setQuickResume\(\{projectId:project\.id,offer:project\.offer\?\?''\}\);setModal\('quickstart'\)\}\}>\{tr\('activation\.prepareTargeting'\)\}<\/button>/);
 assert.match(page,/onApi=\{quickApi\} resume=\{quickResume\}\/><\/section><\/div>\}/,'the dialog resumes the chosen project id (no second project)');
 assert.equal(fr['activation.prepareTargeting'],'Préparer mon ciblage');
});
test('2 — 0 prospect + configured ICP: primary "Trouver des prospects"',()=>{
 assert.match(emptyBlock,/:<><h3>\{tr\('activation\.findTitle'\)\}<\/h3><p>\{tr\('activation\.findBody'\)\}<\/p><button className="primary" disabled=\{busy\} onClick=\{openDiscovery\}>\{tr\('actions\.findProspects'\)\}<\/button><\/>\}/);
 assert.doesNotMatch(fr['activation.findBody']+fr['activation.targetBody'],/Offre & ICP/,'the old instructions are gone from the live empty state');
});
test('3 — manual add stays available, as a secondary action, in both cases',()=>{
 assert.match(emptyBlock,/<button type="button" className="text-button activation-manual" disabled=\{busy\} onClick=\{\(\)=>setModal\('prospect'\)\}>\{tr\('activation\.addManually'\)\}<\/button><\/div>\}/);
 assert.match(page,/modal==='prospect'\?tr\('modal\.addProspect'\)/,'the existing "Ajouter un établissement" dialog is unchanged');
 assert.match(page,/else if\(modal==='prospect'\)addProspect\(f\)/);
 assert.equal(fr['activation.addManually'],'Ajouter un établissement manuellement');
});
test('4 — live account without a project, outside the Prospects view: "Créer un projet" opens the quick start',()=>{
 assert.match(page,/setModal\(project\?'prospect':mode==='live'\?'quickstart':'project'\)/);
});
test('5, 6, 7 — Discovery outside the quick start: zone and categories from the saved target_fit only',()=>{
 const icp=proposalCriteria(['restaurant','pizzeria'],['Occitanie'],[]);
 assert.deepEqual(discoveryPrefillFromIcp(icp),{query:'',location:'Occitanie',categories:['restaurant','pizzeria'],origin:'icp'},'never a fabricated query');
 assert.deepEqual(discoveryPrefillFromIcp(proposalCriteria([],['Toulouse','Albi'],[]))?.location??null,null,'several zones → ambiguous → no prefill at all when nothing else');
 assert.deepEqual(discoveryPrefillFromIcp(proposalCriteria(['garage'],['Toulouse','Albi'],[])),{query:'',location:'',categories:['garage'],origin:'icp'},'several zones → zone left empty');
 assert.equal(discoveryPrefillFromIcp(DEFAULT_CRITERIA),null,'no target_fit → fields left empty');
 assert.equal(discoveryPrefillFromIcp(null),null);
 assert.equal(discoveryPrefillFromIcp([{...DEFAULT_CRITERIA[0],rules:{type:'target_fit',config:{match:'any_defined',locations:[42 as never,'']}}},...DEFAULT_CRITERIA.slice(1)]),null,'malformed values ignored');
});
test('8, 9 — a prefill never overwrites the form nor a reopened past search',()=>{
 assert.match(panel,/setFields\(f=>\(\{\.\.\.f,query:f\.query\|\|prefill\.query,location:f\.location\|\|prefill\.location,categories:f\.categories\|\|prefill\.categories\.join\(', '\)\}\)\)/);
 assert.match(panel,/useEffect\(\(\)=>\{if\(!prefill\|\|activeRunId\)return;/,'a reopened run (activeRunId) is never touched');
});
test('10, 11 — no Discovery launched, no quota: the prefill is computed locally and only fills the form',()=>{
 assert.doesNotMatch(code(domain.slice(domain.indexOf('export function discoveryPrefillFromIcp'))),/api\(|fetch\(/);
 const effect=panel.slice(panel.indexOf('const prefillApplied'),panel.indexOf('const prefillApplied')+460);
 assert.doesNotMatch(effect,/search\(|api\(/);
 assert.match(panel,/const prefillApplied=useRef\(!!prefill&&!activeRunId&&prefill\.origin!=='icp'\);/,'an ICP prefill never preselects the paid source');
 assert.match(fr['quick.discoveryFromIcp'],/complétez la recherche/);
});
test('12 — demo unchanged: the live-only activation block never replaces the demo empty state',()=>{
 assert.match(page,/\{!visible\.length&&!\(mode==='live'&&project&&!all\.length\)&&<div className="empty"><h3>\{tr\('prospects\.emptyTitle'\)\}<\/h3>/);
 assert.match(page,/\{project&&<div className="empty-steps">/);
 for(const k of ['activation.targetTitle','activation.targetBody','activation.findTitle','activation.findBody','activation.prepareTargeting','activation.addManually','quick.discoveryFromIcp'])assert.ok((fr as Record<string,string>)[k]&&(en as Record<string,string>)[k],k);
});
test('canary — Discovery already open → "+ Nouveau projet" → quick start → confirm: a fresh form gets the reviewed prefill',()=>{
 // The panel was mounted behind the quick start (for the project created at step 1, with no targeting yet) and
 // applies its prefill only at mount: the confirmation must remount it, and only the confirmation does.
 assert.match(page,/<DiscoveryPanel key=\{`\$\{mode\}:\$\{projectId\}:\$\{discoveryMount\}`\}/);
 assert.equal((page.match(/setDiscoveryMount\(/g)??[]).length,1,'only the quick start confirmation forces a new Discovery form');
 const confirm=page.slice(page.indexOf('confirm:async(id,p)=>'),page.indexOf('manual:async(id,p)=>'));
 // Since the register: the reviewed headcount range travels with the prefill (a structured filter, never a launch).
 assert.match(confirm,/setDiscoveryPrefill\(\{projectId:id,\.\.\.p\.discovery,employeeRange:p\.employeeRange\}\);setDiscoveryMount\(n=>n\+1\);/);
 assert.doesNotMatch(confirm,/discovery'\s*,\s*'POST'|search\(/,'the confirmation never launches a search');
 // Foodatoi: the reviewed proposal is what the remounted form receives (query = validated target, zone, categories)
 const p=buildTargetingProposal({offerText:'Foodatoi permet aux restaurants de recevoir directement leurs commandes à emporter sans commission.',offerUrl:'',targetText:'Restaurants indépendants en Occitanie, avec commande à emporter.'});
 assert.deepEqual(p.discovery,{query:'restaurants indépendants',location:'Occitanie',categories:['restaurant']});
 // existing projects: the key only changes on that confirmation, a reopened run / a typed search is never reset
 assert.match(panel,/useEffect\(\(\)=>\{if\(!prefill\|\|activeRunId\)return;/);
});
