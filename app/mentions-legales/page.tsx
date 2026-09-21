import type {Metadata} from 'next';
import {LegalPage} from '../../src/components/LegalPage';
import {EDITOR, HOSTING, MISSING, TERMS_VERSION} from '../../src/domain/legal';
import {SITE_URL} from '../../src/domain/seo';

export const metadata:Metadata={
 title:{absolute:'Mentions légales | ProspectOS'},
 description:'Mentions légales de ProspectOS : éditeur, hébergement, propriété intellectuelle et contact.',
 alternates:{canonical:`${SITE_URL}/mentions-legales`},
 robots:{index:true,follow:true},
};

// Renders a value, or the visible '[À FOURNIR]' placeholder if it hasn't been supplied — never a
// guess. See src/domain/legal.ts for exactly which fields are verified vs. still missing.
function Field({label,value}:{label:string;value:string}){
 return <p><b>{label} :</b> {value===MISSING?<span className="missing">{value}</span>:value}</p>;
}

export default function Page(){
 return <LegalPage title="Mentions légales" updated={TERMS_VERSION} currentPath="/mentions-legales">

  <section>
   <h2>Éditeur du site</h2>
   <Field label="Nom / raison sociale" value={EDITOR.name}/>
   <Field label="Statut juridique" value={EDITOR.legalStatus}/>
   <Field label="SIREN" value={EDITOR.siren}/>
   <Field label="SIRET" value={EDITOR.siret}/>
   <Field label="RCS" value={EDITOR.rcs}/>
   <Field label="Numéro de TVA intracommunautaire" value={EDITOR.vatNumber}/>
   <Field label="Capital social" value={EDITOR.capital}/>
   <Field label="Siège social" value={EDITOR.address}/>
   <Field label="Téléphone" value={EDITOR.phone}/>
   <Field label="Email de contact" value={EDITOR.legalEmail}/>
   <Field label="Directeur de la publication" value={EDITOR.publicationDirector}/>
   <p className="muted">ProspectOS est développé et exploité dans le cadre de l’activité de {EDITOR.name}. Les informations d’identification légale ci-dessus marquées <span className="missing">{MISSING}</span> doivent être complétées par l’exploitant avant toute ouverture publique non contrôlée du service.</p>
  </section>

  <section>
   <h2>Hébergement</h2>
   <h3>Application</h3>
   <Field label="Hébergeur" value={HOSTING.application.name}/>
   <p className="muted">{HOSTING.application.role}.</p>
   <Field label="Adresse" value={HOSTING.application.address}/>
   <h3>Base de données et authentification</h3>
   <Field label="Hébergeur" value={HOSTING.database.name}/>
   <p className="muted">{HOSTING.database.role}. La base de données de production est hébergée dans la région Europe (Irlande, eu-west-1).</p>
   <Field label="Adresse" value={HOSTING.database.address}/>
  </section>

  <section>
   <h2>Propriété intellectuelle</h2>
   <p>Le logiciel ProspectOS, son code source, sa structure, ses interfaces et les éléments graphiques qui lui sont propres sont protégés par le droit de la propriété intellectuelle. Toute reproduction, représentation, adaptation ou extraction non autorisée est interdite.</p>
   <p>Les données que vous importez ou créez dans ProspectOS (projets, ICP, prospects, preuves, messages préparés) vous appartiennent ou appartiennent à votre organisation ; ProspectOS ne revendique aucun droit de propriété sur ces données. Voir les <a href="/cgu">CGU</a> pour le détail des droits d’usage du service.</p>
  </section>

  <section>
   <h2>Contact</h2>
   <p>Pour toute question relative à ces mentions légales, contactez : {EDITOR.legalEmail===MISSING?<span className="missing">{MISSING}</span>:EDITOR.legalEmail}.</p>
  </section>

 </LegalPage>;
}
