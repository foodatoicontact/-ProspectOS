// UX A/B, variant B "Workflow-first" (Figma: B — REIMAGINED). Pure views of data the page already holds — no fetch,
// no score, no angle selection. Figma concepts with no ProspectOS metric behind them (Opportunity score, Confidence
// score) have no view at all. Every status is shown as it is: verified / to confirm / unknown, never upgraded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {heroView,reasonView,timelineView} from '../src/ux/cockpit-view.ts';
import type {IntentScore,IntentLine} from '../src/domain/intent.ts';

const line=(o:Partial<IntentLine>):IntentLine=>({signal_id:'s',signal_type:'hiring_role',title:'t',source_url:'https://jobs.example/x',source_domain:'jobs.example',date_basis:'event',age_days:3,weight:20,confidence:1,recency:1,relevance:1,multiplier:1,points:10,strength:'strong',verified:true,...o});
const intent=(o:{lines?:IntentLine[];archived?:IntentLine[];est?:IntentLine[];pending?:number;score?:number}):IntentScore=>({score:o.score??0,lines:o.lines??[],archived:o.archived??[],pending:{count:o.pending??0,potential:0},estimated:{score:0,lines:o.est??[],to_verify:0}});
const now=new Date('2026-10-11T12:00:00Z');

test('hero — the strongest VERIFIED signal is the reason now: its own type, title, source and age (no invented sentence)',()=>{
 const v=heroView(intent({score:42,lines:[line({signal_id:'a',points:4,title:'faible'}),line({signal_id:'b',points:12,title:'Recrute un responsable achats',signal_type:'hiring_role',age_days:5})]}));
 assert.deepEqual(v,{state:'verified',signal_type:'hiring_role',title:'Recrute un responsable achats',source_domain:'jobs.example',age_days:5,count:2});
});
test('hero — signals still to review are only "to confirm"; nothing → an explicit neutral state; loading until INTENT',()=>{
 assert.deepEqual(heroView(intent({est:[line({verified:false,title:'à revoir'})],pending:1})),{state:'to_confirm',count:1,title:'à revoir'});
 assert.deepEqual(heroView(intent({lines:[line({points:0,strength:'archive'})]})),{state:'none'},'an archived signal is no reason now');
 assert.deepEqual(heroView(null),{state:'loading'});
});
test('reason card — the existing verified INTENT only, with its verified / to-confirm counts; no score without a verified signal',()=>{
 assert.deepEqual(reasonView(intent({score:31,lines:[line({}),line({signal_id:'x',points:0})],pending:2})),{state:'ready',score:31,verified:1,to_confirm:2});
 assert.deepEqual(reasonView(intent({score:0,pending:1})),{state:'ready',score:null,verified:0,to_confirm:1});
 assert.deepEqual(reasonView(null),{state:'loading'});
});
test('timeline — signals, supporting ICP evidence and public content, most recent first, statuses kept as they are',()=>{
 const t=timelineView({now,intent:intent({lines:[line({signal_id:'s1',age_days:2,title:'Levée'})],est:[line({signal_id:'s1',age_days:2}),line({signal_id:'s2',verified:false,age_days:9,title:'Annonce à revoir'})]}),
  criteria:[{key:'size',label:'Taille'},{key:'need',label:'Besoin'}],
  evidence:[
   {id:'e1',criterion:'size',value:true,status:'VERIFIED',source_url:'https://registre.example/a',excerpt:'45 salariés',observed_at:'2026-10-07T10:00:00Z',verified_by:'u'},
   {id:'e2',criterion:'need',value:true,status:'INFERRED_UNCONFIRMED',source_url:'https://site.example/b',excerpt:'supposé',observed_at:'2026-09-01T10:00:00Z',verified_by:null},
   {id:'e3',criterion:'need',value:true,status:'CONTRADICTED',source_url:'https://x.example',excerpt:'non',observed_at:'2026-10-10T10:00:00Z',verified_by:null},
   {id:'e4',criterion:'size',value:false,status:'VERIFIED',source_url:'https://x.example',excerpt:'contre',observed_at:'2026-10-10T10:00:00Z',verified_by:'u'}],
  content:[
   {id:'c1',source_url:'https://blog.example/p',source_domain:'blog.example',author:null,content:'Nous ouvrons une agence à Lyon',published_at:'2026-10-05T00:00:00Z',observed_at:'2026-10-06T00:00:00Z',status:'PENDING_REVIEW'},
   {id:'c2',source_url:'https://blog.example/r',source_domain:'blog.example',author:null,content:'rejeté',published_at:null,observed_at:'2026-10-10T00:00:00Z',status:'REJECTED'}]});
 assert.deepEqual(t.items.map(i=>[i.kind,i.id,i.status,i.age_days]),[
  ['signal','s1','verified',2],['evidence','e1','verified',4],['content','c1','to_confirm',6],['signal','s2','to_confirm',9],['evidence','e2','to_confirm',40]]);
 assert.equal(t.items[1].title,'Taille');assert.equal(t.items[1].detail,'45 salariés');assert.equal(t.items[1].source,'registre.example');
 assert.equal(t.items[1].date,'2026-10-07');assert.equal(t.items[0].date,null,'a signal only carries its age');
 assert.equal(t.more,0);
});
test('timeline — capped, with the rest counted; empty when nothing is dated',()=>{
 const many=Array.from({length:9},(_,i)=>line({signal_id:`s${i}`,age_days:i}));
 const t=timelineView({now,intent:intent({lines:many}),criteria:[],evidence:[],content:[]},6);
 assert.equal(t.items.length,6);assert.equal(t.more,3);
 assert.deepEqual(timelineView({now,intent:null,criteria:[],evidence:[],content:[]}),{items:[],more:0});
});
test('no conceptual Figma metric is computed: no opportunity, no confidence score',()=>{
 const src=readFileSync(new URL('../src/ux/cockpit-view.ts',import.meta.url),'utf8')+readFileSync(new URL('../src/components/ProspectDetailB.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(src,/opportunit|confidence ?score|scoreIntent\(|scoreProspect\(|estimateFit\(|selectAngle\(/i);
});
