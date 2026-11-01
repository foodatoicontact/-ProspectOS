'use client';
// The "3 prospects de votre zone" form (src/domain/prospect-request.ts, app/api/public/demande-prospects). Plain fields, a
// native <select> of the 101 departments, a hidden honeypot, a consent box that states exactly what the email is used for.
// On success the visitor is told what happens next; if the notification cannot be sent, the contact address is shown.
import {useState,type FormEvent} from 'react';
import {CREATIONS_DEPARTMENTS} from '../domain/company-creations';
import {PROSPECT_REQUEST_TO,REQUEST_LIMITS} from '../domain/prospect-request';

const ERRORS:Record<string,string>={
 ACTIVITY_REQUIRED:'Indiquez ce que vous vendez, en quelques mots.',
 DEPARTMENT_INVALID:'Choisissez votre département.',
 EMAIL_INVALID:'Vérifiez votre adresse email.',
 CONSENT_REQUIRED:'Cochez la case pour que je puisse vous répondre.',
 TOO_MANY_REQUESTS:'Trop de demandes depuis votre connexion. Réessayez dans une heure.',
};
const CSS=`
.pos-request{display:grid;gap:var(--pos-space-4,16px);padding:var(--pos-space-5,20px);background:var(--pos-surface-card);border:1px solid var(--pos-border);border-radius:var(--pos-radius-xl,16px);box-shadow:var(--pos-shadow-card)}
.pos-request label{display:grid;gap:6px;font-weight:var(--pos-weight-semibold,600);color:var(--pos-text-1)}
.pos-request label small{font-weight:400;color:var(--pos-text-3)}
.pos-request input,.pos-request select,.pos-request textarea{min-height:44px;padding:10px 12px;border:1px solid var(--pos-border-strong,var(--pos-border));border-radius:var(--pos-radius-md,8px);background:var(--pos-surface-card);color:var(--pos-text-1);font:inherit;font-weight:400}
.pos-request textarea{min-height:88px;resize:vertical}
.pos-request__row{display:grid;gap:var(--pos-space-4,16px);grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))}
.pos-request .pos-request__consent{display:flex;align-items:flex-start;gap:10px;font-weight:400;font-size:var(--pos-text-sm,14px);color:var(--pos-text-2)}
.pos-request .pos-request__consent input{min-height:auto;width:20px;height:20px;margin-top:2px;flex-shrink:0}
.pos-request__trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.pos-request__status{margin:0;padding:12px 14px;border-radius:var(--pos-radius-md,8px);background:var(--pos-accent-soft);color:var(--pos-text-1);font-size:var(--pos-text-sm,14px)}
.pos-request__status--error{background:var(--pos-status-verify-bg,var(--pos-accent-soft));color:var(--pos-status-verify-fg,var(--pos-text-1))}
.pos-request button{min-height:48px}
`;

type State={kind:'idle'}|{kind:'sending'}|{kind:'sent'}|{kind:'error';message:string;fallback?:boolean};

export function ProspectRequestForm(){
 const [state,setState]=useState<State>({kind:'idle'});
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  const f=new FormData(e.currentTarget);
  setState({kind:'sending'});
  try{
   const res=await fetch('/api/public/demande-prospects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    activity:f.get('activity'),target:f.get('target'),department:f.get('department'),email:f.get('email'),message:f.get('message'),
    consent:f.get('consent')==='on',website:f.get('website')})});
   const data=await res.json().catch(()=>({})) as {ok?:boolean;error?:string};
   if(res.ok&&data.ok){setState({kind:'sent'});return}
   const known=data.error?ERRORS[data.error]:undefined;
   setState({kind:'error',message:known??'La demande n’a pas pu être envoyée.',fallback:!known});
  }catch{setState({kind:'error',message:'La demande n’a pas pu être envoyée.',fallback:true})}
 }
 if(state.kind==='sent')return <div className="pos-request" role="status"><style href="pos-request" precedence="default">{CSS}</style>
  <p className="pos-request__status"><strong>Demande reçue, merci !</strong> Je prépare vos 3 entreprises à la main, chacune avec sa source officielle, et je vous les envoie par email sous 24 h ouvrées.</p>
 </div>;
 return <form className="pos-request" onSubmit={submit} noValidate={false}>
  <style href="pos-request" precedence="default">{CSS}</style>
  <label>Ce que vous vendez<small>Par exemple : création de sites web, expertise comptable, assurance professionnelle</small>
   <input name="activity" required minLength={3} maxLength={REQUEST_LIMITS.activity} autoComplete="off"/></label>
  <label>Vos clients idéaux <small>(facultatif) Par exemple : restaurants, artisans du bâtiment, PME industrielles</small>
   <input name="target" maxLength={REQUEST_LIMITS.target} autoComplete="off"/></label>
  <div className="pos-request__row">
   <label>Votre département
    <select name="department" required defaultValue=""><option value="" disabled>Choisir…</option>
     {CREATIONS_DEPARTMENTS.map(d=><option key={d.code} value={d.code}>{d.name} ({d.code})</option>)}</select></label>
   <label>Votre email professionnel
    <input name="email" type="email" required maxLength={REQUEST_LIMITS.email} autoComplete="email"/></label>
  </div>
  <label>Une précision ? <small>(facultatif)</small>
   <textarea name="message" maxLength={REQUEST_LIMITS.message}/></label>
  <div className="pos-request__trap" aria-hidden="true"><label>Ne pas remplir<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
  <label className="pos-request__consent"><input type="checkbox" name="consent" required/>
   <span>J’accepte que mon email serve uniquement à recevoir ces 3 prospects et à être recontacté à ce sujet. Pas de newsletter, pas de revente. La demande n’est pas enregistrée en base : elle m’est transmise par email.</span></label>
  {state.kind==='error'&&<p className="pos-request__status pos-request__status--error" role="alert">{state.message}{state.fallback&&<> Écrivez-moi directement à <a href={`mailto:${PROSPECT_REQUEST_TO}`}>{PROSPECT_REQUEST_TO}</a>.</>}</p>}
  <button type="submit" className="pos-pbtn pos-pbtn--primary pos-pbtn--lg" disabled={state.kind==='sending'}>{state.kind==='sending'?'Envoi…':'Recevoir mes 3 prospects'}</button>
 </form>;
}
