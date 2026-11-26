# Cockpit administrateur

Décision du propriétaire du 26 nov. 2026. Le cockpit est visible uniquement par le compte administrateur, c'est-à-dire un
droit `INTERNAL` actif. Il est livré en trois PR, une par écran : **Fil** (celle-ci), **Clients** et **Pipeline**. Chaque PR
est fusionnée après accord du propriétaire.

## Accès

- La page est `/cockpit` (jamais indexée). Le lien « Cockpit » apparaît dans le menu du compte, pour l'administrateur
  seulement.
- La base de données refuse tout le reste :
  - `admin_feed` vérifie le droit `INTERNAL` ;
  - RLS cache chaque ligne de `admin_events` et `contact_requests` à tout autre compte ;
  - un visiteur anonyme n'a aucun droit sur ces tables.
- Les tests `tests/admin-cockpit-db.mjs` (partie « RLS ») le prouvent : un compte client ne lit, n'appelle et n'écrit rien du
  cockpit, pas même ses propres événements.
- Aucune fonction CRM côté client.

## Le journal `admin_events` (migration 056)

Le journal est **en ajout seul** : aucun rôle, pas même le propriétaire de la table, ne peut le modifier, le supprimer ou le
vider.

Chaque ligne contient :
- le type d'événement et sa date ;
- l'organisation, si l'événement en concerne une ;
- une **référence** vers l'objet source (`source_table`, `source_id`) ;
- quelques codes dans `detail` (une offre, un statut Stripe, un code d'erreur). Jamais un nom, une adresse e-mail ou un
  montant.

L'écran relit chaque source au moment de l'affichage. Si la source n'existe plus (par exemple une demande supprimée au bout
de 12 mois), l'écran l'indique.

| Type | Source | Écrit par |
|---|---|---|
| Inscription | `organizations` | déclencheur à la création de l'organisation |
| Fin d'essai | `account_entitlements` (BETA échu) | tâche quotidienne `/api/cron/cockpit` (`sweep_admin_events`) |
| Facture payée | `stripe_webhook_events` (`invoice.paid`) | déclencheur sur `billing_accounts` |
| Paiement échoué | `stripe_webhook_events` (`invoice.payment_failed`) | déclencheur sur `billing_accounts` |
| Changement d'offre | événement Stripe qui change l'offre (première souscription comprise) | déclencheur sur `billing_accounts` |
| Résiliation | `cancel_at_period_end` passé à vrai, ou statut `canceled` | déclencheur sur `billing_accounts` |
| Demande de veille | `contact_requests` (WATCH) | formulaire `/demande-veille` |
| Demande « 3 prospects » | `contact_requests` (PROSPECTS) | formulaire `/prospects-de-votre-zone` |
| Candidature partenaire | `partner_applications` | journal partenaires (052) |
| Partenaire inscrit | `partner_journal` (PARTNER_CREATED) | journal partenaires (052) |
| Commission due | `partner_statements` payable | relevé mensuel (052) |
| Échec de collecte | tâche et jour | `record_collect_failure`, appelée par la collecte et l'enrichissement |

`dedupe_key` est unique. Rejouer un événement Stripe, relancer le balayage ou subir une deuxième panne le même jour n'ajoute
donc jamais de ligne.

L'historique Stripe antérieur à la migration n'est pas reconstruit. La reprise initiale couvre :
- les organisations ;
- les essais échus ;
- les événements partenaires ;
- les relevés payables.

## Formulaires

Le formulaire « Demander un devis » de veille dédiée (`/demande-veille`) remplace les liens `mailto`.

Le formulaire « 3 prospects de votre zone » est désormais **enregistré** lui aussi. Les deux sont enregistrés dans
`contact_requests` par la fonction serveur `submit_contact_request`. Les demandes sont supprimées 12 mois après leur envoi par
la tâche de conservation (`run_retention`). Le texte de consentement et la politique de confidentialité (sections 3.6, 5, 6
et 8 ; version du 2026-11-26) le disent.

## Notifications push (ntfy)

Quatre types d'événements déclenchent une notification :
- demande de veille ;
- paiement échoué ;
- résiliation ;
- commission à verser.

Chaque événement concerné entre dans une file (`prospectos_private.admin_push_queue`). La notification est envoyée tout de
suite après la demande, l'événement Stripe ou le relevé qui l'a créée. La tâche quotidienne rattrape les envois manqués. Un
envoi est retenté jusqu'à 5 fois.

Le message contient seulement le type d'événement et le lien vers `/cockpit`. Aucun nom, aucune adresse e-mail, aucun
montant ne sort de ProspectOS.

| Variable | Rôle |
|---|---|
| `NTFY_TOPIC` | Obligatoire. Nom de sujet aléatoire de 16 à 64 caractères, gardé secret. Qui le connaît lit les messages. |
| `NTFY_URL` | Facultatif. `https://ntfy.sh` par défaut, https uniquement. |
| `NTFY_TOKEN` | Facultatif. Jeton d'accès si le sujet est protégé. |

Sans `NTFY_TOPIC`, rien n'est envoyé : la file attend.

## Retour arrière

Le retour arrière est décrit dans l'en-tête de `db/migrations/056_admin_cockpit.sql`.

## Écran Clients (migration 059)

L'onglet « Clients » de `/cockpit` présente une fiche par organisation. La liste se cherche par nom d'organisation ou par
e-mail du propriétaire. La fiche contient :

- **Offre** : plan, statut, début et fin, sièges.
- **Usage** :
  - projets et prospects ;
  - recherches et analyses IA sur 30 jours ;
  - recherches en tout ;
  - dernière activité.
- **Facturation Stripe** :
  - état de l'abonnement tel que stocké (`billing_accounts`) ;
  - résiliation demandée ou non ;
  - lien vers le client dans le tableau de bord Stripe ;
  - les 12 dernières factures, lues dans Stripe au moment de l'affichage et jamais stockées, chacune avec un lien vers le
    tableau de bord. Jamais de lien public de facture.
- **Veille dédiée** : contrats, livraisons, dernière livraison.
- **Partenaire d'origine** : partenaire et date de l'attribution.
- **Notes de l'administrateur** (`admin_notes`) : horodatées, avec leur auteur, en ajout seul. On ne les modifie ni ne les
  supprime : on ajoute une nouvelle note pour corriger.
- **Derniers événements** : ceux du Fil pour l'organisation.

Accès : `admin_clients`, `admin_client` et `admin_add_note` vérifient le droit `INTERNAL`, et RLS cache les notes à tout autre
compte. La base refuse la fiche avant que Stripe ne soit interrogé. Le test `tests/admin-clients-db.mjs` vérifie qu'un compte
client, même propriétaire de l'organisation, et un visiteur anonyme ne lisent, n'appellent et n'écrivent rien.

## Écran Pipeline (migration 060)

L'onglet « Pipeline » de `/cockpit` suit les demandes reçues par les deux formulaires publics : « 3 prospects de votre
zone » et « veille dédiée » (`contact_requests`, migration 056). Elles sont rangées en six colonnes : **Nouveau**,
**Contacté**, **Démo**, **Devis**, **Signé** et **Perdu**. Un filtre affiche toutes les demandes, ou celles d'un seul
formulaire.

- **Sur ordinateur** (à partir de 1 000 px), les colonnes sont côte à côte : on glisse une carte d'une colonne à l'autre.
- **Sur téléphone**, les colonnes se suivent et chaque carte a un sélecteur de statut. Ce sélecteur existe aussi sur
  ordinateur, pour le clavier.
- **Chaque carte** montre le formulaire d'origine, l'activité et la cible, le département, la société, l'e-mail (lien
  `mailto:`, sans aucun envoi automatique), le message, la date d'envoi et le dernier déplacement.
- **Un déplacement** s'affiche tout de suite, puis le serveur le confirme. Il est versionné : un déplacement fait depuis un
  écran périmé (autre onglet, autre appareil) est refusé (409) et le tableau est rechargé. Un déplacement plus récent n'est
  donc jamais écrasé.
- **Données** :
  - `admin_pipeline` garde le statut courant. Sans ligne, la demande est « Nouveau ».
  - `admin_pipeline_moves` garde l'historique, en ajout seul.
  - Les deux sont supprimés avec leur demande, 12 mois après l'envoi (rétention de 056).
  - Le tableau affiche les 500 demandes les plus récentes.

Accès : `admin_pipeline` et `admin_pipeline_move` vérifient le droit `INTERNAL`, et RLS cache les deux tables à tout autre
compte. Le test `tests/admin-pipeline-db.mjs` vérifie qu'un compte client et un visiteur anonyme ne lisent, n'appellent et
n'écrivent rien.
