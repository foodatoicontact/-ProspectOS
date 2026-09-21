import type {Metadata} from 'next';
import {LegalPage} from '../../src/components/LegalPage';
import {EDITOR, HOSTING, MISSING, TO_CONFIRM, TERMS_VERSION, SERVICE_NAME, ACTIVITY_FORMALITY} from '../../src/domain/legal';
import {SITE_URL} from '../../src/domain/seo';

export const metadata:Metadata={
 title:{absolute:'Mentions légales | ProspectOS'},
 description:'Mentions légales de ProspectOS : éditeur, hébergement, propriété intellectuelle et contact.',
 alternates:{canonical:`${SITE_URL}/mentions-legales`},
 robots:{index:true,follow:true},
};

// Renders a value, or a visible placeholder badge if it hasn't been supplied yet ('[À FOURNIR]') or is
// administratively/contractually pending ('[À CONFIRMER]') — never a guess in either case. See
// src/domain/legal.ts for exactly which fields are verified vs. still open.
function Field({label,value}:{label:string;value:string}){
 return <p><b>{label} :</b> {value===MISSING||value===TO_CONFIRM?<span className="missing">{value}</span>:value}</p>;
}

export default function Page(){
 return <LegalPage title="Mentions légales" updated={TERMS_VERSION} currentPath="/mentions-legales">

  <section>
   <h2>Éditeur du site</h2>
   <Field label="Nom et prénom de l’entrepreneur individuel" value={EDITOR.name}/>
   <Field label="Service concerné par les présentes mentions" value={SERVICE_NAME}/>
   <Field label="Statut juridique" value={EDITOR.legalStatus}/>
   <Field label="SIREN" value={EDITOR.siren}/>
   <Field label="SIRET (établissement principal)" value={EDITOR.siret}/>
   <Field label="Immatriculation RNE (Registre National des Entreprises)" value={EDITOR.rneRegistrationDate}/>
   <Field label="RCS (registre du commerce et des sociétés)" value={EDITOR.rcs}/>
   <p className="muted">La formalité d’adjonction d’activité ProspectOS étant encore en cours de traitement (voir ci-dessous), l’applicabilité d’une inscription RCS distincte pour cette activité — ainsi que le numéro et la ville de greffe le cas échéant — reste à confirmer une fois cette formalité validée.</p>
   <Field label="Numéro de TVA intracommunautaire" value={EDITOR.vatStatus}/>
   <p className="muted">Le statut TVA de cette activité est en cours de vérification et n’est pas présumé applicable ou non applicable à ce stade. Un numéro sera indiqué ici s’il s’avère exigible.</p>
   <Field label="Capital social" value={EDITOR.capital}/>
   <Field label="Siège social" value={EDITOR.address}/>
   <Field label="Téléphone" value={EDITOR.phone}/>
   <Field label="Email de contact" value={EDITOR.legalEmail}/>
   <Field label="Directeur de la publication" value={EDITOR.publicationDirector}/>
   <p className="muted">{SERVICE_NAME} est développé et exploité par {EDITOR.name}, entrepreneur individuel.</p>
  </section>

  <section>
   <h2>Activité ProspectOS</h2>
   <p>{ACTIVITY_FORMALITY.status}</p>
   <p className="muted">Dépôt : {ACTIVITY_FORMALITY.filedAt} · Début d’activité déclaré : {ACTIVITY_FORMALITY.declaredStartDate}. Cette activité n’est pas présentée comme définitivement enregistrée tant que sa validation administrative n’est pas confirmée.</p>
  </section>

  <section>
   <h2>Hébergement</h2>
   <h3>Application</h3>
   <Field label="Hébergeur" value={HOSTING.application.name}/>
   <p className="muted">{HOSTING.application.role}.</p>
   <Field label="Adresse" value={HOSTING.application.address}/>
   <h3>Base de données et authentification</h3>
   <Field label="Hébergeur" value={HOSTING.database.name}/>
   <p className="muted">{HOSTING.database.role}. Le projet est configuré dans la région {HOSTING.database.region}, qui détermine la localisation primaire des données selon la documentation Supabase.</p>
   <Field label="Adresse" value={HOSTING.database.address}/>
  </section>

  <section>
   <h2>Propriété intellectuelle</h2>
   <p>Le logiciel ProspectOS, son code source, sa structure, ses interfaces et les éléments graphiques qui lui sont propres sont protégés par le droit de la propriété intellectuelle. Toute reproduction, représentation, adaptation ou extraction non autorisée est interdite.</p>
   <p>Les données que vous importez ou créez dans ProspectOS (projets, ICP, prospects, preuves, messages préparés) vous appartiennent ou appartiennent à votre organisation ; ProspectOS ne revendique aucun droit de propriété sur ces données. Voir les <a href="/cgu">CGU</a> pour le détail des droits d’usage du service.</p>
  </section>

  <section>
   <h2>Contact</h2>
   <p>Pour toute question relative à ces mentions légales : {EDITOR.legalEmail} · {EDITOR.phone}.</p>
  </section>

 </LegalPage>;
}
