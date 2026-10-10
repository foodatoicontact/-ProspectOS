// Signal Engine S8 — pipeline feedback (src/domain/feedback.ts): the contact snapshot and "what produced answers".
// GO criterion: the analytics are reproducible from the snapshots and statuses alone; under 10 contacts no rate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {contactSnapshot,feedbackReport,fitBand,intentBand,ageBand,MIN_SAMPLE,type Snapshot} from '../src/domain/feedback.ts';
import {DEFAULT_CRITERIA} from '../src/domain/core.ts';
import {STATUSES} from '../src/domain/statuses.ts';

const NOW=new Date('2026-10-06T12:00:00Z');
const day=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();

test('snapshot: FIT verified/estimated, INTENT verified/estimated, only the signals that scored, verified evidence only',()=>{
 const sig=(o:any)=>({id:'s1',signal_type:'hiring_role',status:'VERIFIED',title:'t',excerpt:'Kerlan recrute',source_url:'https://j.example',source_domain:'j.example',source_type:'job_board',confidence:0.8,event_date:null,published_at:day(10),observed_at:day(9),matched_terms:[],...o});
 const ev=(o:any)=>({id:'e1',criterion:'need_fit',value:true,status:'VERIFIED',source_url:'https://a.example',excerpt:'x',observed_at:day(3),verified_by:'u',source_type:'official_website',...o});
 const snap=contactSnapshot({criteria:DEFAULT_CRITERIA,evidence:[ev({}),ev({id:'e2',status:'NOT_VERIFIED',verified_by:null,criterion:'target_fit'})],
  signals:[sig({}),sig({id:'old',published_at:day(300)})],profile:null,now:NOW});
 assert.ok(snap.fit_score!>0&&snap.fit_estimated!>=snap.fit_score!);
 assert.ok(snap.intent_score>0);
 assert.deepEqual(snap.signals,[{id:'s1',type:'hiring_role',source_type:'job_board',age_days:10}],'a signal past its max age is not a reason it was contacted');
 assert.deepEqual(snap.evidence_ids,['e1']);
 const empty=contactSnapshot({criteria:DEFAULT_CRITERIA,evidence:[],signals:[],profile:null,now:NOW});
 assert.equal(empty.fit_score,null,'nothing found: unscored, never 0');assert.equal(empty.intent_score,0);
});

test('bands',()=>{
 assert.deepEqual([fitBand(null),fitBand(10),fitBand(40),fitBand(70)],['unscored','0-39','40-69','70-100']);
 assert.deepEqual([intentBand(0),intentBand(5),intentBand(30),intentBand(60)],['0','1-29','30-59','60-100']);
 assert.deepEqual([ageBand(0),ageBand(8),ageBand(31),ageBand(91)],['0-7','8-30','31-90','90+']);
});

const snap=(i:number,o:Partial<Snapshot>={}):Snapshot=>({prospect_id:`p${i}`,fit_score:80,intent_score:40,signals:[{id:`s${i}`,type:'hiring_role',source_type:'job_board',age_days:5}],contacted_at:day(20-i/10),...o});

test('under 10 contacts: counts shown, no rate, "insufficient sample"',()=>{
 const r=feedbackReport([snap(1),snap(2)],{p1:'Réponse',p2:'Contacté'});
 assert.equal(r.contacted,2);assert.equal(r.answered,1);assert.equal(r.answer_rate,null);assert.equal(r.insufficient,true);
 assert.equal(r.by_signal_type[0].answer_rate,null);assert.equal(r.by_signal_type[0].insufficient,true);
});

test('rates from 10 contacts; answered = Réponse/Intéressé/RDV/Gagné, meeting = RDV/Gagné; one prospect counts once (latest snapshot)',()=>{
 const list=Array.from({length:12},(_,i)=>snap(i));
 const status:Record<string,string>={p0:'Réponse',p1:'Intéressé',p2:'RDV',p3:'Gagné',p4:'Perdu'};
 const r=feedbackReport([...list,snap(0,{contacted_at:day(1),intent_score:0,signals:[]})],status);
 assert.equal(r.contacted,12);assert.equal(r.answered,4);assert.equal(r.meetings,2);assert.equal(r.answer_rate,33.3);
 assert.deepEqual(r.by_intent.map(b=>[b.key,b.contacted]),[['30-59',11],['0',1]],'p0 counted with its latest snapshot only');
 const hiring=r.by_signal_type.find(b=>b.key==='hiring_role')!;assert.equal(hiring.contacted,11);assert.equal(hiring.answer_rate,27.3);
 assert.deepEqual(r.by_signal_type.find(b=>b.key==='none'),{key:'none',contacted:1,answered:1,meetings:0,answer_rate:null,meeting_rate:null,insufficient:true});
 assert.deepEqual(feedbackReport([...list].reverse(),status),feedbackReport(list,status),'reproducible whatever the order');
 assert.equal(MIN_SAMPLE,10);
});

test('statuses: RDV between Intéressé and Gagné; scoring core untouched; routes record snapshots best-effort',async()=>{
 assert.deepEqual([...STATUSES],['À analyser','Qualifié','À contacter','Contacté','Réponse','Intéressé','RDV','Gagné','Perdu','Ignoré']);
 const m=await readFile(new URL('../db/migrations/025_pipeline_feedback.sql',import.meta.url),'utf8');
 assert.match(m,/check \(status in \('À analyser','Qualifié','À contacter','Contacté','Réponse','Intéressé','RDV','Gagné','Perdu','Ignoré'\)\)/);
 const route=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.match(route,/if\(body\.status==='Contacté'\)await recordContactSnapshot\(db,id,null,'status_contacted'\)/);
 assert.match(route,/if\(action==='USED'&&changed\?\.prospect_id\)await recordContactSnapshot\(db,changed\.prospect_id,changed\.id,'outreach_used'\)/);
 const ctx=await readFile(new URL('../src/signals/context.ts',import.meta.url),'utf8');
 assert.match(ctx,/\}catch\{return false\}/,'a snapshot failure never blocks the action');
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/\{mode==='live'&&project&&<FeedbackPanel key=\{project\.id\} projectId=\{project\.id\}/);
});
