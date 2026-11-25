'use client';
// Programme partenaires (052): the optional « Code partenaire » field of the sign-up card, pre-filled from the ?ref= link
// (read from this page's address, else from what this tab kept in sessionStorage). Editable, never required: an unknown
// code is ignored by the database without blocking the sign-up. Shown only with NEXT_PUBLIC_PARTNERS_ENABLED (app/page.tsx).
// Its copy is local (FR/EN), like every new UI text: the i18n files stay frozen.
import {useEffect} from 'react';
import {rememberRef,storedRef} from './model.ts';
const COPY={fr:{label:'Code partenaire',optional:'(facultatif)',hint:'Si un partenaire vous a recommandé ProspectOS.',placeholder:'Ex. AGENCE2026'},
 en:{label:'Partner code',optional:'(optional)',hint:'If a partner recommended ProspectOS to you.',placeholder:'E.g. AGENCY2026'}} as const;
export function SignupCode({value,onChange,locale}:{value:string;onChange:(v:string)=>void;locale:string}){
 const t=COPY[locale==='en'?'en':'fr'];
 useEffect(()=>{
  if(value)return;
  let store:Storage|null=null;try{store=window.sessionStorage}catch{}
  const c=rememberRef(store,window.location.search)??storedRef(store);if(c)onChange(c);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 return <label>{t.label} <small className="muted">{t.optional}</small>
  <input type="text" autoComplete="off" maxLength={24} value={value} placeholder={t.placeholder}
   onChange={e=>onChange(e.target.value.toUpperCase())} aria-describedby="partner-code-hint"/>
  <small id="partner-code-hint" className="muted">{t.hint}</small>
 </label>;
}
