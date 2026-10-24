'use client';
// Renders the `.pos-ui` root of a v2 surface and owns its theme. The data-theme attributes are written to the DOM, never
// rendered by React: the inline script sets them during parsing (hard loads), the layout effect sets them before paint
// (soft navigations, React's dev remount), so server HTML, hydration and the first paint always agree.
import {createContext,useCallback,useContext,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {DARK_QUERY,THEME_STORAGE_KEY,parseThemePreference,themeAttributes,themeInitScript,type ResolvedTheme,type ThemePreference} from './theme.ts';

type ThemeState={preference:ThemePreference|null;resolved:ResolvedTheme|null;setPreference:(p:ThemePreference)=>void};
const ThemeContext=createContext<ThemeState|null>(null);
export function useTheme():ThemeState{
 const v=useContext(ThemeContext);
 if(!v)throw new Error('useTheme() outside <ThemeProvider>');
 return v;
}

function readStored():ThemePreference{
 try{return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))}catch{return parseThemePreference(null)}
}
function systemDark():boolean{
 try{return window.matchMedia(DARK_QUERY).matches}catch{return false}
}

export function ThemeProvider({children,className}:{children:ReactNode;className?:string}){
 const root=useRef<HTMLDivElement>(null);
 // null until mounted: the server cannot know the preference, and the first client render must match it.
 const [preference,setPref]=useState<ThemePreference|null>(null);
 const [resolved,setResolved]=useState<ResolvedTheme|null>(null);

 const apply=useCallback((pref:ThemePreference)=>{
  const attrs=themeAttributes(pref,systemDark());
  const el=root.current;
  if(el)for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);
  setPref(pref);setResolved(attrs['data-theme']);
 },[]);

 useLayoutEffect(()=>{
  apply(readStored());
  let mq:MediaQueryList|null=null;
  const onSystem=()=>{if(readStored()==='system')apply('system')};
  const onStorage=(e:StorageEvent)=>{if(e.key===THEME_STORAGE_KEY||e.key===null)apply(readStored())};
  try{mq=window.matchMedia(DARK_QUERY);mq.addEventListener('change',onSystem)}catch{}
  window.addEventListener('storage',onStorage);
  return ()=>{mq?.removeEventListener('change',onSystem);window.removeEventListener('storage',onStorage)};
 },[apply]);

 const setPreference=useCallback((p:ThemePreference)=>{
  try{window.localStorage.setItem(THEME_STORAGE_KEY,p)}catch{}
  apply(p);
 },[apply]);

 return <ThemeContext.Provider value={{preference,resolved,setPreference}}>
  <div ref={root} className={className?`pos-ui ${className}`:'pos-ui'} suppressHydrationWarning>
   <script type={typeof window==='undefined'?'text/javascript':'text/plain'} suppressHydrationWarning dangerouslySetInnerHTML={{__html:themeInitScript()}}/>
   {children}
  </div>
 </ThemeContext.Provider>;
}
