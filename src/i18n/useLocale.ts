'use client';
import {useState,useEffect,useCallback} from 'react';
import {type Locale,LOCALE_STORAGE_KEY,DEFAULT_LOCALE,detectBrowserLocale} from './locale.ts';
import {fr} from './fr.ts';
import {en} from './en.ts';
export type TKey=keyof typeof fr;
const DICTS:Record<Locale,Record<TKey,string>>={fr,en};
// For a child component that receives `locale` as a prop from a parent already running useLocale()
// (DiscoveryPanel, ObservationsReview) — a plain dictionary lookup, never a second independent
// detection/localStorage instance that could drift from the parent's own chosen locale.
export function translate(locale:Locale,key:TKey):string{return DICTS[locale][key]}
// First render (server + pre-hydration) is always DEFAULT_LOCALE (French) — matches "existing users
// keep FR" and avoids a hydration mismatch, since localStorage/navigator don't exist on the server.
// Once mounted, a stored manual choice always wins; only a visitor with NO stored choice at all gets
// navigator.language-based detection — a later detection run (e.g. a second tab) never overrides a
// choice already saved by that same effect or by clicking the switcher.
export function useLocale(){
 const [locale,setLocaleState]=useState<Locale>(DEFAULT_LOCALE);
 const setLocale=useCallback((next:Locale)=>{setLocaleState(next);try{localStorage.setItem(LOCALE_STORAGE_KEY,next)}catch{}},[]);
 useEffect(()=>{
  let stored:string|null=null;
  try{stored=localStorage.getItem(LOCALE_STORAGE_KEY)}catch{}
  if(stored==='fr'||stored==='en'){setLocaleState(stored);return}
  // A first-time visitor has no stored choice yet: the browser-detected locale becomes their persisted
  // choice immediately (setLocale, not setLocaleState) — so the one unavoidable French flash (the
  // server/pre-hydration render, before this effect can ever run) happens at most once per browser.
  // Every later load finds a stored value above and skips detection entirely. This still never touches
  // an existing manual/stored choice, handled by the branch above.
  setLocale(detectBrowserLocale(typeof navigator!=='undefined'?navigator.language:undefined));
 },[]);
 const t=useCallback((key:TKey):string=>DICTS[locale][key],[locale]);
 return {locale,setLocale,t};
}
