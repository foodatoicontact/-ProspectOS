# Coût réel Discovery, catalogue de prix, BYOK

Référence technique du bloc `feat/real-discovery-cost-byok` (migration `009_real_discovery_cost_byok.sql`).

## Ce qui a un coût réel dans ProspectOS aujourd'hui

Exactement deux appels fournisseur payants existent dans tout le produit :

| Appel | Fichier | Facturé par |
|---|---|---|
| Recherche Brave | `src/discovery/providers/brave.ts` (`BraveProvider.searchCompanies`) | requête |
| Analyse d'offre IA | `src/server/ai.ts` (`analyzeOffer`, Anthropic ou OpenAI) | tokens d'entrée/sortie |

L'analyse d'un prospect (`CompanyAnalysisService.analyze_company`, HTML + `cheerio`) n'appelle aucune IA
et n'a aucun coût variable — elle n'écrit jamais dans le ledger.

Le fournisseur `fixture` (TEST) n'écrit **jamais** dans `api_usage_events` : voir la garde
`if(name==='brave')` dans `src/discovery/api.ts`.

## Tarif Brave — vérifié et déjà inséré (RC hardening review, 2026-09-18)

`prospectos_private.provider_pricing` contient désormais une ligne réelle, opérateur-vérifiée :

| provider | operation | unit_type | price_per_unit_micros | version | effective_from |
|---|---|---|---|---|---|
| brave | search | request | 5000 (= $0,005/requête = $5/1000 requêtes) | `brave-search-2026-09-18` | 2026-09-18 |

Cette ligne est insérée par la migration elle-même (`insert ... where not exists (...)`, idempotent —
ne duplique jamais la ligne si la migration est rejouée). Les $5 de crédits Search gratuits mensuels
annoncés par Brave sont **volontairement jamais soustraits ici** : le ledger mesure le coût économique
brut fournisseur (ce qu'un appel coûte réellement en tarif catalogue), pas la facture nette après crédits
— une couche crédits/remises distincte viendrait s'ajouter par-dessus si un jour nécessaire, jamais en
modifiant `estimated_cost_micros` lui-même.

`anthropic`/`openai` restent **volontairement vides** : `AI_MODEL` est une variable d'environnement
choisie par l'opérateur, inconnue de ce bloc — insérer un tarif pour un modèle qu'on ne peut pas
confirmer avec certitude reviendrait à inventer un coût. Une fois le modèle réellement configuré
identifié sans ambiguïté, l'insérer ainsi (exemple, valeurs à vérifier avant usage) :

```sql
insert into prospectos_private.provider_pricing(provider, operation, model, unit_type, price_per_unit_micros, version)
values ('anthropic', 'offer_analysis', '<AI_MODEL exact>', 'input_tokens_1k', <prix vérifié>, 'anthropic-<date>');
insert into prospectos_private.provider_pricing(provider, operation, model, unit_type, price_per_unit_micros, version)
values ('anthropic', 'offer_analysis', '<AI_MODEL exact>', 'output_tokens_1k', <prix vérifié>, 'anthropic-<date>');
```

**Ne jamais faire un `update` sur `price_per_unit_micros` d'une ligne existante** : un changement de
tarif s'ajoute (nouvelle ligne, nouveau `version`, `effective_from` = maintenant), en fermant
éventuellement l'ancienne ligne (`effective_to = now()`). Chaque `api_usage_event` déjà enregistré garde
son `estimated_cost_micros`/`pricing_version` d'origine pour toujours — le changer rétroactivement est
strictement impossible (le ledger est append-only, voir plus bas).

## Le ledger — `api_usage_events`

Une ligne par appel réel réussi. Jamais écrite par un client (`authenticated`/`anon` n'ont aucun droit
d'écriture, ni directement sur la table ni via une RPC) : seul le serveur, via un client service-role
(`src/server/admin-client.ts`), peut y écrire — voir `src/server/usage.ts`. Immuable au niveau trigger
(`api_usage_events_immutable`, même mécanisme que `event_immutable` sur `events`) : ni `update` ni
`delete`, même par `service_role`.

Consulter l'usage d'une organisation :
```sql
select * from public.api_usage_events where organization_id = '...' order by created_at desc;
```

## Métriques par run — `GET /api/v1/discovery-runs/:id/cost`

Calculées à la volée depuis le ledger et les tables Discovery existantes (jamais stockées à part).
`cost_per_result`/`cost_per_prospect`/`cost_per_verified_evidence`/`cost_per_qualified_prospect` sont
`null` dès que leur dénominateur est zéro — jamais une division par zéro, jamais une fausse précision.

Le coût LLM (analyse d'offre) est suivi séparément au niveau du projet et n'est **jamais** additionné au
coût d'un run particulier : `analyzeOffer` analyse l'offre d'un **projet**, pas un run de Discovery précis
— l'attribuer à un run choisi arbitrairement fausserait le total dès qu'un projet a plusieurs runs.

`pages_fetched`/`pages_rejected`/`pages_failed` ne sont **pas** mesurés par run dans cette version :
`CompanyAnalysisService.analyze_company` a ses propres compteurs par appel mais ne les persiste pas
contre un `discovery_run_id`. Les ajouter demanderait de toucher le pipeline d'analyse lui-même, ce que
ce bloc s'interdit explicitement. Ils apparaissent à `null` avec une note explicite plutôt qu'un chiffre
inventé.

## BYOK — FOUNDATION ONLY (pas fonctionnel)

**BYOK FOUNDATION ONLY.** Le stockage (`provider_credentials`), le chiffrement (AES-256-GCM,
`src/server/crypto.ts`, clé maîtresse `BYOK_MASTER_KEY` serveur uniquement) et les routes
(`/api/v1/provider-credentials/:organization_id`) sont livrés et testés — mais **aucun appel réel (Brave
ou IA) n'est routé à travers une clé BYOK sauvegardée**. `resolveProviderCredential()` existe
(`src/server/byok.ts`) et sait déchiffrer une clé stockée, mais n'est appelé par aucun chemin de
production : ni `BraveProvider`, ni `analyzeOffer` ne le consultent. Un client peut sauvegarder une clé
Brave/Anthropic/OpenAI dès aujourd'hui ; **elle n'est jamais utilisée pour un seul appel réel tant que ce
routage n'est pas explicitement construit dans un bloc ultérieur**. Aucune UI ne doit laisser entendre le
contraire.

Gérer une clé BYOK (organisation, `owner` uniquement) :
```
POST   /api/v1/provider-credentials/:organization_id   { "provider": "brave", "api_key": "..." }
GET    /api/v1/provider-credentials/:organization_id
DELETE /api/v1/provider-credentials/:organization_id    { "provider": "brave" }
```

La clé en clair n'est **jamais** renvoyée après sauvegarde (ni par `save`, ni par `list`) — seuls
`provider`, `key_last4`, `created_at`, `updated_at` sortent de la base. L'export RGPD ne lit jamais
`provider_credentials`.

### Risque documenté — chemin bytea via PostgREST non testé contre un vrai backend

`src/server/byok.ts` encode `encrypted_secret`/`iv`/`auth_tag` en hex préfixé `\x` pour les envoyer à
`save_provider_credential` via `supabase-js`/PostgREST, et les décode de la même façon en lecture. Ce
format est celui documenté par Postgres pour un cast texte→bytea et par la sérialisation JSON de
PostgREST pour une colonne bytea — mais il n'a été vérifié que par la logique du code et par les tests
PGlite (qui, eux, utilisent le protocole fil Postgres brut et acceptent un `Buffer`, pas la même
convention — voir le commentaire dans `tests/discovery-cost-byok-db.mjs`). **Il n'a jamais été exercé
contre un vrai serveur PostgREST/Supabase.** Tant que ce chemin n'a pas tourné une fois en conditions
réelles, le considérer comme un risque ouvert, pas comme validé.

### Smoke test non destructif à exécuter plus tard (jamais avec une vraie clé fournisseur)

Une fois `BYOK_MASTER_KEY` configurée sur un environnement de test réel (jamais la production sans
validation explicite), avec un secret **entièrement factice** :

```
TEST_ONLY_NOT_A_REAL_API_KEY_xxx
```

1. **save** — `POST /api/v1/provider-credentials/:organization_id` avec `{"provider":"brave","api_key":"TEST_ONLY_NOT_A_REAL_API_KEY_xxx"}`, en tant qu'owner d'une organisation de test. Vérifier : réponse `201`, corps = exactement `{provider,key_last4,created_at,updated_at}` — jamais `encrypted_secret`/`iv`/`auth_tag`/le secret en clair.
2. **list (masked only)** — `GET /api/v1/provider-credentials/:organization_id`. Vérifier : le tableau retourné ne contient que `provider`/`key_last4`/`created_at`/`updated_at` ; `key_last4` doit valoir les 4 derniers caractères du secret factice (`_xxx`).
3. **server decrypt** — appeler `resolveProviderCredential(organizationId,'brave')` directement (script serveur, jamais exposé en HTTP) et vérifier que la valeur déchiffrée est bien `TEST_ONLY_NOT_A_REAL_API_KEY_xxx` — cela valide le chemin bytea aller-retour complet (écriture via PostgREST, lecture directe admin, déchiffrement AES-256-GCM).
4. **delete** — `DELETE /api/v1/provider-credentials/:organization_id` avec `{"provider":"brave"}`. Vérifier : `200`, puis `list` renvoie un tableau vide.
5. Sur toute la procédure : grep les logs serveur, la table `events`, et un export RGPD généré entre-temps pour ce compte — le secret factice ne doit apparaître **nulle part** en dehors de la requête HTTP `save` elle-même (jamais loggé, jamais dans `events`, jamais dans l'export).

Ce test n'appelle jamais Brave/Anthropic/OpenAI (aucun appel réseau sortant vers un fournisseur) — il
valide uniquement le chemin de stockage/chiffrement.

## Variables d'environnement

- `BRAVE_SEARCH_API_KEY`, `AI_PROVIDER`/`AI_API_KEY`/`AI_MODEL` : inchangées, déjà documentées dans `.env.example`.
- `BYOK_MASTER_KEY` (nouveau, serveur uniquement, jamais `NEXT_PUBLIC_`) : clé maîtresse AES-256-GCM,
  32 octets encodés en base64 (`openssl rand -base64 32`). Sans elle, `encryptSecret`/`decryptSecret`
  échouent avec `CONFIGURATION_REQUIRED` — aucune sauvegarde BYOK n'est possible tant qu'elle n'est pas
  configurée, mais le reste du produit (Discovery, compte, export) fonctionne normalement.
