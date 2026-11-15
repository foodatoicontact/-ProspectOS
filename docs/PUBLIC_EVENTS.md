# Collecte nationale des événements publics

Migration 045 · `src/collect/` · `app/api/cron/collect` · tests `tests/public-events*.{ts,mjs}`.

## Principe

On collecte une fois, pour toute la France, puis on trie pour chaque client.

Chaque nuit, la tâche `/api/cron/collect` (03:13 UTC) enregistre les annonces BODACC des deux jours précédents, une seule fois chacune. Ces annonces sont ensuite partagées par tous les clients de la veille dédiée :

| Famille BODACC | Événement enregistré |
|---|---|
| Créations | `CREATION`, ou `ETABLISSEMENT` pour un établissement secondaire |
| Modifications annonçant un transfert du siège | `TRANSFERT_SIEGE` |
| Ventes et cessions (côté acheteur) | `VENTE_FONDS` |

Volume constaté le 6 novembre 2026, pour toute la France : 1 988 créations, dont 743 personnes morales conservées ; 199 ventes ; 210 transferts. Cela représente quelques mégaoctets par jour.

## Fiches entreprises

Pour chaque SIREN, un seul appel à l'API Recherche d'entreprises récupère la fiche, gardée 30 jours et réutilisée par tous les clients. Elle contient :
- l'activité (code NAF) ;
- la forme juridique ;
- la tranche d'effectif ;
- l'état : active ou fermée ;
- si c'est une entreprise individuelle ;
- l'opposition à la prospection commerciale.

L'enrichissement ne concerne que les départements utiles. Pour l'instant, ils sont listés dans `PUBLIC_EVENTS_ENRICH_DEPARTMENTS` ; ensuite, ce sera les profils des clients. Les appels sont limités à 6 par seconde, dans un budget de 55 secondes par passage.

## Protection des données

- **Personnes physiques** : seules les personnes morales sont enregistrées. Une annonce qui concerne une personne physique n'est jamais écrite ; elle est seulement comptée (`skipped_persons`).
- **Dirigeants** : aucun dirigeant ni aucune adresse personnelle n'est conservé. Pour une entreprise individuelle, le nom n'est pas gardé.
- **Accès** : aucun rôle navigateur ne lit ni n'écrit ces tables. Seul le serveur y accède, via des fonctions réservées à `service_role`.
- **Durée de conservation** : `purge_public_events` supprime les annonces au-delà de la date indiquée, avec au moins 30 jours de recul.

## Activation

| Variable | Effet |
|---|---|
| `PUBLIC_EVENTS_COLLECT_ENABLED=true` | Active la collecte nocturne. Sans elle, la tâche ne fait rien. |
| `PUBLIC_EVENTS_ENRICH_DEPARTMENTS` | Départements à enrichir, par exemple `75,77,78,91,92,93,94,95`. Vide : pas d'enrichissement. |

## Suite

- Profils de veille par client : départements, événements, activités, effectif minimal.
- Écran « Préparer la livraison », qui remplit la livraison directement depuis le cache.
- Inspections Géorisques (installations classées).
