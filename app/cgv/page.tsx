import type {Metadata} from 'next';
import {LegalPage} from '../../src/components/LegalPage';
import {EDITOR, MISSING_COMMERCIAL, TERMS_VERSION} from '../../src/domain/legal';
import {SITE_URL} from '../../src/domain/seo';

export const metadata:Metadata={
 title:{absolute:'Conditions générales de vente | ProspectOS'},
 description:'Conditions générales de vente de ProspectOS — structure préparatoire ; aucune offre payante n’est actuellement commercialisée.',
 alternates:{canonical:`${SITE_URL}/cgv`},
 robots:{index:true,follow:true},
};

export default function Page(){
 return <LegalPage title="Conditions générales de vente" updated={TERMS_VERSION} currentPath="/cgv">

  <section>
   <p><b>ProspectOS n’a pas encore ouvert d’offre payante.</b> Le service est actuellement proposé exclusivement dans le cadre d’une phase bêta gratuite, décrite dans les <a href="/cgu">CGU</a> (article 3). Aucun abonnement, aucun tarif, aucun moyen de paiement n’est actif à ce jour.</p>
   <p>Cette page prépare la structure des futures conditions générales de vente B2B, applicable au moment où {EDITOR.name} ouvrira une offre payante de ProspectOS. Les sections marquées <span className="missing">{MISSING_COMMERCIAL}</span> seront complétées avant toute commercialisation et ne doivent en aucun cas être interprétées comme une offre commerciale actuelle.</p>
  </section>

  <section>
   <h2>1. Objet</h2>
   <p>Les présentes conditions générales de vente régiront, une fois activées, la fourniture payante de ProspectOS à des clients professionnels (B2B).</p>
  </section>

  <section>
   <h2>2. Prix</h2>
   <p>{MISSING_COMMERCIAL}</p>
  </section>

  <section>
   <h2>3. Facturation et paiement</h2>
   <p>{MISSING_COMMERCIAL}</p>
   <p className="muted">Moyens de paiement, fréquence de facturation et prestataire de paiement à définir.</p>
  </section>

  <section>
   <h2>4. Durée et renouvellement</h2>
   <p>{MISSING_COMMERCIAL}</p>
  </section>

  <section>
   <h2>5. Résiliation</h2>
   <p>{MISSING_COMMERCIAL}</p>
  </section>

  <section>
   <h2>6. Retard de paiement, pénalités et indemnité forfaitaire de recouvrement</h2>
   <p>{MISSING_COMMERCIAL}</p>
   <p className="muted">Le droit français impose, pour les relations B2B, un taux d’intérêt de retard et une indemnité forfaitaire de recouvrement minimale ; les montants exacts seront précisés ici avant commercialisation.</p>
  </section>

  <section>
   <h2>7. Disponibilité et niveau de service</h2>
   <p>{MISSING_COMMERCIAL}</p>
  </section>

  <section>
   <h2>8. Responsabilité</h2>
   <p>{MISSING_COMMERCIAL}</p>
   <p className="muted">Sans préjudice des principes de limitation de responsabilité déjà posés par les <a href="/cgu">CGU</a> (article 13).</p>
  </section>

  <section>
   <h2>9. Propriété intellectuelle</h2>
   <p>{MISSING_COMMERCIAL}</p>
   <p className="muted">Sans préjudice des principes déjà posés par les <a href="/cgu">CGU</a> (article 10).</p>
  </section>

  <section>
   <h2>10. Droit applicable</h2>
   <p>Droit français, sous réserve de confirmation au moment de l’ouverture commerciale.</p>
  </section>

 </LegalPage>;
}
