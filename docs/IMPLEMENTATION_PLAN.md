# ProspectOS V0 Implementation Plan

**Goal:** Créer un projet Foodatoi, définir son ICP, ajouter et qualifier des prospects par preuves, préparer un DM.
**Architecture:** Next.js monolithe modulaire. API avec JWT Supabase, RLS et fonctions métier indépendantes du transport.
**Tech Stack:** TypeScript, Next.js, Supabase Auth/PostgreSQL, Node test runner.
**Spec:** docs/ARCHITECTURE.md

## Contraintes globales
NO_UNAUTHORIZED_LINKEDIN_AUTOMATION = true. Inconnu = « À confirmer ». Pas de création de données prospect par IA. Déploiement Vercel préparé, activation sur cible identifiée seulement.

## 1. Domaine testable
Fichiers : src/domain/core.ts, tests/core.test.ts.
Interfaces : scoreProspect(criteria,evidence,now), generateOutreach(name,offer,criteria,evidence), safeLink(url), csv(rows), allowedAction(action).
- [ ] Écrire tests : inconnu 0/couverture 0 ; preuve vraie + poids ; fausse connue sans points ; inférence ignorée ; preuve expirée ignorée ; doublon sans double comptage ; contradiction ; message sans affirmation inconnue ; CSV neutralise = ; LinkedIn send rejeté.
- [ ] Exécuter `node --experimental-strip-types --test tests/*.test.ts` et constater les échecs.
- [ ] Implémenter domaine puis relancer jusqu’à réussite.

## 2. Schéma et isolation
Fichiers : db/schema.sql, db/rls-test.sql.
- [ ] Créer tables typées, contraintes, index et FK composites décrits dans la spec.
- [ ] Appliquer RLS à toutes les tables ; authentification obligatoire ; bootstrap transactionnel d’organisation et membre propriétaire.
- [ ] Journaliser les mutations par trigger ; utilisateur ne peut ni réécrire ni supprimer l’historique.
- [ ] Test SQL transactionnel : utilisateur A ne voit pas B ; insertion cross-tenant et validation anonyme rejetées ; droits owner non auto-attribuables.
- [ ] Exécuter sur PostgreSQL éphémère si disponible, sinon marquer explicitement « non exécuté », jamais « isolation validée ».

## 3. API authentifiée
Fichiers : src/server/db.ts, app/api/v1/[...path]/route.ts, src/server/ai.ts.
- [ ] Auth Bearer validée avec Supabase getUser avant accès ; client DB avec JWT utilisateur, pas service_role.
- [ ] GET/POST projects ; GET/POST prospects ; POST evidence ; POST outreach ; PATCH prospect ; GET export.
- [ ] Refuser corps trop volumineux, URL non HTTP(S), statuts invalides ; ne pas transmettre les erreurs DB internes au navigateur.
- [ ] Fournisseurs IA OpenAI et Anthropic derrière une même fonction ; extraction JSON validée, résultat proposé et jamais VERIFIED automatiquement.

## 4. Interface verticale
Fichiers : app/page.tsx, app/layout.tsx, app/globals.css, src/domain/demo.ts.
- [ ] Écran connexion et mode démo clairement étiqueté ; aucune fausse authentification.
- [ ] Projets et ICP éditables, liste filtrable, fiche sélectionnée, preuves et couverture visibles.
- [ ] Ajouter un prospect et une observation avec URL/extrait/date/valeur ; validation humaine explicite.
- [ ] Générer DM, copier, ouvrir source/profil, ignorer, marquer contacté ; historique ; CSV.
- [ ] État démo conservé uniquement dans le navigateur et annoncé ; données authentifiées en Supabase.

## 5. Démo et vérification
Fichiers : docs/DEMO_SOURCES.md, README.md, docs/VERIFICATION.md.
- [ ] New School Tacos Minimes : téléphone et Uber Eats, commande en ligne existante ; pas d’absence de click & collect inventée.
- [ ] O’Fuzion : plateformes et offre directe ; audience, livraison interne et commandes sociales à confirmer.
- [ ] La Lombezienne : téléphone/SMS et interface panier existante ; ne pas prétendre absence de solution.
- [ ] Tests domaine, compilation Next.js et test responsive si dépendances disponibles.
- [ ] Fournir ZIP source et documents, avec statut exact de chaque intégration et commande de démarrage.

## Suite V1 après cette verticale
Recherche paginée par API autorisée et déduplication, fetcher sécurisé, queue/quota IA en DB, opposition durable avant toute relance, suppression/rétention, intégrations CRM, puis façade MCP avec mêmes contrôles d’accès. Gate : tests RLS sur véritable Supabase, parcours Auth complet, contrôle des coûts et recherche sous contrat fournisseur.

## État de l’incrément livré
- Domaine et extraction : réalisés, 20 tests unitaires réussis.
- Schéma et RLS : réalisés et exécutés sous PostgreSQL PGlite, y compris rôles A/B/anonyme.
- API et interface : implémentées, build Next.js/TypeScript réussie.
- Trois établissements réels sourcés : intégrés en démo.
- Vérification navigateur : bloquée par l’accès distant à localhost.
- Auth Supabase réelle et Vercel : préparés mais non connectés ; cible à identifier.
- Recherche automatique, collecte URL seule, ICP IA et DM IA : prochains incréments explicités dans README.
- Revue indépendante : corrections des changements de compte et des réponses asynchrones devenues obsolètes.

Les cases du plan sont la checklist de réalisation détaillée ; l’état ci-dessus et VERIFICATION.md font foi sur les validations effectivement exécutées.
