# ProspectOS — V0 + Discovery Engine

Prospection autonome, action humaine.

Première verticale Foodatoi en Next.js/TypeScript. Ce dépôt est exécutable en démo sans secret. La connexion multi-tenant nécessite une nouvelle cible Supabase configurée. Aucun déploiement public n’a été effectué.

## Démarrer
Prérequis : Node.js 24, npm.

```bash
npm ci
npm test
node tests/rls-runner.mjs
npm run dev
```
Ouvrir http://localhost:3000 puis **Explorer la démo Foodatoi**.

## Parcours démo
1. Explorer les cinq établissements sourcés (preuves initiales non vérifiées) ; ouvrir un critère pour voir la preuve et sa source.
2. Créer un projet depuis **Nouveau projet** et ajuster les poids dans **Offre & ICP** (total 100).
3. Ajouter un établissement avec son URL publique.
4. **Analyser un texte** : coller le contenu public consulté. Les observations proposées sont NOT_VERIFIED et ne donnent aucun point.
5. Consulter les sources ; cliquer **J’ai vérifié la source : valider**, ou ajouter une preuve manuelle.
6. Préparer un message, le relire, le copier. Un profil LinkedIn n’est ouvrable que si son URL a été documentée.
7. Marquer le prospect contacté après votre action manuelle, puis exporter le CSV.

La démo stocke projets et prospects sur cet appareil (localStorage) ; l’historique démo est limité à la sélection/session. Aucun compte, envoi ou synchronisation cachée. « Ignorer » positionne Perdu.

## Activer Supabase
La base cible n’a pas été choisie. Ne pas appliquer le schéma à une base métier existante.
1. Créer/identifier une base Supabase dédiée et vide.
2. Sur une base neuve, exécuter `db/schema.sql`, puis `db/migrations/002_discovery.sql`. Sur la V0 existante, appliquer seulement la migration 002. Ces fichiers sont transactionnels et non idempotents ; sauvegarder et tester sur une copie avant production.
3. Configurer les URLs de site et de redirection Auth pour le domaine cible et localhost de développement.
4. Copier `.env.example` vers `.env.local` et renseigner l’URL et la clé publique du projet.
5. Activer le fournisseur Email dans Supabase Auth, configurer la confirmation d’email et le SMTP pour usage réel.
6. Démarrer l’application, créer un compte puis un projet. Le premier projet crée l’organisation de l’utilisateur atomiquement via RPC.
7. Tester deux comptes distincts sur le vrai service avant déploiement public. Les tests PGlite ne remplacent pas ce test Auth/PostgREST.

Pas de service_role requis dans l’application. Invitations et choix entre plusieurs organisations non exposés en V0 : chaque utilisateur crée son espace, les projets suivants utilisent la première organisation visible.

## Fournisseur IA
Configurer `AI_PROVIDER=openai` ou `anthropic`, `AI_API_KEY` et `AI_MODEL` avec un modèle accessible à votre compte et compatible avec l’API choisie. Les clés restent côté serveur. L’analyse de l’offre extrait un résumé, une cible et des questions ; résultat marqué proposition à valider. Les DM utilisent actuellement un modèle factuel déterministe (aucun appel IA facturé pour les DM). Les fournisseurs n’ont pas été appelés en conditions réelles.

L’endpoint IA est désactivé tant que la clé et le modèle sont absents. Ajouter des quotas persistants et limites budgétaires avant son ouverture à plusieurs clients.

## Déployer sur Vercel
Importer ce dépôt comme projet Next.js, ajouter les variables d’environnement, exécuter la build (`npm run build`), puis vérifier Auth, API, RLS et redirections sur l’URL Preview avant production. Aucun compte Vercel n’est branché dans cette livraison.

## Commandes de validation
```bash
npm test
node tests/rls-runner.mjs
npm run build
```
PGlite utilise un vrai moteur PostgreSQL WebAssembly avec rôles, schémas et auth.uid de test. Aucun accès réseau aux projets Supabase existants.

## API REST V0
Toutes les routes sous `/api/v1` demandent `Authorization: Bearer <JWT Supabase>`.

| Méthode | Route | Fonction |
|---|---|---|
| GET / POST | organizations | Liste / création atomique organisation |
| GET / POST | projects | Liste / création projet |
| PATCH | projects/:id | Offre |
| POST | icps | Critères du projet, total 100 |
| GET / POST | prospects | Liste filtrée par project_id / ajout |
| PATCH | prospects/:id | Statut humain |
| POST | evidence | Observation et validation explicite |
| POST | channels | Coordonnée publique documentée |
| POST | outreach | Brouillon factuel sauvegardé |
| GET | events?prospect_id=… | Historique |
| POST | analyze-company | Analyse IA d’un texte + source_url |
| GET | export?project_id=… | CSV protégé |

Aucune route d’envoi LinkedIn. Les fonctions métier du domaine sont réutilisables pour MCP ; aucun serveur MCP n’est encore livré.

## Limites de cet incrément
- Recherche : provider TEST actif sans secret ; adaptateur Brave implémenté et testé avec HTTP simulé, non validé avec une clé réelle.
- Analyse HTTP des sites officiels : liste d’hôtes autorisés obligatoire et robots.txt, trois pages maximum ; aucun accès arbitraire.
- Extraction prospect : règles lexicales et validation humaine, pas interprétation IA autonome.
- ICP Foodatoi pondérable ; pas encore de générateur IA complet de nouveaux critères.
- Historique des statuts et preuves en base ; journal démo temporaire.
- Brouillons en base non listés dans l’interface. Pas d’envoi, de relance automatique, de CRM ni de facturation.
- Liste d’opposition durable, rétention/suppression, quotas IA et workflow multi-membres à compléter avant SaaS commercial.
- RLS validées sur PostgreSQL local éphémère ; Auth cloud et tests interactifs navigateur non validés dans cet environnement.

Voir `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/DEMO_SOURCES.md` et `docs/VERIFICATION.md`.

## Discovery Engine — bloc 2

Dans un projet, cliquer **Trouver des prospects**, choisir le provider, saisir requête/zone/catégories, lancer puis ajouter un candidat. Ouvrir sa fiche, confirmer son site officiel si nécessaire, lancer l’analyse et examiner chaque observation avec **Confirmer / Contredire / Laisser non vérifié**. Le score et le brouillon se recalculent avec le moteur V0. Un doublon ambigu requiert une décision explicite ; aucune fusion automatique.

| Provider | État réel | Activation |
| --- | --- | --- |
| fixture | Fonctionnel, données synthétiques TEST ; aucune recherche réelle | Sans secret, démo locale ou API authentifiée |
| brave | Adaptateur API implémenté, tests HTTP simulés verts ; appel réel non vérifié | BRAVE_SEARCH_API_KEY côté serveur |
| Google Places / Bing / Serper | Non implémentés | — |

Les cinq prospects réels préchargés sont un instantané de recherche distinct du provider TEST. Leur score initial est zéro tant que leurs preuves ne sont pas confirmées. Les données localStorage d'une ancienne démo restent conservées ; elles ne sont pas écrasées par le nouveau jeu initial. Voir `docs/DEMO_DISCOVERY.md`.

Pour analyser un site réel, définir `DISCOVERY_ALLOWED_HOSTS` (hôtes exacts séparés par des virgules) après vérification de l’autorisation d’accès. Les hôtes de redirection doivent aussi être autorisés. Sans cette configuration, l’analyse est refusée. La démo locale analyse uniquement les fixtures TEST ; l’analyse réelle nécessite Supabase et l’API serveur.

Quotas : modifier, avec un rôle administrateur SQL, `prospectos_private.discovery_quota_settings` (`runs_per_hour`, `max_results`, `analyses_per_hour`). La consommation est isolée par organisation, même si les réglages initiaux sont globaux. Brave renvoie au maximum 20 résultats par appel dans cette V1.

### API Discovery (préfixe /api/v1, JWT requis)

| Méthode | Route | Action |
| --- | --- | --- |
| GET | discovery-config | Providers disponibles |
| POST | projects/:id/discovery | Recherche, optional_filters.provider = fixture ou brave |
| GET | discovery-runs/:id | État et métriques |
| GET | discovery-runs/:id/results | Candidats sourcés |
| POST | discovery-results/:id/accept | Ajout idempotent ; force_separate explicite si ambigu |
| POST | discovery-results/:id/ignore | Ignorer |
| POST | prospects/:id/website | URL officielle confirmée par l’utilisateur |
| POST | prospects/:id/analyze | Analyse HTTP bornée |
| GET | prospects/:id/observations | Observations et décisions |
| POST | prospects/:id/observations/:observationId/confirm | Validation humaine |
| POST | prospects/:id/observations/:observationId/contradict | Contradiction et retrait des points |
| POST | prospects/:id/observations/:observationId/unverify | Maintien non vérifié |

`src/discovery` sépare providers, normalisation/déduplication, collecte, observations, propositions et persistance. `DiscoveryService.find_prospects` et `CompanyAnalysisService.analyze_company` sont indépendants du transport REST et réutilisables pour un futur adaptateur MCP. Aucun serveur MCP ajouté.

Validation complète : `npm run test:all` puis `npm run build`. Voir `VERIFY_DISCOVERY.md` pour les résultats effectivement obtenus et `SECURITY.md` pour les protections et limites.
