'use client';
// « Devenir partenaire » (/partenaires): the application form (app/api/public/partenaires). Plain fields, the SIRET checked
// as the server does, a hidden honeypot, a consent box that says exactly what the data is used for. The application is
// stored for the administrator, who validates by hand; nothing is sent to the applicant automatically.
import {useState,type FormEvent} from 'react';
import {siretValid} from './model.ts';
import {PROSPECT_REQUEST_TO} from '../domain/prospect-request';
const CSS=`
.pos-partner-form{display:grid;gap:16px;padding:20px;background:var(--pos-surface-card,#fff);border:1px solid var(--pos-border,#dfe3ea);border-radius:16px;margin:16px 0}
.pos-partner-form label{display:grid;gap:6px;font-weight:600}
.pos-partner-form label small{font-weight:400;opacity:.75}
.pos-partner-form input,.pos-partner-form textarea{min-height:44px;padding:10px 12px;border:1px solid var(--pos-border-strong,#c9cfd9);border-radius:8px;font:inherit;font-weight:400;width:100%;box-sizing:border-box}
.pos-partner-form textarea{min-height:110px;resize:vertical}
.pos-partner-form__row{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))}
.pos-partner-form .pos-partner-form__consent{display:flex;align-items:flex-start;gap:10px;font-weight:400;font-size:14px}
.pos-partner-form .pos-partner-form__consent input{min-height:auto;width:20px;height:20px;margin-top:2px;flex-shrink:0}
.pos-partner-form__trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.pos-partner-form__status{margin:0;padding:12px 14px;border-radius:8px;background:var(--pos-accent-soft,#eef3ff);font-size:14px}
.pos-partner-form button{min-height:48px}
`;
type State={kind:'idle'}|{kind:'sending'}|{kind:'sent'}|{kind:'error';message:string};
const FIELD:Record<string,string>={name:'votre nom',company:'votre entreprise',siret:'le SIRET (14 chiffres)',email:'votre e-mail',pitch:'votre façon de recommander ProspectOS (10 caractères au moins)',consent:'la case de consentement'};
export function PartnerApplicationForm(){
 const [state,setState]=useState<State>({kind:'idle'});
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  const f=new FormData(e.currentTarget);
  const siret=String(f.get('siret')??'');
  if(!siretValid(siret)){setState({kind:'error',message:'Ce SIRET n’est pas valide : vérifiez les 14 chiffres.'});return}
  setState({kind:'sending'});
  try{
   const res=await fetch('/api/public/partenaires',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    name:f.get('name'),company:f.get('company'),siret,email:f.get('email'),pitch:f.get('pitch'),consent:f.get('consent')==='on',website:f.get('website')})});
   const data=await res.json().catch(()=>({})) as {ok?:boolean;error?:string;fields?:string[]};
   if(res.ok&&data.ok){setState({kind:'sent'});return}
   if(data.error==='TOO_MANY_REQUESTS'){setState({kind:'error',message:'Trop de demandes depuis votre connexion. Réessayez dans une heure.'});return}
   const fields=(data.fields??[]).map(k=>FIELD[k]).filter(Boolean);
   setState({kind:'error',message:fields.length?`Vérifiez ${fields.join(', ')}.`:`La candidature n’a pas pu être envoyée. Écrivez-nous à ${PROSPECT_REQUEST_TO}.`});
  }catch{setState({kind:'error',message:`La candidature n’a pas pu être envoyée. Écrivez-nous à ${PROSPECT_REQUEST_TO}.`})}
 }
 if(state.kind==='sent')return <div className="pos-partner-form" role="status"><style href="pos-partner-form" precedence="default">{CSS}</style>
  <p className="pos-partner-form__status"><strong>Candidature reçue, merci !</strong> Elle est étudiée à la main. Si elle est retenue, vous recevrez votre code partenaire et l’accès à votre espace par e-mail.</p></div>;
 return <form className="pos-partner-form" onSubmit={submit} aria-labelledby="candidature">
  <style href="pos-partner-form" precedence="default">{CSS}</style>
  <div className="pos-partner-form__row">
   <label>Nom et prénom<input name="name" required minLength={2} maxLength={120} autoComplete="name"/></label>
   <label>Entreprise<input name="company" required minLength={2} maxLength={160} autoComplete="organization"/></label>
  </div>
  <div className="pos-partner-form__row">
   <label>SIRET<small>14 chiffres</small><input name="siret" required inputMode="numeric" pattern="[0-9 ]{14,17}" maxLength={17} autoComplete="off"/></label>
   <label>E-mail professionnel<input name="email" type="email" required maxLength={254} autoComplete="email"/></label>
  </div>
  <label>Comment comptez-vous recommander ProspectOS ?<small>Vos clients, votre audience, votre façon de travailler</small>
   <textarea name="pitch" required minLength={10} maxLength={2000}/></label>
  <div className="pos-partner-form__trap" aria-hidden="true"><label>Ne pas remplir<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
  <label className="pos-partner-form__consent"><input type="checkbox" name="consent" required/>
   <span>J’accepte que ces informations servent uniquement à étudier ma candidature et à me recontacter à ce sujet. Pas de newsletter, pas de revente.</span></label>
  {state.kind==='error'&&<p className="pos-partner-form__status" role="alert">{state.message}</p>}
  <button type="submit" className="primary" disabled={state.kind==='sending'}>{state.kind==='sending'?'Envoi…':'Envoyer ma candidature'}</button>
 </form>;
}
