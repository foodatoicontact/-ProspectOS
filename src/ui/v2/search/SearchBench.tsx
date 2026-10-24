'use client';
// /ui-v2/search (Preview only, behind UI_V2_ENABLED like /ui-v2): Recherche 2.0 inside the real v2 shell, to review it
// in every theme and width without an account. Two sources, chosen at the top:
//  - frozen states (fixture.ts): results, empty, loading, error, quota, start — every action only listed on the page;
//  - "démo réelle": the real DiscoveryPanel in its demo mode (synthetic TEST companies, local storage only) with the v2 view.
// No network call, no business call.
import {useState} from 'react';
import {AppShell} from '../shell/AppShell.tsx';
import {SearchV2} from './SearchV2.tsx';
import {SearchNative} from './SearchNative.tsx';
import {benchView,BENCH_STATES,type BenchState} from './fixture.ts';
import {DiscoveryPanel} from '../../../components/DiscoveryPanel.tsx';
import {BENCH_CRITERIA,benchProspects} from '../prospects/fixture.ts';
import type {NoveltyStatus} from '../../../discovery/novelty.ts';
import type {Prospect} from '../../../domain/core.ts';

type Source=BenchState|'demo';
const LABEL:Record<Source,string>={results:'Résultats',empty:'Aucun résultat',loading:'Chargement',error:'Erreur',quota:'Quota atteint',start:'Avant la recherche',demo:'Démo réelle'};
const PROJECTS=[{id:'bench',name:'Banc Recherche 2.0'}];
const api=async()=>({});

export function SearchBench({initial}:{initial:Source}){
 const [source,setSource]=useState<Source>(initial);
 const [tab,setTab]=useState<'ALL'|NoveltyStatus>('ALL');
 const [log,setLog]=useState<string[]>([]);
 const [existing,setExisting]=useState<Prospect[]>(()=>benchProspects(new Date()));
 const act=(name:string)=>setLog(l=>[...l,name]);
 return <AppShell locale="fr" current="search" onNavigate={()=>{}} title="Recherche"
  project={{projects:PROJECTS,currentId:'bench',busy:false,onSelect:()=>{},onNew:()=>{}}}
  account={{mode:'demo',email:'',internal:false,busy:false,onLocale:()=>{},onAccount:()=>{},onTeam:()=>{},onOfferTarget:()=>{},onSources:()=>{},onPrivacy:()=>{},
   onBetaAnalytics:()=>{},onSignOut:()=>{},onResetDemo:()=>{}}}
  screen={<>
   <nav className="pos-visually-hidden" aria-label="Banc : état affiché" data-testid="bench-states">
    {[...BENCH_STATES,'demo' as const].map(s=><button key={s} type="button" aria-pressed={source===s} data-state={s} onClick={()=>{setSource(s);setTab('ALL')}}>{LABEL[s]}</button>)}
   </nav>
   <SearchV2 locale="fr" top={null} notice="" onDismissNotice={()=>{}} paywall={null}
    panel={source==='demo'
     ?<DiscoveryPanel projectId="bench" projectName={PROJECTS[0]!.name} offer="Commande directe et fidélité pour la restauration indépendante." criteria={BENCH_CRITERIA}
       mode="demo" api={api} locale="fr" existing={existing} onOpenProspect={id=>act(`open:${id}`)}
       onAdded={p=>{setExisting(e=>[...e.filter(x=>x.id!==p.id),p]);act(`added:${p.name}`)}} view={m=><SearchNative m={m}/>}/>
     :<SearchNative m={benchView(source,act,tab,setTab)}/>}/>
   <p className="pos-visually-hidden" data-testid="bench-log">{log.join(' ')}</p>
  </>}>{null}</AppShell>;
}
