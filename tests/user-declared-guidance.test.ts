// UI-4 guidance — a FIT made SUFFICIENT (estimated ≥ watchMin) by the person's own declarations is not a documented one:
// while ICP criteria stay unknown and the verified FIT is below what CONTACT needs, Today keeps "Compléter les
// informations", pointed at the criteria still unknown only. Today's guidance only: no engine, scoring, threshold,
// fingerprint or database change. Quick = the staging canary (6XPOS) as read on 2026-10-18; no network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {primaryActionOf,cardOf,undocumentedOf,CONTACT_VERIFIED_FIT_MIN,type TodayRow} from '../src/nba/today.ts';
import {todayV2} from '../src/ui/v2/today/model.ts';
import {buildOpportunity,NBA_DEFAULT_CONFIG,type NbaInput,type Opportunity} from '../src/nba/engine.ts';
import type {Criterion} from '../src/domain/core.ts';

const ROOT=new URL('..',import.meta.url);
const T='Restauration avec point de vente physique en Occitanie',L='Indépendant ou petit réseau : décision d’achat locale (pas une grande chaîne aux achats centralisés)',
 N='Besoin d’un canal direct : commande directe, click & collect, fidélité, moindre dépendance aux plateformes',C='Canal de contact professionnel documenté';
// The recommendation the Preview stored for Quick after the two canary declarations (a0bf275f, 2026-10-18 17:06 UTC).
const QUICK_STORED_PROFILE={state:'SUFFICIENT',level:71,verified_score:35,verified_coverage:35,coverage:85,supporting:[T,L,N],missing:[C],against:[],
 verified_supporting:[T],declared:[L,N],declared_false:[]};
const row=(profile:Record<string,unknown>|null,o:Partial<TodayRow>={}):TodayRow=>({id:'a',prospect_id:'p',recommended_action:'WATCH',rule:'SOME_TIMING',state:'PENDING',
 opportunity_score:50,fit_score:35,fit_basis:'verified',intent_score:0,timing_score:20,freshness_score:80,evidence_quality_score:50,primary_kind:'signal',
 primary_signal_type:'EXPANSION',primary_evidence_status:'VERIFIED',signal_age_days:26,primary_detail:{signal_id:'s',geo_relevance:'MATCH',place:'Hérault (34)'},
 scores:profile?{fit:{profile}}:null,target:null,explanation:{why_this_account:[],why_now:[],why_this_action:[],inferred:[],unknown:[]},prospects:{name:'Quick'},...o} as TodayRow);
const card=(r:TodayRow)=>{const v=todayV2([r],'fr');return [...v.cards,...v.watched].find(c=>c.id===r.id)!};

test('G — QUICK (staging state): 1 verified + 2 declared + 1 unknown → "Compléter les informations", only the unknown criterion to document',()=>{
 const r=row(QUICK_STORED_PROFILE);
 assert.deepEqual(primaryActionOf(r),{kind:'VERIFY_INFORMATION'});
 const c=card(r);
 assert.equal(c.action.kind,'VERIFY_INFORMATION');assert.equal(c.action.label,'Compléter les informations');assert.equal(c.section,'verify');
 assert.equal(c.note,'1 information à documenter.');
 assert.deepEqual(c.level2.missingItems,[{label:C,basis:'undocumented'}],'the panel lists the one criterion still unknown');
 assert.deepEqual(c.level2.favourableItems,[{label:T,basis:'verified'},{label:L,basis:'declared'},{label:N,basis:'declared'}],'two "Déclaré par vous", never green');
 assert.deepEqual(undocumentedOf(r),[C]);
});
test('G — QUICK through the engine: estimated 71, verified 35, WATCH, never CONTACT, and the same guidance',()=>{
 const CRITERIA:Criterion[]=[{key:'target_fit',label:T,weight:35},{key:'local_decision',label:L,weight:25},{key:'need_fit',label:N,weight:25},{key:'contactability',label:C,weight:15}];
 const ev=[{id:'v',criterion:'target_fit',value:true,status:'VERIFIED',excerpt:'Quick ouvre un nouveau restaurant aux portes de Montpellier.',source_url:'https://actu.fr/occitanie/le-cres_34090/quick.html',observed_at:'2026-09-20T00:00:00Z',verified_by:'u'},
  {id:'d1',criterion:'local_decision',value:true,status:'USER_DECLARED',excerpt:null,source_url:null,observed_at:'2026-10-18T16:43:44Z',verified_by:null,note:'Test canary UI-4'},
  {id:'d2',criterion:'need_fit',value:true,status:'USER_DECLARED',excerpt:null,source_url:null,observed_at:'2026-10-18T17:06:24Z',verified_by:null,note:'Test canary UI-4 refresh'}];
 const sig={id:'s',provider:'discovery_recycled',signal_type:'expansion',status:'VERIFIED',title:'Quick — Hérault : un nouveau Quick ouvre dans cette commune',excerpt:'Quick poursuit son développement autour de Montpellier (Hérault).',
  source_url:'https://infoccitanie.fr/herault-un-nouveau-quick/',source_domain:'infoccitanie.fr',source_type:'search_snippet',confidence:0.6,event_date:null,published_at:'2026-09-22T12:48:02Z',
  observed_at:'2026-10-13T23:49:49Z',matched_terms:[],raw_metadata:{origin:'signal_discovery',location:{text:'Hérault (34)',basis:'EVENT_MENTION',regions:['Occitanie'],departments:['34']}}};
 const o:Opportunity=buildOpportunity({prospect:{id:'q',project_id:'p',name:'Quick',status:'À analyser'},criteria:CRITERIA,evidence:ev,signals:[sig],publicContent:[],profile:null,now:new Date('2026-10-18T17:10:00Z')} as unknown as NbaInput);
 const p=o.scores.fit.profile;
 assert.deepEqual([o.recommended_action,p.level,p.verified_score,p.verified_coverage,o.scores.evidence_quality.score,p.state],['WATCH',71,35,35,50,'SUFFICIENT']);
 const r=row(o.scores.fit.profile as unknown as Record<string,unknown>,{recommended_action:o.recommended_action,primary_evidence_status:'VERIFIED'});
 assert.equal(cardOf(r).primary.kind,'VERIFY_INFORMATION');assert.deepEqual(cardOf(r).details.missing,[C]);
});
test('A — SUFFICIENT estimated + declaration + unknown criterion + verified FIT below CONTACT → completion CTA',()=>{
 assert.equal(primaryActionOf(row({...QUICK_STORED_PROFILE,verified_score:0,verified_supporting:[],declared:[T,L,N]})).kind,'VERIFY_INFORMATION');
 assert.equal(primaryActionOf(row({...QUICK_STORED_PROFILE,verified_score:CONTACT_VERIFIED_FIT_MIN-1})).kind,'VERIFY_INFORMATION','just below the threshold');
});
test('B — SUFFICIENT without any declaration: the historical behaviour, exactly (main\'s primaryActionOf on a grid)',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ui4-today-main-'));const f=join(dir,'src/nba/today.ts');mkdirSync(join(dir,'src/nba'),{recursive:true});
 writeFileSync(f,execSync('git show 2f4dfa3:src/nba/today.ts',{cwd:ROOT,encoding:'utf8'}).replace(/from '(\.{1,2}\/[^']+)'/g,(_,rel)=>`from '${new URL(rel,new URL('src/nba/today.ts',ROOT)).href}'`));
 const main=await import(f) as typeof import('../src/nba/today.ts');
 let n=0;
 for(const action of ['CONTACT','ENGAGE','WATCH','WAIT','DISMISS'] as const)for(const status of ['VERIFIED','INFERRED',null])for(const state of ['SUFFICIENT','INCOMPLETE','UNKNOWN','KNOWN_LOW',undefined])
  for(const missing of [[],[C],[L,C]])for(const verified of [0,35,59,60,85,undefined])for(const declared of [undefined,[]]){
   const r=row(state===undefined&&verified===undefined?null:{state,missing,supporting:[T],verified_score:verified,...(declared?{declared}:{})},{recommended_action:action,primary_evidence_status:status});
   assert.deepEqual(primaryActionOf(r),main.primaryActionOf(r),JSON.stringify({action,status,state,missing,verified,declared}));
   const {declared:_d,declaredFalse:_f,verified:_v,...details}=cardOf(r).details;
   assert.deepEqual({...cardOf(r),details},main.cardOf(r),'the card, UI-4 detail fields aside');n++;
  }
 assert.ok(n>2000,String(n));
 assert.equal(primaryActionOf(row({...QUICK_STORED_PROFILE,declared:[]})).kind,'NONE','the Quick profile without declarations: just watched, as before');
});
test('C — declarations but nothing unknown left → no completion CTA (a criterion declared NOT met counts as answered)',()=>{
 assert.equal(primaryActionOf(row({...QUICK_STORED_PROFILE,missing:[]})).kind,'NONE');
 const answered=row({...QUICK_STORED_PROFILE,missing:[C],declared_false:[C]});
 assert.equal(primaryActionOf(answered).kind,'NONE');assert.deepEqual(undocumentedOf(answered),[]);
 assert.deepEqual(card(answered).level2.missingItems,[{label:C,basis:'declared_false'}],'shown as "Déclaré non rempli par vous", never "Non documenté"');
});
test('D — a verified FIT already enough for CONTACT never gets the CTA back because of declarations',()=>{
 for(const v of [CONTACT_VERIFIED_FIT_MIN,85,100])assert.equal(primaryActionOf(row({...QUICK_STORED_PROFILE,verified_score:v})).kind,'NONE',String(v));
 assert.equal(primaryActionOf(row({...QUICK_STORED_PROFILE,verified_score:undefined})).kind,'NONE','no verified score stored: no guess');
 assert.equal(CONTACT_VERIFIED_FIT_MIN,NBA_DEFAULT_CONFIG.fit.contactMin,'kept equal to the engine threshold');
 // Other actions keep their own CTA: only WATCH is concerned.
 assert.equal(primaryActionOf(row(QUICK_STORED_PROFILE,{recommended_action:'WAIT'})).kind,'NONE');
 assert.equal(primaryActionOf(row(QUICK_STORED_PROFILE,{primary_evidence_status:'INFERRED'})).kind,'VERIFY_SIGNAL','a signal to check still comes first');
});
test('E — a declaration is never presented as evidence, nor as unknown',()=>{
 const c=card(row(QUICK_STORED_PROFILE));
 for(const label of [L,N]){
  assert.ok(c.level2.favourableItems.some(f=>f.label===label&&f.basis==='declared'));
  assert.ok(!c.level2.missingItems.some(m=>m.label===label),'never "non documenté"');
 }
 assert.ok(!c.level2.missing.includes('Le signal lui-même : sa source n’a pas encore été vérifiée.'),'no "evidence to verify" line for a declaration');
 assert.equal(c.note,'1 information à documenter.','one criterion to document, the declarations are not counted');
});
test('F — engine, scoring, fingerprint, CONTACT / OFF_TARGET / Outreach code untouched by this change',()=>{
 const diff=execSync('git diff 11b2e11 8a927c4 -- src/nba/engine.ts src/domain src/nba/content.ts src/outreach src/nba/api.ts db app/api',{cwd:ROOT,encoding:'utf8'});
 assert.equal(diff,'','only Today guidance changed');
});
