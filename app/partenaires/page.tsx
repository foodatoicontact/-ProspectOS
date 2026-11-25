import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {LegalPage} from '../../src/components/LegalPage';
import {SITE_URL} from '../../src/domain/seo';
import {PARTNERS} from '../../src/partners/flag';
import {DEFAULT_RATE_PERCENT,COMMISSION_MONTHS} from '../../src/partners/model';
import {PARTNER_SUMMARY,PARTNER_CONDITIONS,PARTNER_CONDITIONS_TITLE,PARTNER_TERMS_VERSION_DATE,partnerConditionsVersion} from '../../src/partners/terms';
import {PartnerApplicationForm} from '../../src/partners/ApplicationForm';
// Programme partenaires (052): the programme, its conditions (the owner's text, src/partners/terms.ts) and the application
// form. Shown only with NEXT_PUBLIC_PARTNERS_ENABLED AND a version date for the conditions; otherwise 404.
export const metadata:Metadata={
 title:{absolute:'Programme partenaires | ProspectOS'},
 description:`Recommandez ProspectOS et recevez ${DEFAULT_RATE_PERCENT} % du montant HT payé par chaque client apporté, pendant ses ${COMMISSION_MONTHS} premiers mois.`,
 alternates:{canonical:`${SITE_URL}/partenaires`},
 robots:{index:true,follow:true},
};
export default function Page(){
 if(!PARTNERS||!PARTNER_TERMS_VERSION_DATE)notFound();
 return <LegalPage title="Programme partenaires" updated={PARTNER_TERMS_VERSION_DATE} currentPath="/partenaires">
  <section><h2>Le programme en bref</h2><ul>{PARTNER_SUMMARY.map(t=><li key={t}>{t}</li>)}</ul></section>
  <section><h2>{PARTNER_CONDITIONS_TITLE}</h2>
   <p className="muted">{partnerConditionsVersion(PARTNER_TERMS_VERSION_DATE)}</p>
   {PARTNER_CONDITIONS.map(c=><div key={c.title}><h3>{c.title}</h3><p>{c.text}</p></div>)}
  </section>
  <section><h2 id="candidature">Devenir partenaire</h2>
   <p>Remplissez ce formulaire : chaque candidature est étudiée à la main. Si elle est retenue, vous recevez votre code et l’accès à votre espace partenaire.</p>
   <PartnerApplicationForm/>
   <p className="muted">Déjà partenaire ? <a href="/partenaires/espace">Ouvrir mon espace partenaire</a>.</p>
  </section>
 </LegalPage>;
}
