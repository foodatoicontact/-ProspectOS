'use client';
// "Registres publics" for one prospect (server: src/discovery/public-records.ts). One click reads the company register
// (INSEE Sirene / RNE) and the public procurement awards (DECP, data.gouv.fr); what they say arrives as observations
// to confirm, in the same review list as a website analysis. When the company is not identified without doubt, the
// person chooses it among the candidates or types its SIREN (found in the legal notice of its site): nothing is
// guessed, nothing is consumed until a company is chosen. Its own copy (the i18n files are frozen).
import {useState} from 'react';
import type {Locale} from '../i18n/locale';

type Candidate={siren:string;name:string;city:string|null;naf:string|null};
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
export const PUBLIC_RECORDS_TEXT={
 fr:{button:'Registres publics',hint:'Registre des entreprises (Sirene) et marchés publics attribués (data.gouv.fr). Chaque information reste à confirmer.',
  choose:'Quelle entreprise est-ce ? Rien n’a été enregistré.',none:'Aucune entreprise ne porte exactement ce nom.',pick:'C’est celle-ci',
  sirenLabel:'SIREN (9 chiffres, dans les mentions légales du site)',sirenSubmit:'Utiliser ce SIREN',sirenInvalid:'Le SIREN doit comporter 9 chiffres.',
  done:(n:number,awards:number,unavailable:boolean)=>`${n} information${n>1?'s':''} ajoutée${n>1?'s':''} à vérifier${unavailable?' · marchés publics momentanément indisponibles':` · ${awards} marché${awards>1?'s':''} public${awards>1?'s':''} trouvé${awards>1?'s':''}`}.`,
  busy:'Lecture des registres…'},
 en:{button:'Public registers',hint:'Company register (Sirene) and public contracts awarded (data.gouv.fr). Every item stays to be confirmed.',
  choose:'Which company is it? Nothing was saved.',none:'No company bears exactly this name.',pick:'This one',
  sirenLabel:'SIREN (9 digits, in the site’s legal notice)',sirenSubmit:'Use this SIREN',sirenInvalid:'A SIREN has 9 digits.',
  done:(n:number,awards:number,unavailable:boolean)=>`${n} item${n>1?'s':''} added to check${unavailable?' · public contracts temporarily unavailable':` · ${awards} public contract${awards>1?'s':''} found`}.`,
  busy:'Reading the registers…'},
} as const;

export function PublicRecordsControl({prospectId,api,locale,disabled,onBusyChange,onSaved}:{prospectId:string;api:Api;locale:Locale;disabled:boolean;onBusyChange:(active:boolean)=>void;onSaved:()=>Promise<void>}){
 const t=PUBLIC_RECORDS_TEXT[locale];
 const [busy,setBusy]=useState(false),[note,setNote]=useState(''),[error,setError]=useState(''),[candidates,setCandidates]=useState<Candidate[]|null>(null),[siren,setSiren]=useState('');
 async function run(chosen?:string){
  if(busy||disabled)return;
  if(chosen!==undefined&&!/^\d{9}$/.test(chosen)){setError(t.sirenInvalid);return}
  setBusy(true);onBusyChange(true);setError('');setNote('');
  try{
   const r=await api(`prospects/${prospectId}/registry`,'POST',chosen?{siren:chosen}:{});
   if(r?.identity_required){setCandidates(Array.isArray(r.candidates)?r.candidates:[]);return}
   setCandidates(null);setSiren('');
   setNote(t.done(Array.isArray(r?.observations)?r.observations.length:0,Number(r?.awards)||0,r?.procurement==='unavailable'));
   await onSaved();
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false);onBusyChange(false)}
 }
 return <div className="public-records">
  <div className="actions"><button disabled={busy||disabled} onClick={()=>run()}>{busy?t.busy:t.button}</button></div>
  <p className="muted">{t.hint}</p>
  {candidates&&<div className="public-records-choice" role="group" aria-label={t.choose}>
   <p>{t.choose}</p>
   {candidates.length===0&&<p className="muted">{t.none}</p>}
   <ul>{candidates.map(c=><li key={c.siren}><span><b>{c.name}</b> · SIREN {c.siren}{c.city?` · ${c.city}`:''}{c.naf?` · NAF ${c.naf}`:''}</span> <button className="text-button" disabled={busy||disabled} onClick={()=>run(c.siren)}>{t.pick}</button></li>)}</ul>
   <form onSubmit={e=>{e.preventDefault();run(siren.replace(/\s/g,''))}}>
    <label>{t.sirenLabel}<input inputMode="numeric" autoComplete="off" maxLength={11} value={siren} onChange={e=>setSiren(e.target.value)}/></label>
    <button type="submit" disabled={busy||disabled||!siren.trim()}>{t.sirenSubmit}</button>
   </form>
  </div>}
  {note&&<p role="status" className="muted">{note}</p>}
  {error&&<p role="alert" className="note">{error}</p>}
 </div>;
}
