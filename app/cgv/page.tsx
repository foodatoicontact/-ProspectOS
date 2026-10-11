import type {Metadata} from 'next';
import {LegalPage} from '../../src/components/LegalPage';
import {EDITOR, BLOCKED_VAT_DECISION, TERMS_VERSION} from '../../src/domain/legal';
import {CHECKOUT_PRICES, PLAN_QUOTAS, TEAM_PRICING} from '../../src/domain/plans';
import {SITE_URL} from '../../src/domain/seo';

export const metadata:Metadata={
 title:{absolute:'Conditions générales de vente | ProspectOS'},
 description:'Conditions générales de vente de ProspectOS : essai gratuit de 7 jours, abonnements mensuels Solo, Pro et Équipe, paiement, résiliation et accès.',
 alternates:{canonical:`${SITE_URL}/cgv`},
 robots:{index:true,follow:true},
};

// Every amount and quota below is read from src/domain/plans.ts — the same values the server checks before any
// checkout and the database enforces — never typed a second time here.
const eur=(cents:number)=>`${cents/100} €`;
const SOLO=CHECKOUT_PRICES.BETA,PRO=CHECKOUT_PRICES.PRO;
const T=PLAN_QUOTAS.TRIAL,S=PLAN_QUOTAS.BETA,P=PLAN_QUOTAS.PRO;
const vat=<span className="missing">{BLOCKED_VAT_DECISION}</span>;

export default function Page(){
 return <LegalPage title="Conditions générales de vente" updated={TERMS_VERSION} currentPath="/cgv">

  <section>
   <h2>1. Objet et champ d’application</h2>
   <p>Les présentes conditions générales de vente (CGV) régissent la souscription et l’utilisation payante de ProspectOS, logiciel de prospection B2B accessible en ligne (SaaS), édité par {EDITOR.name}. Les offres payantes de ProspectOS s’adressent exclusivement à des clients professionnels, agissant pour les besoins de leur activité.</p>
   <p>Les présentes CGV complètent les <a href="/cgu">conditions générales d’utilisation</a>, qui s’appliquent à tout compte, payant ou non. Toute souscription d’un abonnement vaut acceptation des présentes CGV dans leur version en vigueur à la date de la souscription.</p>
  </section>

  <section>
   <h2>2. Essai gratuit</h2>
   <p>Tout nouveau compte bénéficie d’un essai gratuit de 7 jours, sans carte bancaire ni moyen de paiement à fournir. L’essai est activé une seule fois par compte, à sa première connexion ; l’exploitant peut limiter le nombre d’essais ouverts simultanément.</p>
   <p>Pendant l’essai, le compte dispose de : {T.discovery} recherches de prospects (Discovery), {T.analysis} analyses de prospects et {T.aiOffer} analyses d’offre par IA, pour toute la durée de l’essai.</p>
   <p>À la fin de l’essai, aucun abonnement n’est souscrit automatiquement et aucune somme n’est due : le compte reste accessible en lecture (voir l’article 8) jusqu’à la souscription éventuelle d’une offre payante.</p>
  </section>

  <section>
   <h2>3. Offres et prix</h2>
   <ul>
    <li><b>ProspectOS Solo</b> — {eur(SOLO.unitAmount)} HT par mois, 1 compte : {S.discovery} recherches de prospects, {S.analysis} analyses de prospects et {S.aiOffer} analyses d’offre par IA par période mensuelle.</li>
    <li><b>ProspectOS Pro</b> — {eur(PRO.unitAmount)} HT par mois, 1 compte : {P.discovery} recherches de prospects, {P.analysis} analyses de prospects et {P.aiOffer} analyses d’offre par IA par période mensuelle.</li>
    <li><b>ProspectOS Équipe</b> — {eur(TEAM_PRICING.baseAmount)} HT par mois pour {TEAM_PRICING.includedSeats} comptes, puis {eur(TEAM_PRICING.extraSeatAmount)} HT par mois par compte supplémentaire, jusqu’à {TEAM_PRICING.maxSeats} comptes : les volumes de l’offre Pro par compte payé, mis en commun au sein de l’équipe.</li>
   </ul>
   <p>Les prix sont exprimés en euros, hors taxes (HT). Régime de TVA applicable et mentions correspondantes : {vat}</p>
   <p>Les quotas sont appliqués par le serveur de ProspectOS sur chaque période mensuelle d’abonnement ; une période commence à la date de souscription puis à chaque date anniversaire. Les quotas non consommés ne sont pas reportés. Une action qui n’a produit aucun résultat (par exemple une recherche échouée) n’est pas décomptée.</p>
   <p>Une offre sur devis peut être proposée à certains clients ; ses conditions particulières sont alors fixées par écrit avec l’exploitant.</p>
   <p>Les prix applicables sont ceux affichés sur la page <a href="/tarifs">Tarifs</a> au moment de la souscription. Toute évolution de prix d’un abonnement en cours est notifiée au client avant de s’appliquer, et ne s’applique qu’à partir de la période suivante.</p>
  </section>

  <section>
   <h2>4. Souscription</h2>
   <p>L’abonnement est souscrit en ligne, depuis l’espace Compte de ProspectOS. Le paiement est effectué sur une page de paiement sécurisée opérée par le prestataire de paiement de ProspectOS, Stripe, selon les moyens de paiement proposés sur cette page. ProspectOS ne collecte ni ne conserve les données de paiement du client.</p>
   <p>L’accès payant n’est ouvert qu’une fois le paiement confirmé au serveur de ProspectOS par le prestataire de paiement.</p>
  </section>

  <section>
   <h2>5. Durée, facturation et renouvellement</h2>
   <p>L’abonnement est mensuel et sans engagement de durée. Il est payable d’avance et se renouvelle automatiquement chaque mois, à la date anniversaire de la souscription, jusqu’à sa résiliation.</p>
   <p>Les factures sont mises à disposition depuis l’espace de gestion de l’abonnement accessible dans le Compte. Mentions de TVA portées sur les factures : {vat}</p>
  </section>

  <section>
   <h2>6. Résiliation</h2>
   <p>Le client peut résilier son abonnement à tout moment depuis son espace Compte (« Gérer mon abonnement »). La résiliation arrête le renouvellement : aucun nouveau paiement n’est prélevé, et l’accès payant reste ouvert jusqu’à la fin de la période mensuelle déjà payée.</p>
   <p>L’exploitant peut résilier un abonnement en cas de manquement grave du client aux présentes CGV ou aux CGU, notamment en cas d’usage illicite du service.</p>
  </section>

  <section>
   <h2>7. Défaut de paiement</h2>
   <p>En cas d’échec d’un paiement, l’accès payant reste ouvert jusqu’à la fin de la période déjà payée ; aucune nouvelle période n’est ouverte tant que le paiement n’a pas abouti. Si le paiement n’aboutit pas, l’abonnement prend fin et le compte passe en accès en lecture (voir l’article 8).</p>
   <p>Conformément à l’article L. 441-10 du Code de commerce, toute somme non payée à son échéance donne lieu, de plein droit, à des pénalités de retard calculées au taux égal à trois fois le taux d’intérêt légal, ainsi qu’à une indemnité forfaitaire pour frais de recouvrement de 40 €.</p>
  </section>

  <section>
   <h2>8. Accès après la fin de l’essai ou de l’abonnement</h2>
   <p>À la fin de l’essai gratuit, d’un abonnement résilié ou d’un abonnement interrompu pour défaut de paiement, le compte reste accessible : les données restent consultables, et l’export des données ainsi que la suppression du compte restent disponibles. Les fonctionnalités qui nécessitent un accès actif (nouvelle recherche de prospects, nouvelle analyse, préparation de message, surveillance de signaux) sont désactivées jusqu’à la souscription d’une offre.</p>
   <p>La conservation et la suppression des données sont décrites dans la <a href="/confidentialite">politique de confidentialité</a>. La suppression d’un compte n’est possible qu’une fois l’abonnement en cours terminé.</p>
  </section>

  <section>
   <h2>9. Disponibilité</h2>
   <p>L’exploitant s’efforce d’assurer une disponibilité raisonnable du service, sans engagement de niveau de service (SLA) contractuel. Des interruptions peuvent intervenir, notamment pour maintenance ou en cas d’incident d’un prestataire technique.</p>
  </section>

  <section>
   <h2>10. Responsabilité et propriété intellectuelle</h2>
   <p>Les principes de limitation de responsabilité et de propriété intellectuelle posés par les <a href="/cgu">CGU</a> (articles 10 et 13) s’appliquent aux offres payantes. ProspectOS est un outil d’aide à la prospection : il ne garantit aucun résultat commercial.</p>
  </section>

  <section>
   <h2>11. Contact</h2>
   <p>Pour toute question relative à un abonnement, à une facture ou aux présentes CGV : {EDITOR.legalEmail}.</p>
  </section>

  <section>
   <h2>12. Droit applicable</h2>
   <p>Les présentes CGV sont soumises au droit français. Tout litige relève, à défaut de résolution amiable, des juridictions françaises compétentes.</p>
  </section>

 </LegalPage>;
}
