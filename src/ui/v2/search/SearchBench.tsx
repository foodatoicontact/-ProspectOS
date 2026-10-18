'use client';
// /ui-v2/search (Preview only, behind UI_V2_ENABLED like /ui-v2): Recherche 2.0 inside the real v2 shell, with the real
// DiscoveryPanel in its demo mode (synthetic TEST companies, local storage only). No network call, no event sent.
import {useState} from 'react';
import {AppShell} from '../shell/AppShell.tsx';
import {SearchV2} from './SearchV2.tsx';
import {DiscoveryPanel} from '../../../components/DiscoveryPanel.tsx';
import {BENCH_CRITERIA,benchProspects} from '../prospects/fixture.ts';
import type {Prospect} from '../../../domain/core.ts';

const PROJECTS=[{id:'bench',name:'Banc Recherche 2.0'}];
const api=async()=>({});

export function SearchBench(){
 const [now]=useState(()=>new Date());
 const [existing,setExisting]=useState<Prospect[]>(()=>benchProspects(now));
 const [log,setLog]=useState<string[]>([]);
 return <AppShell locale="fr" current="search" onNavigate={()=>{}} title="Recherche"
  project={{projects:PROJECTS,currentId:'bench',busy:false,onSelect:()=>{},onNew:()=>{}}}
  account={{mode:'demo',email:'',internal:false,busy:false,onLocale:()=>{},onAccount:()=>{},onTeam:()=>{},onOfferTarget:()=>{},onSources:()=>{},onPrivacy:()=>{},
   onBetaAnalytics:()=>{},onSignOut:()=>{},onResetDemo:()=>{}}}
  screen={<>
   <SearchV2 locale="fr" top={null} notice="" onDismissNotice={()=>{}} paywall={null}
    panel={<DiscoveryPanel projectId="bench" projectName={PROJECTS[0]!.name} offer="Commande directe et fidélité pour la restauration indépendante." criteria={BENCH_CRITERIA}
     mode="demo" api={api} locale="fr" existing={existing} onOpenProspect={id=>setLog(l=>[...l,`open:${id}`])}
     onAdded={p=>{setExisting(e=>[...e.filter(x=>x.id!==p.id),p]);setLog(l=>[...l,`added:${p.name}`])}}/>}/>
   <p className="pos-visually-hidden" data-testid="bench-log">{log.join(' ')}</p>
  </>}>{null}</AppShell>;
}
