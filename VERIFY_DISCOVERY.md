# Vérification du Discovery Engine

Date : 16 septembre 2026. Branche : `feat/discovery-engine`. Extension de la V0, moteur `src/domain/core.ts` conservé sans modification.

## Exécuté

| Commande | Résultat |
| --- | --- |
| `npm test` | 53 tests, 53 réussis, 0 échec |
| `npm run test:db` | PASS : schéma V0, rôles A/B et anon, RLS PostgreSQL |
| `node tests/discovery-db.mjs` | PASS : cycle discovery, acceptation, observations, revue, score, contradiction, FK, isolation, idempotence, quotas et droits RPC |
| `npm run typecheck` | PASS |
| `npm run build` | PASS après suppression du cache généré `.next` |
| `git diff --check` | PASS |

Une première build a échoué dans le cache interne Turbopack (`static_sorted_file`, index hors limites). Le cache `.next` a été supprimé, puis la même commande de build a réussi, sans contournement du compilateur.

Les fixtures ne dépendent pas d’Internet. Tests unitaires : domaine/téléphone, déduplication/fuzzy, signaux Foodatoi, UNKNOWN, propositions non vérifiées, provider Brave avec transport simulé et sécurité HTTP/DNS/robots/redirections/délais/taille. Tests d’intégration : discovery avec faux provider, analyse de faux site et liens pertinents de même origine, refus avant fetch d’un prospect inaccessible. Le transport HTTP natif est également testé sur une connexion locale contrôlée.

Les tests PostgreSQL utilisent PGlite, un moteur PostgreSQL réel en WebAssembly, avec identités Auth simulées. Le test transmet désormais les observations réelles de l’extracteur au RPC : téléphone brut et plateforme contextuelle sont sauvegardés sans preuve. Une preuve confirmée ajoute des points via le moteur V0 ; sa contradiction retire les points.

## Revue et corrections

Revue indépendante du transport SSRF et revue indépendante SQL/API/UI. Corrections : adresse DNS fixée pour Node 24, nettoyage des corps lors des interruptions, liste d’hôtes obligatoire, enregistrement des observations contextuelles sans evidence, prévention des doubles preuves via l’ancien bouton et invalidation des brouillons lors des revues concurrentes. Les corrections UI ont été relues ; elles n’ont pas fait l’objet d’une recette interactive navigateur.

## Non vérifié / limitations

- Aucun appel Brave réel avec clé : adaptateur implémenté, HTTP simulé seulement. Provider TEST réellement utilisable et explicitement synthétique.
- Aucune migration appliquée sur une base Supabase distante. Auth cloud, PostgREST et parcours de deux comptes réels restent à recetter.
- Smoke HTTP tenté avec `next start --port 3137` et Python urllib : aucun résultat conclusif retourné, non compté comme réussi.
- Pas de validation visuelle/mobile interactive dans cet environnement. La build réussie ne vaut pas test navigateur.
- Quotas testés séquentiellement ; verrou transactionnel présent mais concurrence multi-connexion non exercée.
- Les sites réels de la démo ont été consultés pour préparer cinq fiches sourcées. Cela ne valide pas le collecteur serveur en production : hôtes autorisés et conditions d’accès restent à configurer.
- Recherche synchrone, Brave limité à un appel de 20 résultats ; pas de pagination ni de worker persistant. Une interruption serveur peut laisser un run en cours.
- Trois pages maximum par analyse, règles lexicales conservatrices : une absence de signal reste inconnue. Pas de métriques sociales sans source fiable.
- Les cinq fiches réelles démarrent avec des preuves non vérifiées et un score zéro. Une précédente démo locale n’est pas écrasée.
- Aucun déploiement Vercel effectué dans ce bloc, aucun message ni action LinkedIn envoyé.

## Livré

Migration `002_discovery.sql`, trois tables publiques et quota privé, providers interchangeables, services métier, routes REST, formulaire de découverte/résultats/revue, fixtures et tests, cinq fiches Foodatoi réelles sourcées, README, SECURITY et présent rapport. Le code est prêt pour une recette connectée après configuration ; il n’est pas déclaré validé en production.
