import type {Metadata} from 'next';
import {LegalPage} from '../../src/components/LegalPage';
import {EDITOR, MISSING, TERMS_VERSION} from '../../src/domain/legal';
import {SITE_URL} from '../../src/domain/seo';

export const metadata:Metadata={
 title:{absolute:'Conditions générales d’utilisation | ProspectOS'},
 description:'Conditions générales d’utilisation de ProspectOS : accès au service, compte, bêta, usage acceptable, IA, prospection et responsabilité.',
 alternates:{canonical:`${SITE_URL}/cgu`},
 robots:{index:true,follow:true},
};

export default function Page(){
 return <LegalPage title="Conditions générales d’utilisation" updated={TERMS_VERSION} currentPath="/cgu">

  <section>
   <h2>1. Objet</h2>
   <p>ProspectOS est un logiciel de prospection B2B assisté par des preuves : il aide à rechercher, qualifier et documenter des prospects professionnels, puis à préparer une approche personnalisée, sous le contrôle et la validation d’un utilisateur humain. Principe directeur : « Sources d’abord. Action humaine toujours. »</p>
   <p>Les présentes CGU régissent l’accès et l’utilisation de ProspectOS, édité par {EDITOR.name}. Toute création de compte suppose l’acceptation pleine et entière des présentes CGU.</p>
  </section>

  <section>
   <h2>2. Accès au service et compte utilisateur</h2>
   <p>L’accès à ProspectOS nécessite la création d’un compte (email et mot de passe) via l’authentification Supabase. La création d’un premier projet crée automatiquement votre organisation ; vous en êtes alors le propriétaire (owner).</p>
   <p>Vous êtes responsable de la confidentialité de vos identifiants de connexion et de toute activité réalisée depuis votre compte. Toute suspicion d’accès non autorisé doit être signalée sans délai à {EDITOR.legalEmail===MISSING?<span className="missing">{MISSING}</span>:EDITOR.legalEmail}.</p>
  </section>

  <section>
   <h2>3. Phase bêta</h2>
   <p>ProspectOS est actuellement proposé en phase bêta, dans les conditions suivantes :</p>
   <ul>
    <li>Accès gratuit, pour une durée de 7 jours à compter de l’activation de votre accès.</li>
    <li>L’accès bêta est accordé manuellement par l’exploitant, à un nombre limité de comptes (10 places maximum).</li>
    <li>Le service, ses fonctionnalités et son comportement peuvent évoluer, être modifiés ou interrompus à tout moment sans préavis, s’agissant d’une phase de test.</li>
    <li>Aucune garantie de disponibilité permanente ou continue n’est apportée pendant la phase bêta.</li>
    <li>À l’expiration de votre accès bêta, vos données restent accessibles en lecture et vous conservez l’accès à votre compte, à l’export de vos données et à la suppression de votre compte ; les fonctionnalités nécessitant un accès actif (nouvelle recherche de prospects, nouvelle analyse IA, nouvelle génération de message) sont alors désactivées jusqu’à réactivation éventuelle ou ouverture d’une offre payante.</li>
   </ul>
  </section>

  <section>
   <h2>4. Disponibilité</h2>
   <p>ProspectOS est fourni « en l’état ». L’exploitant s’efforce d’assurer une disponibilité raisonnable du service mais ne garantit aucun taux de disponibilité contractuel pendant la phase bêta décrite à l’article 3.</p>
  </section>

  <section>
   <h2>5. Usage acceptable et responsabilité de l’utilisateur</h2>
   <p>Vous vous engagez à utiliser ProspectOS conformément à la loi, notamment aux règles applicables en matière de protection des données personnelles et de prospection commerciale (démarchage électronique, RGPD). Vous êtes seul responsable :</p>
   <ul>
    <li>de la licéité de vos actions de prospection et de prise de contact avec les prospects identifiés via ProspectOS ;</li>
    <li>de la véracité et de la pertinence du contenu que vous fournissez (offre commerciale, critères ICP) ;</li>
    <li>du respect des droits des personnes physiques éventuellement identifiées dans les données de prospects que vous consultez, documentez ou utilisez ;</li>
    <li>de toute action réalisée depuis votre compte.</li>
   </ul>
   <p>Il est interdit d’utiliser ProspectOS pour collecter ou exploiter des données de façon manifestement illicite, pour du harcèlement, ou pour contourner les mesures de sécurité, de quota ou d’accès du service.</p>
  </section>

  <section>
   <h2>6. Recherche de prospects (Discovery) et sources publiques</h2>
   <p>La fonctionnalité de recherche de prospects s’appuie sur des sources publiques (moteur de recherche web) et sur le contenu public des sites d’entreprises que vous consultez. ProspectOS ne garantit ni l’exactitude, ni l’exhaustivité, ni l’actualité des informations ainsi trouvées : une information non confirmée reste marquée comme telle et ne doit pas être traitée comme un fait établi.</p>
   <p>L’utilisation d’une information publique reste soumise aux règles de droit applicables ; ProspectOS ne garantit pas la licéité de chaque prise de contact réalisée à partir des informations qu’il aide à trouver (voir l’article 5).</p>
  </section>

  <section>
   <h2>7. Preuves, validation humaine et scoring</h2>
   <p>Chaque observation ou preuve associée à un prospect conserve sa source, un extrait consultable et un statut (non vérifiée, vérifiée, contredite). Le score attribué à un prospect reflète la couverture et le niveau de vérification des critères que vous avez définis — il s’agit d’un outil d’aide à la priorisation, jamais d’une garantie de qualité, de pertinence commerciale ou de résultat.</p>
   <p>La validation d’une preuve comme « vérifiée » relève d’une action humaine explicite de votre part ; ProspectOS ne valide jamais automatiquement une information comme vraie.</p>
  </section>

  <section>
   <h2>8. Fonctionnalités assistées par intelligence artificielle</h2>
   <p>ProspectOS propose une fonctionnalité d’analyse assistée par IA de votre propre offre commerciale (résumé, cible, questions suggérées) et la préparation d’un message d’approche à partir de règles déterministes fondées sur les preuves vérifiées disponibles (aucun modèle d’IA facturé n’est utilisé pour la préparation des messages).</p>
   <p>Toute sortie générée par IA constitue une proposition à valider, jamais un résultat final automatiquement fiable. Vous devez relire et valider tout contenu avant toute utilisation ou envoi.</p>
   <p>Vous pouvez utiliser votre propre clé d’accès à un fournisseur d’IA (« BYOK — Bring Your Own Key »). Dans ce cas, l’usage de cette clé et les coûts associés relèvent de votre relation contractuelle avec ce fournisseur ; ProspectOS journalise l’usage réel (jetons, coût estimé) à des fins de transparence, sans jamais stocker votre clé en clair ni la réafficher après enregistrement.</p>
  </section>

  <section>
   <h2>9. Prospection et outreach</h2>
   <p>ProspectOS prépare des messages d’approche personnalisés ; il n’envoie aucun message automatiquement à votre place. L’envoi effectif d’un message, et le choix du canal utilisé, relèvent exclusivement d’une action humaine et volontaire de votre part, hors de ProspectOS.</p>
  </section>

  <section>
   <h2>10. Propriété intellectuelle</h2>
   <p>Le logiciel ProspectOS et ses éléments propres restent la propriété de {EDITOR.name}. Les données que vous créez ou importez (projets, ICP, prospects, preuves, messages) restent votre propriété ou celle de votre organisation.</p>
  </section>

  <section>
   <h2>11. Suspension et suppression de compte</h2>
   <p>L’exploitant peut suspendre un compte en cas d’usage manifestement contraire aux présentes CGU ou à la loi. Vous pouvez à tout moment supprimer votre compte depuis votre espace Compte ; les modalités exactes (anonymisation, données conservées) sont décrites dans la <a href="/confidentialite">politique de confidentialité</a>.</p>
  </section>

  <section>
   <h2>12. Évolution du service et des CGU</h2>
   <p>ProspectOS étant en développement actif, ses fonctionnalités peuvent évoluer. Les présentes CGU peuvent être mises à jour ; la date de dernière mise à jour est indiquée en tête de cette page. En cas de modification substantielle, une information sera fournie aux utilisateurs actifs par un moyen raisonnable.</p>
  </section>

  <section>
   <h2>13. Limitation de responsabilité</h2>
   <p>ProspectOS ne garantit pas :</p>
   <ul>
    <li>l’exactitude absolue ou l’exhaustivité des informations trouvées ou affichées ;</li>
    <li>un résultat commercial, un taux de conversion ou un volume de prospects qualifiés déterminé ;</li>
    <li>la conformité automatique d’une campagne de prospection menée à partir de ProspectOS ;</li>
    <li>la licéité automatique d’une prise de contact réalisée à partir des informations qu’il fournit.</li>
   </ul>
   <p>Dans les limites permises par la loi, la responsabilité de {EDITOR.name} ne saurait être engagée au titre de dommages indirects, de perte de chiffre d’affaires ou d’opportunité commerciale résultant de l’utilisation de ProspectOS.</p>
  </section>

  <section>
   <h2>14. Droit applicable</h2>
   <p>Les présentes CGU sont soumises au droit français. Tout litige relève, à défaut de résolution amiable, des juridictions françaises compétentes.</p>
  </section>

 </LegalPage>;
}
