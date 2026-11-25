import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {LegalPage} from '../../src/components/LegalPage';
import {MISSING} from '../../src/domain/legal';
import {SITE_URL} from '../../src/domain/seo';
import {PARTNERS} from '../../src/partners/flag';
import {PARTNER_SUMMARY,PARTNER_CONDITIONS,PARTNER_TERMS_UPDATED} from '../../src/partners/terms';
import {PartnerApplicationForm} from '../../src/partners/ApplicationForm';
// Programme partenaires (052): the programme, its conditions and the application form. Behind NEXT_PUBLIC_PARTNERS_ENABLED
// (404 otherwise, and not indexed while the conditions are not provided).
export const metadata:Metadata={
 title:{absolute:'Programme partenaires | ProspectOS'},
 description:'Recommandez ProspectOS et recevez 30 % du montant HT payé par chaque client apporté, pendant ses 12 premiers mois.',
 alternates:{canonical:`${SITE_URL}/partenaires`},
 robots:{index:PARTNER_CONDITIONS.length>0,follow:true},
};
export default function Page(){
 if(!PARTNERS)notFound();
 return <LegalPage title="Programme partenaires" updated={PARTNER_TERMS_UPDATED} currentPath="/partenaires">
  <section><h2>Le programme en bref</h2><ul>{PARTNER_SUMMARY.map(t=><li key={t}>{t}</li>)}</ul></section>
  <section><h2>Conditions du programme</h2>
   {PARTNER_CONDITIONS.length?PARTNER_CONDITIONS.map(t=><p key={t}>{t}</p>):<p><span className="missing">{MISSING}</span></p>}
  </section>
  <section><h2 id="candidature">Devenir partenaire</h2>
   <p>Remplissez ce formulaire : chaque candidature est étudiée à la main. Si elle est retenue, vous recevez votre code et l’accès à votre espace partenaire.</p>
   <PartnerApplicationForm/>
   <p className="muted">Déjà partenaire ? <a href="/partenaires/espace">Ouvrir mon espace partenaire</a>.</p>
  </section>
 </LegalPage>;
}
