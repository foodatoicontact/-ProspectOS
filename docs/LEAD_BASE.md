# Base entreprises de la veille

Migration 049 · `src/leads/` · `src/ui/v2/dedicated/LeadBase.tsx` · tests `tests/lead-base*.{ts,mjs}`.

## Pourquoi

La veille ne doit plus repartir de zéro à chaque livraison. Tout ce que ProspectOS apprend sur une entreprise s'accumule sous son **SIREN** (demande du propriétaire, 18 novembre 2026) :

- les annonces officielles collectées chaque nuit (`public_events`, migration 045) ;
- la fiche entreprise : activité, effectif, opposition à la prospection (`company_cache`) ;
- les listes déjà produites (`prospect_lists`, migration 046) ;
- les livraisons et ce que chaque client en a fait : contacté, devis, signé, perdu (`dedicated_items`, migration 043).

Les leads se répartissent ensuite entre les clients de la veille, sans doublon entre concurrents.

## Profil d'un client

Le profil s'ouvre depuis le menu Veille dédiée — clients → la carte du client → **Base entreprises**. Il indique :

- le **métier** (« Sécurité incendie », « Référencement IA ») ;
- les **départements** ;
- les **événements** suivis : reprises de fonds, transferts de siège, nouveaux établissements, créations ;
- en option, des **débuts de code NAF** (55 pour l'hôtellerie, 56.10 pour la restauration).

Enregistrer le profil réserve aussi, pour ce métier, toutes les entreprises déjà livrées au client.

## Exclusivité par métier

Décision du propriétaire du 18 novembre 2026 :

- un lead réservé pour un client **ne peut plus aller chez un autre client du même métier** ;
- un client d'un **autre métier** peut recevoir la même entreprise. Par exemple, Détec et Capston peuvent recevoir le même hôtel.

La base de données fait respecter cette règle :

- une seule réservation active par couple SIREN + métier (index unique) ;
- toute livraison réserve ses entreprises ;
- une livraison qui contient une entreprise réservée par un concurrent du même métier est refusée, quelle que soit la façon dont la liste a été faite (`lead_reserved_for_other_client`) ;
- « Libérer » remet un lead dans le vivier de son métier.

## Vivier trié

Le vivier d'un client, sur 60 jours, contient les entreprises qui remplissent toutes ces conditions :

- elles sont actives ;
- elles ne s'opposent pas à la prospection ;
- ce ne sont pas des entreprises individuelles ;
- elles se trouvent dans ses départements et correspondent à ses événements et à ses codes NAF ;
- elles ne lui ont pas encore été livrées ;
- elles ne sont pas réservées par un concurrent de son métier.

**Ordre d'affichage :** les reprises de fonds d'abord, puis les transferts, les établissements et les créations. Ensuite la plus récente, puis l'effectif le plus élevé. Le classement suit le taux d'opposition : environ 87 % des sociétés nouvellement créées en Île-de-France s'opposent à la prospection.

**Compteur :** les entreprises qui attendent encore leur fiche (enrichissement de nuit) sont comptées à part, jamais proposées.

**Préparer la livraison :** ce bouton remplit le formulaire « Nouvelle livraison » (liste simple) avec les leads réservés.

## Historique d'une entreprise

`GET /api/v1/leads/companies/<siren>` renvoie tout ce qui est connu sur une entreprise :

- sa fiche ;
- ses annonces ;
- les listes où elle apparaît ;
- ses réservations ;
- son statut chez chaque client.

## Accès

- **Administrateur seulement :** toutes les fonctions SQL vérifient le droit `INTERNAL ACTIVE`.
- **Aucun accès navigateur aux tables :** RLS activée, aucune règle d'accès.
- **Côté client :** rien de nouveau.
- **Activation :** tout passe par l'interrupteur `DEDICATED_TRACKING_ENABLED`.

## Livraison générée depuis la base

Ajouté le 18 novembre 2026 : la liste de la semaine est préparée depuis la base, sans document fait à la main. Dans le panneau **Base entreprises**, le bouton **« Aperçu de la livraison »** affiche le document que recevra le client.

**Contenu du document** (`buildLeadDelivery`, `src/leads/model.ts`) :
- **un en-tête** : client, métier, départements, date ;
- **des sections par type d'événement**, dans cet ordre : reprises de fonds, déménagements, nouveaux établissements, créations ;
- **une carte par lead réservé**, qui reprend uniquement l'annonce :
  - **Le fait** : ce que l'annonce BODACC publie, avec l'activité indiquée ;
  - **Pourquoi maintenant** : une phrase générale sur ce type d'événement, jamais une affirmation sur l'entreprise ;
  - **Votre accroche** : « J'ai vu dans le BODACC du … que … » ;
  - **Puces** : code NAF et effectif ;
  - **Lien** vers la source officielle.

Un lead réservé qui n'a ni nom ni source https est écarté et compté, jamais complété.

**« Livrer à <client> »** crée la livraison (`create_dedicated_delivery`, sans PDF). Le client la voit dans son espace de veille, avec ses statuts et son journal, et reçoit une notification dans la cloche. Les réservations deviennent des livraisons. **Rien ne part sans le clic de l'administrateur**, ni par e-mail ni automatiquement.
