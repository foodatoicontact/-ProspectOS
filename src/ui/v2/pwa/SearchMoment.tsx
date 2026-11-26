'use client';
// ProspectOS installable (docs/PWA.md): a search that just finished with results is a moment for the install invitation
// (PwaLayer decides whether it may be shown). A past search reopened from the history is not. Rendered next to the v2
// search screen (app/page.tsx), so the screen itself keeps no automatic action. Renders nothing.
import {useEffect,useRef} from 'react';
import type {DiscoveryView} from '../../../components/DiscoveryPanel.tsx';
import {installMoment} from '../../../pwa/client.ts';
export function SearchMoment({m}:{m:DiscoveryView}){
 const announced=useRef<string|null>(null);
 useEffect(()=>{
  const done=m.current?.completed_at?Date.parse(m.current.completed_at):NaN;
  if(m.mode!=='live'||!m.run||announced.current===m.run||!m.candidates.length||!(Date.now()-done<5*60*1000))return;
  announced.current=m.run;installMoment('search_results');
 },[m.mode,m.run,m.candidates.length,m.current?.completed_at]);
 return null;
}
