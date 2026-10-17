// Next Best Action V1 — dry run on fictitious data (.example domains). No network, no database, nothing sent.
//   node --experimental-strip-types scripts/nba-dry-run.ts [YYYY-MM-DD]
// Shows, for four reference companies: SIGNAL → EVIDENCE → SCORES → NEXT BEST ACTION → WHY NOW → DRAFT → HUMAN DECISION.
// The same chain on real PostgreSQL (RLS, tenants, transitions) is tests/next-best-action-db.mjs.
import {buildOpportunity,canTransition,todayOf,type NbaSignal,type NbaPublicContent} from '../src/nba/engine.ts';
import {prepareContent} from '../src/nba/content.ts';
import type {Criterion,Evidence} from '../src/domain/core.ts';

const NOW=new Date(`${process.argv[2]??'2026-10-17'}T12:00:00Z`);
const ago=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
const OFFER='Nous aidons les équipes commerciales à choisir quels comptes contacter chaque semaine.';
const criteria=(fit:number):Criterion[]=>[{key:'icp',label:'Correspond à la cible définie',weight:fit},{key:'other',label:'Autre critère',weight:100-fit}];
const evidence=(id:string):Evidence=>({id,criterion:'icp',value:true,status:'VERIFIED',source_url:`https://registry.example/${id}`,excerpt:'Éditeur SaaS B2B, 40 salariés.',observed_at:ago(5),verified_by:'reviewer'});
const hiring=(id:string,company:string,days:number):NbaSignal=>({id,signal_type:'hiring_role',status:'VERIFIED',title:`${company} recrute un SDR`,
 excerpt:`${company} recrute un SDR pour construire son pipeline outbound.`,source_url:`https://jobs.example/${id}`,source_domain:'jobs.example',source_type:'job_board',
 confidence:0.8,event_date:null,published_at:ago(days),observed_at:ago(days),matched_terms:[],provider:'web_search'});
const post:NbaPublicContent={id:'c-canopee',status:'VERIFIED',source_url:'https://social.example/canopee/post',source_domain:'social.example',author:'Claire Martin',
 content:'200 appels cette semaine pour 3 rendez-vous. Il faut revoir notre façon de prospecter.',published_at:ago(1),observed_at:ago(1)};

const companies=[
 {name:'Alto',fit:95,signals:[] as NbaSignal[],content:[] as NbaPublicContent[],expect:'WAIT'},
 {name:'Bravo',fit:82,signals:[hiring('s-bravo','Bravo',2)],content:[],expect:'CONTACT'},
 {name:'Canopee',fit:85,signals:[],content:[post],expect:'ENGAGE'},
 {name:'Delta',fit:90,signals:[hiring('s-delta','Delta',182)],content:[],expect:'WAIT'},
];
const rows=[];
for(const c of companies){
 const ev=[evidence(`e-${c.name.toLowerCase()}`)];
 const o=buildOpportunity({prospect:{id:`p-${c.name.toLowerCase()}`,project_id:'demo',name:c.name,status:'À analyser'},criteria:criteria(c.fit),evidence:ev,signals:c.signals,publicContent:c.content,profile:null,now:NOW});
 const draft=prepareContent({opportunity:o,name:c.name,offer:OFFER,criteria:criteria(c.fit),evidence:ev,signals:c.signals,publicContent:c.content,profile:null,now:NOW});
 const s=o.scores;
 console.log(`\n━━ ${c.name} ━━ ${o.recommended_action} (rule ${o.rule})${o.recommended_action===c.expect?'':`  ≠ expected ${c.expect}`}`);
 console.log(`SIGNAL      ${o.primary?o.primary.kind==='signal'?`${o.primary.commercial_type} · ${o.primary.evidence_status} · ${o.primary.age_days} d`:`public conversation · ${o.primary.age_days} d`:'none'}`);
 console.log(`EVIDENCE    ${o.evidence_ids.join(', ')||'—'} | signals ${o.signal_ids.join(', ')||'—'} | contents ${o.public_content_ids.join(', ')||'—'}`);
 console.log(`SCORES      FIT ${s.fit.score} (${s.fit.basis}) · INTENT ${s.intent.score} · TIMING ${s.timing.score} · FRESHNESS ${s.freshness.score} · EVIDENCE ${s.evidence_quality.score} → OPPORTUNITY ${s.opportunity.score}`);
 for(const [k,list] of Object.entries({WHY_THIS_ACCOUNT:o.explanation.why_this_account,WHY_NOW:o.explanation.why_now,WHY_THIS_ACTION:o.explanation.why_this_action,INFERRED:o.explanation.inferred,UNKNOWN:o.explanation.unknown}))
  for(const st of list)console.log(`${k.padEnd(16)}[${st.kind}] ${st.text}${st.refs.length?`  ⟶ ${st.refs.map(r=>r.source_url??r.id).join(' ')}`:''}`);
 console.log(`TARGET      role ${o.target.role??'—'}${o.target.role_alternatives.length?` (or ${o.target.role_alternatives.join(', ')})`:''} · person ${o.target.person?.name??'UNKNOWN'}`);
 if(draft.kind==='contact_draft')console.log(`DRAFT       ${draft.text}`);
 else if(draft.kind==='engage')console.log(`ANGLE       ${draft.angle}\nCOMMENT     ${draft.suggested_comment}\nDM AFTER    ${draft.suggested_dm_after_engagement}`);
 else console.log(`DRAFT       none (${draft.reason})`);
 rows.push({prospect_id:o.prospect_id,recommended_action:o.recommended_action,opportunity_score:s.opportunity.score,timing_score:s.timing.score,freshness_score:s.freshness.score,name:c.name});
}
console.log(`\nTODAY       ${todayOf(rows,10).map(r=>`${r.name} (${r.recommended_action} ${r.opportunity_score})`).join(' · ')}`);
// The human decides; the engine only checks the transition is allowed (the database enforces the same table).
console.log(`HUMAN       Bravo: PENDING → APPROVED ${canTransition('PENDING','APPROVED')} → DONE ${canTransition('APPROVED','DONE')} · Canopee: PENDING → SNOOZED ${canTransition('PENDING','SNOOZED')} · DONE → PENDING ${canTransition('DONE','PENDING')}`);
console.log('SENT        nothing (no SMTP, no IONOS, no LinkedIn, no comment, no DM)');
