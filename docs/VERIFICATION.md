# Vérification — 16 septembre 2026

## Exécuté
- `npm test` : 20 tests passés ; scoring, contradictions, péremption, preuve sans validateur, CSV, URL dangereuse, actions LinkedIn et extraction non vérifiante.
- `node tests/rls-runner.mjs` : schéma appliqué et assertions utilisateurs A/B/anonyme passées dans PGlite PostgreSQL. Transaction de test annulée.
- `npm run build` : build Next.js et vérification TypeScript réussies.

## Limites de validation
Le navigateur distant refuse l’accès à localhost (ERR_BLOCKED_BY_CLIENT). Aucun contrôle visuel ni test de clic complet desktop/mobile n’est donc revendiqué. La feuille de style comporte des adaptations mobile, à contrôler sur un navigateur qui peut atteindre le serveur.

Auth Supabase hébergé, PostgREST avec vrais JWT, fournisseurs OpenAI/Anthropic, SMTP et Vercel : non testés, connexions non configurées. Les projets Supabase existants n’ont pas été modifiés.

## Sécurité livrée
Aucune automatisation LinkedIn, aucune collecte privée, aucun secret livré. Les endpoints utilisent le JWT de l’utilisateur, pas de clé contournant la RLS. Les tests SQL contrôlent l’accès par tenant, les associations cross-tenant, l’adhésion non auto-attribuable et la protection de l’historique.

La version est un incrément V0 à connecter et valider, pas un SaaS commercial déclaré prêt.

## Revue de code
Revue indépendante réalisée. Corrections : purge de l’état client au changement de compte, invalidation des réponses de brouillon devenues obsolètes, annulation des chargements d’historique hors contexte et normalisation de la relation ICP. Les corrections UI ont été relues et compilées ; aucun test navigateur réussi n’est revendiqué.
