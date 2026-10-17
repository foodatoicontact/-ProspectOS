'use client';
// /ui-v2/today (Preview only, behind UI_V2_ENABLED like /ui-v2): Today 2.0 inside the real v2 shell, fed by frozen NBA
// rows instead of the API, to review it in every theme and width without an account. No network call, no event sent:
// the ZF events it would send are listed on the page instead.
import {useState} from 'react';
import {AppShell} from '../shell/AppShell.tsx';
import {TodayV2} from './TodayV2.tsx';
import {CANARY_ROWS,ALL_STATES_ROWS} from './fixture.ts';
import type {ZfKind} from '../../../server/ux-events.ts';

const SETS={canary:CANARY_ROWS,all:ALL_STATES_ROWS,empty:[]} as const;
type SetKey=keyof typeof SETS;
const PROJECTS=[{id:'6xpos',name:'6XPOS — Nouvelles ouvertures CHR Occitanie'},{id:'bench',name:'Banc Today 2.0 (tous les états)'},{id:'empty',name:'Projet sans recommandation'}];
const SET_OF:Record<string,SetKey>={'6xpos':'canary',bench:'all',empty:'empty'};

export function TodayBench({initialSet}:{initialSet:SetKey}){
 const [projectId,setProjectId]=useState(Object.keys(SET_OF).find(k=>SET_OF[k]===initialSet)??'6xpos');
 const [events,setEvents]=useState<ZfKind[]>([]);
 const [opened,setOpened]=useState('');
 const rows=SETS[SET_OF[projectId]!];
 const api=async(path:string)=>path.endsWith('/home')?{items:rows}:{};
 return <AppShell locale="fr" current="today" onNavigate={()=>{}} title="Aujourd’hui"
  project={{projects:PROJECTS,currentId:projectId,busy:false,onSelect:setProjectId,onNew:()=>{}}}
  account={{mode:'demo',email:'',internal:false,busy:false,onLocale:()=>{},onAccount:()=>{},onTeam:()=>{},onOfferTarget:()=>{},onSources:()=>{},onPrivacy:()=>{},
   onBetaAnalytics:()=>{},onSignOut:()=>{},onResetDemo:()=>{}}}
  screen={<>
   <TodayV2 key={projectId} projectId={projectId} api={api} locale="fr" dirty={false} onCleaned={()=>{}} onOpenProspect={id=>setOpened(id)}
    track={k=>setEvents(e=>e.includes(k)?e:[...e,k])} onSearch={()=>setOpened('search')} notice={opened?`Banc : ouverture de « ${opened} » (dans l’app, la fiche s’ouvre).`:''}
    onDismissNotice={()=>setOpened('')} paywall={null}/>
   <p className="pos-visually-hidden" data-testid="bench-events">{events.join(' ')}</p>
  </>}>{null}</AppShell>;
}
