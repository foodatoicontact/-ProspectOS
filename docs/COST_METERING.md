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

## Configurer un tarif réel (obligatoire avant que les coûts affichés aient un sens)

`prospectos_private.provider_pricing` est livré **vide** : aucun prix Brave/Anthropic/OpenAI n'est
inventé par ce bloc. Tant qu'aucune ligne active n'existe pour un provider/operation/unit_type,
`estimated_cost_micros` reste `null` — jamais une estimation devinée.

```sql
-- Exemple : Brave Search facturé par requête. Remplacer 5000 par le tarif réel et vérifié (en
-- micro-dollars par requête) lu sur la page de pricing actuelle de Brave.
insert into prospectos_private.provider_pricing(provider, operation, model, unit_type, price_per_unit_micros, version)
values ('brave', 'search', null, 'request', 5000, 'brave-2026-01');

-- Exemple : un modèle Anthropic facturé par 1000 tokens d'entrée / sortie.
insert into prospectos_private.provider_pricing(provider, operation, model, unit_type, price_per_unit_micros, version)
values ('anthropic', 'offer_analysis', 'claude-haiku-...', 'input_tokens_1k', 250, 'anthropic-2026-01');
insert into prospectos_private.provider_pricing(provider, operation, model, unit_type, price_per_unit_micros, version)
values ('anthropic', 'offer_analysis', 'claude-haiku-...', 'output_tokens_1k', 1250, 'anthropic-2026-01');
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

## BYOK — état de ce bloc

L'architecture de stockage (`provider_credentials`), le chiffrement (AES-256-GCM, `src/server/crypto.ts`,
clé maîtresse `BYOK_MASTER_KEY` serveur uniquement) et les routes (`/api/v1/provider-credentials/:organization_id`)
sont livrés et testés. **Aucun appel réel (Brave ou IA) n'est encore routé à travers une clé BYOK** :
`resolveProviderCredential()` existe (`src/server/byok.ts`) mais n'est appelé par aucun code de
production — c'est le squelette de routage prévu par la section 12 du brief, pas son activation.

Gérer une clé BYOK (organisation, `owner` uniquement) :
```
POST   /api/v1/provider-credentials/:organization_id   { "provider": "brave", "api_key": "..." }
GET    /api/v1/provider-credentials/:organization_id
DELETE /api/v1/provider-credentials/:organization_id    { "provider": "brave" }
```

La clé en clair n'est **jamais** renvoyée après sauvegarde (ni par `save`, ni par `list`) — seuls
`provider`, `key_last4`, `created_at`, `updated_at` sortent de la base. L'export RGPD ne lit jamais
`provider_credentials`.

## Variables d'environnement

- `BRAVE_SEARCH_API_KEY`, `AI_PROVIDER`/`AI_API_KEY`/`AI_MODEL` : inchangées, déjà documentées dans `.env.example`.
- `BYOK_MASTER_KEY` (nouveau, serveur uniquement, jamais `NEXT_PUBLIC_`) : clé maîtresse AES-256-GCM,
  32 octets encodés en base64 (`openssl rand -base64 32`). Sans elle, `encryptSecret`/`decryptSecret`
  échouent avec `CONFIGURATION_REQUIRED` — aucune sauvegarde BYOK n'est possible tant qu'elle n'est pas
  configurée, mais le reste du produit (Discovery, compte, export) fonctionne normalement.
