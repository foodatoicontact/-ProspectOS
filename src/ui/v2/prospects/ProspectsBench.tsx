'use client';
// /ui-v2/prospects (Preview only, behind UI_V2_ENABLED like /ui-v2): Prospects 2.0 inside the real v2 shell, fed by the
// bench fixture instead of the API, to review it in every theme and width without an account. The legacy panels run in
// their demo mode (local storage only). No network call: every action is listed on the page instead of being performed.
import {useState} from 'react';
import {AppShell} from '../shell/AppShell.tsx';
import {ProspectsV2} from './ProspectsV2.tsx';
import {BENCH_CRITERIA,benchProspects} from './fixture.ts';
import {scoreProspect} from '../../../domain/core.ts';
import {estimateFit} from '../../../domain/fit-estimate.ts';
import {fitDisplay} from '../../../domain/score-display.ts';
import {STATUSES} from '../../../domain/statuses.ts';
import {ObservationsReview} from '../../../components/ObservationsReview.tsx';
import {SignalsPanel} from '../../../components/SignalsPanel.tsx';
import {AngleSummary,PublicContentPanel,StyleProfilePanel} from '../../../components/OutreachIntelligence.tsx';
import type {ReviewSummary} from '../../../components/evidence-presentation.ts';

const PROJECTS=[{id:'bench',name:'Banc Prospects 2.0'},{id:'empty',name:'Projet sans prospect'}];
const api=async()=>({});

export function ProspectsBench(){
 const [now]=useState(()=>new Date());
 const [projectId,setProjectId]=useState('bench');
 const [prospects,setProspects]=useState(()=>benchProspects(now));
 const [query,setQuery]=useState('');const [filter,setFilter]=useState('Tous');
 const [open,setOpen]=useState('');const [focus,setFocus]=useState<string|null>(null);
 const [summary,setSummary]=useState<ReviewSummary>({criteria:{},linkedEvidenceIds:[],contextEvidenceIds:[]});
 const [draft,setDraft]=useState('');const [draftStatus,setDraftStatus]=useState('DRAFT');
 const [log,setLog]=useState<string[]>([]);
 const did=(s:string)=>setLog(l=>[...l,s]);
 const all=projectId==='bench'?prospects:[];
 const visible=all.filter(p=>p.name.toLowerCase().includes(query.toLowerCase())&&(filter==='Tous'||p.status===filter));
 const current=all.find(p=>p.id===open);
 const scored=current?scoreProspect(BENCH_CRITERIA,current.evidence,now):null;
 return <AppShell locale="fr" current="prospects" onNavigate={()=>{}} title="Prospects"
  project={{projects:PROJECTS,currentId:projectId,busy:false,onSelect:id=>{setProjectId(id);setOpen('')},onNew:()=>{}}}
  account={{mode:'demo',email:'',internal:false,busy:false,onLocale:()=>{},onAccount:()=>{},onTeam:()=>{},onOfferTarget:()=>{},onSources:()=>{},onPrivacy:()=>{},
   onBetaAnalytics:()=>{},onSignOut:()=>{},onResetDemo:()=>{}}}
  screen={<>
   <ProspectsV2 locale="fr" busy={false} visible={visible} total={all.length} criteria={BENCH_CRITERIA} statuses={STATUSES}
    query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} focusId={focus} onOpen={id=>{if(id!==open){setDraft('');setDraftStatus('DRAFT')}setOpen(id)}}
    hasProject onAdd={()=>did('add')} onExport={()=>did('export')} activation={null} top={null} notice="" onDismissNotice={()=>{}} paywall={null} listFooter={null}
    record={current&&scored?{prospect:current,criteria:BENCH_CRITERIA,scored,estimate:estimateFit(BENCH_CRITERIA,current.evidence,now),
     fit:fitDisplay(estimateFit(BENCH_CRITERIA,current.evidence,now)),summary,intent:null,statuses:STATUSES,back:{label:'Retour aux prospects',onBack:()=>{setFocus(current.id);setOpen('')}},
     badge:null,note:null,onStatus:v=>{did(`status:${v}`);setProspects(ps=>ps.map(p=>p.id===current.id?{...p,status:v}:p))},
     onAddEvidence:()=>did('evidence'),onAnalyze:()=>did('analyze'),onAddChannel:()=>did('channel'),onVerify:e=>did(`verify:${e.id}`),onReview:a=>did(`review:${a}`),
     observations:<ObservationsReview key={current.id} prospect={current} criteria={BENCH_CRITERIA} onReviewSummary={setSummary} mode="demo" api={api} locale="fr" disabled={false} onBusyChange={()=>{}} onChanged={async()=>{}}/>,
     signals:<SignalsPanel key={`s:${current.id}`} prospect={current} mode="demo" api={api} locale="fr" disabled={false} onBusyChange={()=>{}} onIntentChange={()=>{}}/>,
     publicContent:<PublicContentPanel key={`p:${current.id}`} prospect={current} mode="demo" api={api} locale="fr" disabled={false} onBusyChange={()=>{}} onRowsChange={()=>{}}/>,
     outreach:{draft,status:draftStatus,description:draft?'Message fondé sur les preuves documentées.':'Aucun message préparé.',angle:<AngleSummary angle={null} whyNow={null} locale="fr"/>,
      hint:draft&&draftStatus==='DRAFT'?'Relisez, modifiez si besoin, puis approuvez : seul un message approuvé peut être copié.':null,note:null,error:'',ai:null,canSave:true,
      linkedin:current.channels?.find(c=>c.kind==='linkedin'&&c.verified)?.value??null,style:<StyleProfilePanel organizationId="org" mode="demo" api={api} locale="fr" disabled={false}/>,
      onChange:setDraft,onGenerate:()=>{did('generate');setDraft(`Bonjour, j’ai vu que ${current.name} ouvre un nouveau lieu.`);setDraftStatus('DRAFT')},
      onSave:()=>did('save'),onApprove:()=>{did('approve');setDraftStatus('APPROVED')},onCopy:()=>{did('copy');setDraftStatus('USED')}},
     history:log.map(text=>({text,at:'banc'}))}:null}/>
   <p className="pos-visually-hidden" data-testid="bench-log">{log.join(' ')}</p>
  </>}>{null}</AppShell>;
}
