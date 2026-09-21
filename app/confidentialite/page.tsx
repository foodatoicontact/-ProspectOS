import type {Metadata} from 'next';
import {LegalPage} from '../../src/components/LegalPage';
import {EDITOR, MISSING, PRIVACY_VERSION} from '../../src/domain/legal';
import {SITE_URL} from '../../src/domain/seo';

export const metadata:Metadata={
 title:{absolute:'Politique de confidentialité | ProspectOS'},
 description:'Politique de confidentialité et protection des données de ProspectOS : données traitées, finalités, prestataires, durées de conservation et droits RGPD.',
 alternates:{canonical:`${SITE_URL}/confidentialite`},
 robots:{index:true,follow:true},
};

export default function Page(){
 return <LegalPage title="Politique de confidentialité" updated={PRIVACY_VERSION} currentPath="/confidentialite">

  <section>
   <h2>1. Responsable du traitement</h2>
   <p>Le responsable du traitement des données décrites ci-dessous est {EDITOR.name}. Ses coordonnées complètes d’identification légale figurent dans les <a href="/mentions-legales">mentions légales</a> ; certaines d’entre elles restent marquées <span className="missing">{MISSING}</span> et doivent être complétées par l’exploitant avant toute commercialisation.</p>
  </section>

  <section>
   <h2>2. Cette politique décrit ce que ProspectOS fait réellement</h2>
   <p>Cette politique reflète l’architecture technique réelle de ProspectOS au {PRIVACY_VERSION}, telle qu’auditée directement dans son code et sa base de données au moment de sa rédaction — pas un modèle générique. Elle sera mise à jour si le traitement change.</p>
  </section>

  <section>
   <h2>3. Catégories de données traitées</h2>

   <h3>3.1 Données de votre compte ProspectOS</h3>
   <ul>
    <li>Email et identifiant technique de compte (gérés par l’authentification Supabase).</li>
    <li>Organisation(s) dont vous êtes membre et votre rôle (owner/member).</li>
    <li>Statut d’accès (bêta, interne, expiration éventuelle) — voir la section bêta ci-dessous.</li>
    <li>Contenu que vous créez : projets, critères ICP (profil de client idéal), messages préparés, historique d’actions liées à votre organisation.</li>
   </ul>

   <h3>3.2 Données relatives aux prospects B2B que vous recherchez ou documentez</h3>
   <p>Voir la section 4 dédiée ci-dessous : ces données concernent des entreprises et, le cas échéant, des informations professionnelles publiques les concernant (nom d’établissement, site web, ville, coordonnées professionnelles, extraits de pages publiques consultées comme preuve).</p>

   <h3>3.3 Données techniques et de facturation d’usage</h3>
   <ul>
    <li>Journal d’usage des fournisseurs IA/recherche (fournisseur, modèle, nombre de jetons ou de requêtes, coût estimé, source de facturation) — enregistré de façon immuable (aucune modification ni suppression possible) à des fins de facturation et d’audit interne. Ce journal ne contient jamais le contenu de vos textes, ni les réponses des fournisseurs, ni aucun secret.</li>
    <li>Quotas horaires d’usage par organisation.</li>
    <li>Journal d’événements d’activité (ex. génération d’un message, export de compte demandé), horodaté et rattaché à votre organisation.</li>
   </ul>

   <h3>3.4 Identifiants de connexion à un fournisseur IA personnel (BYOK)</h3>
   <p>Si vous choisissez d’utiliser votre propre clé d’API Anthropic plutôt que celle fournie par défaut par ProspectOS (« BYOK »), cette clé est chiffrée (AES-256-GCM) avant tout enregistrement, jamais stockée ni renvoyée en clair, et seuls ses quatre derniers caractères sont conservés lisibles pour vous permettre de la reconnaître. La clé déchiffrée n’est jamais journalisée, jamais retournée par l’interface, et n’existe en clair que le temps strictement nécessaire à l’appel au fournisseur IA.</p>
  </section>

  <section>
   <h2>4. Données concernant les prospects B2B</h2>
   <p>ProspectOS aide à rechercher et qualifier des entreprises à partir d’informations professionnelles accessibles publiquement (résultats de recherche web, contenu public de sites d’entreprises) ou de sources que vous avez vous-même autorisées. Certaines de ces informations — une adresse email professionnelle nominative, un numéro de téléphone attaché à une personne identifiée, le nom d’un dirigeant d’entreprise individuelle — peuvent constituer des données à caractère personnel au sens du RGPD, même lorsqu’elles sont publiées publiquement par l’entreprise elle-même.</p>
   <p>Le fait qu’une information soit publiquement accessible ne signifie pas qu’elle est librement exploitable sans restriction. Il appartient à l’utilisateur de ProspectOS de disposer d’une base juridique appropriée pour sa démarche de prospection (notamment au regard des règles de prospection électronique et commerciale applicables en France et dans l’Union européenne), et de respecter les droits des personnes concernées si une donnée à caractère personnel est effectivement utilisée pour un contact.</p>
   <p>ProspectOS aide à rechercher, qualifier et documenter des prospects avec des preuves sourcées et une validation humaine avant toute action de contact ; il ne garantit pas la licéité de chaque prise de contact individuelle, qui reste sous la responsabilité de l’utilisateur exerçant sa propre activité de prospection.</p>
   <p>Les observations et preuves associées à un prospect conservent leur URL source, un extrait du contenu consulté, la date de consultation et un statut de vérification (non vérifiée, vérifiée, contredite) — jamais un fait inventé sans source.</p>
  </section>

  <section>
   <h2>5. Finalités et bases juridiques</h2>
   <ul>
    <li><b>Fourniture du service</b> (création de compte, gestion d’organisation, projets, ICP) — exécution du contrat vous liant à ProspectOS (voir les <a href="/cgu">CGU</a>).</li>
    <li><b>Recherche et qualification de prospects B2B (Discovery)</b> — intérêt légitime de l’utilisateur professionnel à identifier des cibles commerciales pertinentes, sous réserve du respect par l’utilisateur des règles de prospection applicables.</li>
    <li><b>Analyse assistée par IA de votre propre offre commerciale</b> — exécution du contrat, à votre initiative explicite (fonctionnalité « Analyser un texte »).</li>
    <li><b>Sécurité, prévention des abus, quotas et facturation d’usage</b> — intérêt légitime de ProspectOS et de ses utilisateurs à un service fiable et correctement mesuré.</li>
    <li><b>Gestion de l’accès bêta</b> (durée, capacité) — exécution du contrat spécifique à la phase bêta (voir la section 7 des <a href="/cgu">CGU</a>).</li>
   </ul>
  </section>

  <section>
   <h2>6. Destinataires et sous-traitants</h2>
   <p>Les données sont hébergées et traitées par les prestataires suivants, dans le cadre strict des fonctions qu’ils assurent :</p>
   <ul>
    <li><b>Supabase</b> — hébergement de la base de données PostgreSQL et de l’authentification. Reçoit l’ensemble des données décrites en section 3.</li>
    <li><b>Vercel Inc.</b> — hébergement applicatif (exécution du site et de l’API ProspectOS).</li>
    <li><b>Anthropic</b> — lorsque la fonctionnalité d’analyse IA de votre offre est utilisée : reçoit le texte que vous soumettez volontairement à l’analyse (votre propre proposition commerciale, jamais une donnée de prospect saisie automatiquement), ainsi que, si vous utilisez votre clé personnelle (BYOK), cette clé — jamais en clair côté ProspectOS, transmise directement au fournisseur pour authentifier l’appel.</li>
    <li><b>Brave Search</b> — lorsque la recherche de prospects (Discovery) est utilisée en mode réel (non démonstration) : reçoit les termes de recherche que vous avez saisis (secteur d’activité, localisation) — jamais une donnée à caractère personnel identifiée individuellement.</li>
   </ul>
   <p>Anthropic et Brave Search sont des sociétés américaines : leur utilisation implique un transfert de données hors de l’Union européenne pour les seules données décrites ci-dessus. L’existence et la nature exacte des garanties contractuelles appropriées (clauses contractuelles types ou mécanisme équivalent) avec ces prestataires doivent être vérifiées et documentées précisément par l’exploitant avant toute ouverture commerciale à grande échelle ; cette politique ne peut pas, à elle seule, garantir cette conformité.</p>
   <p>Aucune donnée n’est vendue à un tiers. Aucun outil publicitaire, aucun revendeur de données, aucun courtier en données n’est utilisé.</p>
  </section>

  <section>
   <h2>7. Cookies et traceurs</h2>
   <p>ProspectOS n’utilise aucun cookie ou traceur de mesure d’audience, publicitaire ou marketing. Le seul mécanisme de stockage navigateur utilisé pour l’espace connecté est celui, strictement nécessaire, de la bibliothèque d’authentification Supabase, qui conserve votre session (jeton de connexion) dans le stockage local de votre navigateur afin de vous maintenir connecté — jamais transmis à un tiers, jamais utilisé à des fins de suivi ou de profilage.</p>
   <p>Le mode « démo » (sans compte) conserve les projets et prospects de démonstration que vous créez localement sur votre appareil, pour la durée de votre visite — jamais transmis à un serveur.</p>
   <p>Ces mécanismes étant strictement nécessaires au fonctionnement du service demandé par l’utilisateur, ils ne requièrent pas de recueil de consentement préalable au sens de l’article 82 de la loi Informatique et Libertés. Aucune bannière de consentement n’est donc affichée.</p>
  </section>

  <section>
   <h2>8. Durées de conservation</h2>
   <ul>
    <li><b>Compte et données d’organisation</b> : conservées tant que le compte est actif, puis selon les modalités décrites en section 9 en cas de suppression.</li>
    <li><b>Accès bêta</b> : la fenêtre d’accès (début, fin à 7 jours) est conservée comme historique de compte.</li>
    <li><b>Journal d’usage et de facturation (api_usage_events)</b> : conservé de façon permanente et immuable par construction technique (aucune mise à jour ni suppression n’est possible sur cette table), à des fins de facturation, d’audit et de preuve de coût. Ce journal ne contient pas de contenu de conversation IA ni de donnée de prospect.</li>
    <li><b>Références d’audit</b> (auteur d’une preuve vérifiée, actions historisées) : conservées même après le départ d’un membre, afin de préserver l’intégrité et la traçabilité des preuves partagées au sein d’une organisation — voir section 9.</li>
   </ul>
  </section>

  <section>
   <h2>9. Suppression de compte et anonymisation</h2>
   <p>ProspectOS propose une suppression de compte en libre-service, immédiate et sans avoir à contacter qui que ce soit :</p>
   <ul>
    <li>Vos informations d’authentification personnelles (email, mot de passe) sont anonymisées de façon permanente ; vous ne pouvez plus jamais vous reconnecter avec cette identité.</li>
    <li>Votre appartenance à votre ou vos organisations (memberships) est retirée.</li>
    <li>Les données appartenant à votre organisation et partagées avec d’autres membres (projets, prospects, preuves, historique) ne sont <b>pas</b> supprimées : ProspectOS ne peut pas décider unilatéralement qu’une donnée partagée entre plusieurs personnes appartient à vous seul.</li>
    <li>Certaines références techniques d’attribution (l’identifiant de la personne ayant vérifié une preuve, l’auteur d’une action historisée) sont conservées pour préserver l’intégrité et l’historique des preuves d’une organisation — elles ne sont jamais physiquement supprimées dans ce mécanisme, seule votre identité de connexion l’est.</li>
    <li>Si vous êtes le dernier propriétaire d’une organisation encore active (avec d’autres membres ou des données), la suppression est bloquée tant que vous n’avez pas transféré la propriété ou traité la situation de l’organisation.</li>
   </ul>
   <p>Cette suppression ne constitue jamais une effacement physique intégral de toutes les données historiques : elle ne doit pas être présentée ou comprise comme telle.</p>
  </section>

  <section>
   <h2>10. Export de vos données</h2>
   <p>Depuis votre espace Compte, vous pouvez à tout moment obtenir une archive de vos données (email, organisations, projets, ICP, prospects, preuves, canaux, messages préparés, historique), limitée aux données que votre compte peut légitimement consulter aujourd’hui. Aucun mot de passe, jeton d’authentification ni clé technique n’est jamais inclus dans cet export.</p>
  </section>

  <section>
   <h2>11. Sécurité</h2>
   <ul>
    <li>Isolation stricte entre organisations (multi-tenant) appliquée au niveau de la base de données (Row Level Security PostgreSQL), pas seulement dans l’interface.</li>
    <li>Chiffrement AES-256-GCM des clés d’API personnelles (BYOK) ; la clé de chiffrement n’est jamais accessible côté navigateur.</li>
    <li>Aucun rôle d’accès privilégié à la base de données (service role) n’est jamais exposé au navigateur.</li>
    <li>Communications chiffrées (HTTPS/TLS) via l’infrastructure de nos hébergeurs.</li>
   </ul>
   <p>Aucun système n’est totalement exempt de risque ; cette politique décrit les mesures en place, sans garantir une sécurité absolue.</p>
  </section>

  <section>
   <h2>12. Vos droits</h2>
   <p>Conformément au RGPD et à la loi Informatique et Libertés, vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation, d’opposition et de portabilité sur vos données à caractère personnel.</p>
   <ul>
    <li>Les droits d’<b>accès</b> et de <b>portabilité</b> sur vos propres données de compte et d’organisation peuvent être exercés directement via l’export en libre-service (section 10).</li>
    <li>Le droit d’<b>effacement</b> de votre compte peut être exercé directement via la suppression en libre-service (section 9), dans les limites qui y sont décrites.</li>
    <li>Pour toute autre demande (rectification, limitation, opposition, ou une question sur une donnée de prospect vous concernant que vous estimez inexacte), contactez : {EDITOR.legalEmail===MISSING?<span className="missing">{MISSING}</span>:EDITOR.legalEmail}.</li>
   </ul>
   <p>Vous disposez également du droit d’introduire une réclamation auprès de la Commission Nationale de l’Informatique et des Libertés (CNIL) — <a href="https://www.cnil.fr" target="_blank" rel="noreferrer">www.cnil.fr</a>.</p>
  </section>

  <section>
   <h2>13. Contact</h2>
   <p>Pour toute question relative à cette politique de confidentialité : {EDITOR.legalEmail===MISSING?<span className="missing">{MISSING}</span>:EDITOR.legalEmail}.</p>
  </section>

 </LegalPage>;
}
