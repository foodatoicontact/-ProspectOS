'use client';
// Programme partenaires (052): ?ref=CODE on any page pre-fills the « Code partenaire » field of the sign-up. Kept in
// sessionStorage only — no cookie, nothing sent anywhere until the person signs up with the code still in the field.
// Rendered by the root layout; it reads the flag itself (the layout stays flag-free) and renders nothing.
import {useEffect} from 'react';
import {PARTNERS} from './flag.ts';
import {rememberRef} from './model.ts';
export function PartnerRefCapture(){
 useEffect(()=>{
  if(!PARTNERS)return;
  let store:Storage|null=null;try{store=window.sessionStorage}catch{}
  rememberRef(store,window.location.search);
 },[]);
 return null;
}
