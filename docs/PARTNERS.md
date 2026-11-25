# Programme partenaires

Migration 052 · `src/partners/` · `src/server/billing/partners.ts` · `src/ui/v2/partners/` · tests `tests/partner-program*.{ts,mjs}`.

## But

Un partenaire (agence, consultant, expert-comptable…) recommande ProspectOS. Il reçoit **30 % du montant HT payé** par chaque client qu'il apporte, pendant les **12 mois** qui suivent le premier paiement de ce client.

Le programme suit la même logique que la veille dédiée (migration 043) :

- un journal en ajout seul ;
- un relevé mensuel ;
- une RLS stricte ;
- aucune écriture directe dans les tables : tout passe par les fonctions de la migration.

## Activation

| Variable | Effet |
|---|---|
| `NEXT_PUBLIC_PARTNERS_ENABLED=true` | Active les pages `/partenaires`, `/partenaires/espace` et `/partenaires/admin`, la capture de `?ref=`, le champ « Code partenaire » à l'inscription, les routes `/api/v1/partners/…` et `/api/public/partenaires`, les lignes de commission dans le webhook Stripe, la copie du `partner_id` dans les métadonnées Stripe et le job mensuel. |
| *(absente, valeur par défaut)* | Pages et routes en 404, pas de champ ni de capture. Le webhook et le paiement fonctionnent exactement comme avant. Le job ne fait rien. |

La variable est lue au **build** côté navigateur (préfixe `NEXT_PUBLIC_`) : après l'avoir changée, il faut redéployer.

## Partenaires

- **Création** : réservée à l'administrateur (droit `INTERNAL` `ACTIVE`), depuis `/partenaires/admin`. Champs :
  - nom et entreprise ;
  - SIRET obligatoire, dont la clé de contrôle (Luhn) est vérifiée ;
  - e-mail ;
  - code unique : 3 à 20 lettres majuscules ou chiffres ;
  - taux : 30 % par défaut, 50 % au plus.
- **Statut** : actif ou suspendu.
  - Suspendu : les nouvelles inscriptions ne lui sont plus attribuées.
  - Ses commissions déjà acquises restent dues et continuent d'être comptées.
- **Compte ProspectOS** : facultatif. L'espace `/partenaires/espace` s'ouvre au compte dont l'**e-mail confirmé** est celui du partenaire. Il est relié à ce compte à la première ouverture.

## Attribution, sans cookie

1. **Lien** : `?ref=CODE` sur n'importe quelle page garde le code dans le `sessionStorage` de l'onglet. Il n'y a ni cookie ni `localStorage`.
2. **Champ** : à l'inscription, le champ « Code partenaire » est pré-rempli avec ce code. Il reste modifiable et facultatif.
3. **Enregistrement** : le code part avec le compte (`user_metadata.partner_code` de Supabase Auth). Il survit donc à la confirmation de l'e-mail, même ouverte dans un autre onglet.
4. **Attribution** : quand ce compte crée sa **première** organisation, un déclencheur renseigne `organizations.referred_by` et `referred_at`. Cela n'arrive qu'une seule fois.
   - **Ignoré, sans bloquer l'inscription** : un code inconnu.
   - **Refusés et inscrits au journal** :
     - un partenaire suspendu ;
     - l'e-mail ou le compte du partenaire lui-même (auto-parrainage) ;
     - un compte qui avait déjà une organisation.
5. **Verrou** : ensuite, `referred_by` et `referred_at` ne changent plus. Seule exception : `set_organization_referral` (administrateur), qui exige une raison et l'inscrit au journal (ancien partenaire, nouveau partenaire, raison).

## Commissions

- **`invoice.paid`** :
  1. le serveur relit la facture chez Stripe (montant payé, HT, date de paiement, mode TEST ou LIVE) ;
  2. la base retrouve le client grâce au lien client Stripe → utilisateur (migration 017), puis l'organisation attribuée qu'il possède ;
  3. si la facture est payée dans les 12 mois qui suivent le **premier paiement** de ce client, une ligne est créée : montant HT payé × taux, avec la référence de la facture Stripe.
- **Unicité** : une facture ne crée jamais deux lignes, même si le webhook est rejoué.
- **Montant HT** : on prend ce qui a été payé (`amount_paid`), dans la proportion HT/TTC de la facture (`total_excluding_tax / total`). Sous la franchise de TVA, les deux montants sont égaux.
- **`charge.refunded`** :
  - le serveur relit le paiement chez Stripe ; la facture est retrouvée par son paiement (API `2025-03-31.basil`) ;
  - la base ajoute une ligne **négative**, proportionnelle au montant remboursé : un remboursement total annule toute la commission ;
  - un événement rejoué ou plus ancien n'ajoute rien.
- **Pas de ligne** :
  - un client non attribué ;
  - une facture payée avant l'attribution ;
  - une autre devise que l'euro ;
  - une facture à 0 € ;
  - une facture payée plus de 12 mois après le premier paiement.
- **Journal en ajout seul** : `partner_commissions`, `partner_journal`, `partner_first_payments`, `partner_statements` et `partner_payouts` refusent tout `UPDATE`, `DELETE` et `TRUNCATE`, pour tous les rôles, propriétaire compris.

## Relevé et versement

- **Job** : `/api/cron/partner-statements` tourne chaque jour à 06:47 UTC. Le passage du 1er du mois établit le relevé du mois précédent pour chaque partenaire ; les autres passages ne trouvent rien de nouveau. Le relevé contient :
  - les clients apportés ;
  - les paiements ;
  - les commissions du mois ;
  - le solde cumulé (commissions − versements).
- **Seuil** : 50 €. En dessous, le relevé est « reporté » et le solde passe au relevé suivant.
- **Versement** : l'administrateur marque **le dernier relevé payable** d'un partenaire comme payé, avec la date et la référence du virement. Il n'y a **aucun virement automatique**.
- **Alerte** : quand des relevés sont établis, un e-mail le signale à l'administrateur, s'il y a une configuration SMTP. Il est envoyé à `DEDICATED_NOTIFY_EMAIL`, à défaut à l'adresse de contact.

## Espaces

- **`/partenaires/espace`** (partenaire) :
  - son lien et son code ;
  - le nombre d'inscrits et de clients payants ;
  - les commissions du mois et le solde ;
  - chaque ligne de commission et chaque relevé.

  Chaque client n'apparaît que sous une **référence anonyme** (`C-XXXXXX`), avec un montant : jamais de nom, d'e-mail ni d'organisation.
- **`/partenaires/admin`** (administrateur) :
  - les relevés à payer ;
  - tous les partenaires avec leurs soldes ;
  - la création d'un partenaire, éventuellement pré-remplie depuis une candidature ;
  - les candidatures.
- **`/partenaires`** (public) :
  - le programme en bref : uniquement les règles appliquées par le produit ;
  - les conditions : le texte fourni par Kevin, à coller tel quel dans `src/partners/terms.ts` ; d'ici là, la page affiche « [À FOURNIR] » et n'est pas indexée ;
  - le formulaire de candidature : la candidature est enregistrée pour l'administrateur et signalée par e-mail à `contact@prospectos.fr`. La validation se fait à la main.
- **Banc Preview** : `/ui-v2/partenaires?view=space|admin` affiche les deux écrans sur des données fictives. Il n'est servi que si `UI_V2_BENCH_ENABLED` est actif, et jamais en production.

## Qui voit quoi (RLS)

| Table | Administrateur | Partenaire | Client |
|---|---|---|---|
| `partners` | tout | sa ligne | rien |
| `partner_statements`, `partner_payouts` | tout | les siens | rien |
| `partner_commissions`, `partner_journal`, `partner_first_payments`, `partner_applications` | tout | rien (il les voit via `partner_space()`, anonymisés) | rien |

## Configuration Stripe

1. **Événements du webhook** : ajouter **`charge.refunded`** à l'endpoint existant `/api/v1/billing/stripe/webhook`, en TEST puis en LIVE. `invoice.paid` est déjà envoyé. Le secret de signature ne change pas.
2. **Version d'API** : le serveur appelle Stripe en `2025-03-31.basil` (épinglée). Aucun réglage n'est à faire, mais les factures et paiements relus doivent exposer `total_excluding_tax`, `status_transitions.paid_at` et la liste `invoice_payments`, ce qui est le cas dans cette version.
3. **Clé restreinte** (si `STRIPE_SECRET_KEY` est une clé restreinte) : ajouter la lecture des **Invoices** et des **Charges** (Invoice Payments inclus), ainsi que l'écriture des **Customers**, nécessaire aux métadonnées.
4. **Métadonnées** : rien à créer. `prospectos_partner_id` est écrit par ProspectOS sur le client et l'abonnement au moment du paiement. C'est une information de lecture : la commission est décidée par la base, pas par ce champ.
5. **Virements aux partenaires** : ils sont faits à la main, hors Stripe. Aucun Stripe Connect n'est nécessaire.

## Avant d'activer

- **Migration** : appliquer `052_partner_program.sql` en staging, puis en production.
- **Conditions** : coller le texte des conditions dans `src/partners/terms.ts`.
- **Politique de confidentialité** : ajouter les candidatures partenaires et l'attribution aux finalités. Ce point est hors de cette PR.
- **Stripe** : faire les étapes ci-dessus, en TEST puis en LIVE.
- **Vercel** : `NEXT_PUBLIC_PARTNERS_ENABLED=true` en Preview pour l'essai, puis en Production, et redéployer.

## Rollback

Voir l'en-tête de la migration. Ne le faire que tant qu'aucun partenaire n'a été payé : le journal est la preuve des deux parties.
