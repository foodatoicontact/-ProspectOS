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

L'enrichissement tourne à deux moments :
- **Après la collecte**, dans le temps qui reste à `/api/cron/collect`.
- **Dans trois passages dédiés**, `/api/cron/enrich/1`, `/2` et `/3`, vers 04:07, 05:07 et 06:07 UTC. Chaque passage dispose d'une minute entière, soit environ 250 fiches.

Il y a trois tâches distinctes parce que l'offre Vercel n'autorise qu'une exécution par jour pour chaque tâche. La séparation est nécessaire depuis le 17 novembre 2026 : ce jour-là, le BODACC a publié plus de 500 annonces pour la seule Île-de-France.

**Ordre de traitement** : ventes de fonds, puis transferts de siège, puis nouveaux établissements, puis créations. Une entreprise reprise ou qui déménage est déjà en activité et ne s'oppose presque jamais à la prospection. Au contraire, la plupart des sociétés nouvellement créées s'y opposent : environ 87 % en Île-de-France, constaté entre le 16 et le 18 novembre 2026. Si une nuit ne suffit pas, ce sont les créations qui attendent la nuit suivante.

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
