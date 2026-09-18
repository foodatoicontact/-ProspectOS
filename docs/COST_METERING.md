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

## BYOK Anthropic — branché sur `analyzeOffer()` (bloc `feat/anthropic-byok-metering`)

Le stockage (`provider_credentials`), le chiffrement (AES-256-GCM, `src/server/crypto.ts`, clé maîtresse
`BYOK_MASTER_KEY` serveur uniquement) et les routes (`/api/v1/provider-credentials/:organization_id`)
sont inchangés depuis la fondation (bloc `feat/real-discovery-cost-byok`). Ce qui change ici :
**`resolveProviderCredential()` est désormais appelé par la route `analyze-company`**, et son résultat
peut réellement payer un appel Anthropic à la place de la clé plateforme.

### Règle d'activation — BYOK ne change jamais le provider ni le modèle

`analyzeOffer()` (`src/server/ai.ts`) accepte un second paramètre optionnel `{apiKeyOverride}`. Cette
clé n'est **utilisée que si `AI_PROVIDER==='anthropic'`** — c'est-à-dire uniquement pour remplacer *quelle
clé paie*, jamais *quel fournisseur/modèle est appelé*. Si la plateforme est configurée pour `openai`
(ou n'est pas configurée), une clé Anthropic BYOK sauvegardée reste disponible en base mais n'est **jamais
activée** : l'activer forcerait à inventer un modèle Anthropic qui n'existe nulle part dans la
configuration actuelle, ce que le brief interdit explicitement. C'est une limitation de portée assumée,
pas un bug — documentée ici comme risque résiduel (voir plus bas).

Chemin exact (`app/api/v1/[...path]/route.ts`, bloc `analyze-company`) :
1. `analyzeCompanyGuarded` valide `project_id` et consomme le quota horaire — **avant** tout appel payant, inchangé.
2. À l'intérieur du `callProvider` (donc seulement après consommation du quota), le `organization_id` du projet est résolu, puis `resolveProviderCredential(organizationId,'anthropic')` est tenté **uniquement si** `process.env.AI_PROVIDER==='anthropic'`.
3. Le résultat est un état à 3 valeurs (`NONE`/`VALID`/`INVALID`, voir section suivante) — **jamais** un simple `catch` indistinct : `NONE` retombe légitimement sur la clé plateforme, `INVALID` interrompt l'appel entièrement (fail-closed), voir ci-dessous.
4. `analyzeOffer(text,{apiKeyOverride})` renvoie `credential_source:'BYOK'|'PLATFORM'` en plus de `usage` — les deux sont retirés de la réponse HTTP (`const {usage,credential_source,...analysis}=...; return json(analysis)`), jamais exposés au client.
5. `recordApiUsage({...,billingSource:credential_source})` écrit la provenance réelle dans `api_usage_events.billing_source` (colonne déjà existante, migration 009 — `billingSource` est un nouveau paramètre optionnel de `RecordUsageInput`, défaut `'PLATFORM'`, l'appel Brave existant est inchangé).

### Machine d'état NONE / VALID / INVALID (bloc `feat/anthropic-byok-metering` 4A.3.1 — durcissement fail-closed)

**Bug corrigé** : la version initiale de ce bloc interceptait `resolveProviderCredential(...)` avec un
`.catch(()=>null)` indistinct. Une credential BYOK **présente mais indéchiffrable** (ciphertext corrompu,
IV/tag invalide, `BYOK_MASTER_KEY` incorrecte ou changée, ligne malformée) était donc traitée exactement
comme une credential **absente** : l'appel retombait silencieusement sur `AI_API_KEY` plateforme. C'est un
défaut de facturation/sécurité — un owner dont la configuration BYOK est cassée voyait ses appels
silencieusement payés par la clé de la plateforme, sans jamais en être informé.

`resolveProviderCredential()` (`src/server/byok.ts`) renvoie désormais un type discriminé, jamais un
`string|null` :

```ts
type CredentialResolution = {status:'NONE'} | {status:'VALID';apiKey:string} | {status:'INVALID'};
```

- **NONE** — aucune ligne `provider_credentials` pour cette organisation/provider (ou une erreur de
  requête franche). Fallback vers la clé plateforme **autorisé**.
- **VALID** — ligne trouvée, déchiffrement AES-256-GCM réussi. La clé BYOK est utilisée **exclusivement**.
- **INVALID** — ligne trouvée mais le déchiffrement échoue, pour n'importe quelle raison cryptographique
  (`decryptSecret` lève une exception, capturée par un `try/catch` qui n'entoure **que** l'étape de
  déchiffrement — jamais toute la fonction). **Aucun fallback, aucun appel fournisseur.**

Câblage `route.ts` :
```ts
const credential=await resolveProviderCredential(project.organization_id,'anthropic');
if(credential.status==='INVALID')throw Error('BYOK_CREDENTIAL_INVALID');
return analyzeOffer(body.text,{apiKeyOverride:credential.status==='VALID'?credential.apiKey:null});
```
Aucun `.catch()` n'entoure plus cet appel : `NONE` et `INVALID` sont deux valeurs de retour normales et
distinctes de la même fonction, jamais fusionnées par une capture d'exception généraliste.
`BYOK_CREDENTIAL_INVALID` est mappé (comme tous les codes internes de ce fichier) vers une réponse HTTP
503 générique et fixe (« Clé Anthropic personnalisée invalide ou illisible. Remplacez-la dans Compte. »)
— jamais l'exception crypto brute, jamais le ciphertext/IV/tag, jamais la clé. Le quota horaire déjà
consommé n'est pas remboursé (même invariant que tout autre échec fournisseur — `AI_UNAVAILABLE` par
exemple — voir `src/server/ai-guard.ts`).

### Modèle Anthropic exact — toujours inconnu, aucun prix inventé

`AI_MODEL` reste une variable d'environnement 100% pilotée par l'opérateur (`process.env.AI_MODEL`),
sans valeur par défaut ni constante dans le code — impossible à déterminer statiquement dans ce dépôt.
**Aucune ligne `provider_pricing` n'est ajoutée pour `anthropic` par ce bloc.** `resolve_provider_cost`
continue de renvoyer `null` pour toute paire provider/model/operation sans ligne active (mécanisme déjà
présent depuis la migration 009, zéro code nouveau requis) : le coût d'un appel Anthropic BYOK ou
PLATFORM reste donc `estimated_cost_micros = null` tant qu'aucun opérateur n'insère un tarif vérifié pour
le modèle exact réellement configuré (voir le bloc SQL d'exemple plus haut, section Tarif). C'est le
comportement fail-closed explicitement demandé — jamais une estimation devinée depuis la longueur du
texte, jamais un tarif approximatif appliqué "au cas où".

`api_usage_events` permet déjà de retrouver, pour un appel Anthropic : `organization_id`, `provider`,
`operation`, `model` (valeur runtime de `AI_MODEL`), `input_tokens`/`output_tokens` (renvoyés tels quels
par Anthropic — jamais estimés), `estimated_cost_micros` (`null` si non tarifé), `billing_source`
(`'BYOK'` ou `'PLATFORM'`), `created_at`. Aucune migration n'a été nécessaire pour ce bloc : la colonne
`billing_source` (contrainte `check` `PLATFORM`/`BYOK`) existe depuis la migration 009 et n'était
simplement jamais alimentée qu'en `'PLATFORM'`.

**Mise à jour 4A.4.1** : le paragraphe ci-dessus décrivait l'état 4A.3/4A.3.1, où `AI_MODEL` n'était pas
encore identifié avec certitude. Le modèle cible **`claude-sonnet-5`** a depuis été confirmé et son tarif
officiel vérifié — voir « Tarif Anthropic — claude-sonnet-5 » ci-dessous. Pour **tout autre modèle**
(`AI_MODEL` configuré différemment, ou non reconnu), le comportement fail-closed décrit ci-dessus reste
exactement inchangé : `resolve_provider_cost` renvoie `null` sans ligne de tarif exacte correspondante.

### Tarif Anthropic — claude-sonnet-5 (migration 010, bloc 4A.4.1)

Deux lignes `prospectos_private.provider_pricing`, opérateur-vérifiées, insérées de façon idempotente
(`insert ... where not exists (...)`, même patron que le tarif Brave) :

| provider | operation | model | unit_type | price_per_unit_micros | version | effective_from |
|---|---|---|---|---|---|---|
| anthropic | offer_analysis | claude-sonnet-5 | input_tokens_1k | 2000 (= $2/1M tokens) | `anthropic-sonnet-5-2026-09-18` | 2026-09-18 |
| anthropic | offer_analysis | claude-sonnet-5 | output_tokens_1k | 10000 (= $10/1M tokens) | `anthropic-sonnet-5-2026-09-18` | 2026-09-18 |

Aucune contrainte UNIQUE n'existe sur `provider_pricing` (seulement un index de lookup) — les deux lignes
coexistent sans collision, différenciées uniquement par `unit_type`. `resolve_provider_cost` résout
chaque composant (`input_tokens_1k`, `output_tokens_1k`) indépendamment dans la même boucle et les
additionne : pour 2000 tokens d'entrée + 500 tokens de sortie, `costFromTokens` produit
`[{input_tokens_1k, quantity:2},{output_tokens_1k, quantity:0.5}]`, et le total résolu est exactement
`round(2000×2) + round(10000×0.5) = 4000 + 5000 = 9000` micros (= 0,009 USD) — vérifié par un test DB
dédié (`tests/discovery-cost-byok-db.mjs`), aucun appel Anthropic réel.

### Durcissement de `resolve_provider_cost` — priorité modèle exact (migration 010, bloc 4A.4.1)

**Gap identifié par l'audit 4A.4 Phase 0** : la clause `(model=p_model or model is null) order by
effective_from desc` ne garantissait pas qu'un tarif spécifique à un modèle prime sur un tarif générique
(`model is null`) — seule la date `effective_from` la plus récente l'emportait, indépendamment de la
spécificité du modèle. Corrigé de façon strictement minimale (un seul terme ajouté à l'`ORDER BY`, aucun
autre changement) :

```sql
order by (model is null), effective_from desc limit 1
```

`(model is null)` est un booléen jamais `NULL` (le prédicat `IS NULL` vaut toujours vrai/faux) : `false`
(ligne à modèle exact) trie toujours avant `true` (ligne générique), quelle que soit la date. `effective_from`
reste le seul départage, mais désormais strictement **à l'intérieur** de chaque palier (exact-contre-exact,
ou générique-contre-générique), jamais entre les deux. Chaque composant (`unit_type`) d'un même appel
continue d'être résolu indépendamment (conception déjà existante depuis la migration 009, aucune nouvelle
abstraction) : un appel peut légitimement résoudre l'entrée via un tarif exact et la sortie via un
fallback générique, dans le même appel. Brave n'est pas affecté (aucune collision exact/générique
n'existe pour ce fournisseur). Le fail-closed multi-composants (`if not found then return null`,
abandonnant tout total déjà accumulé) est inchangé.

Ce correctif s'est révélé nécessaire en pratique, pas seulement théorique : le test DB de version de
tarif déjà existant (P/Q, migration 009) laisse une ligne générique active
`(anthropic, offer_analysis, input_tokens_1k, model=null, prix=900)` avec un `effective_from` postérieur
à celui de `claude-sonnet-5`. Sans ce correctif, le test de calcul 2000/500 → 9000 micros échouerait
réellement (résultat observé : 6800, la ligne générique plus récente écrasant le tarif exact) — vérifié
empiriquement en désactivant temporairement le correctif pendant le développement de ce bloc.

### UI minimale — Compte → Clé API Anthropic

Un nouveau bouton **« Clé API Anthropic »** dans la modale Compte (`app/page.tsx`, gardé par
`mode==='live'`, visible pour tout membre) ouvre une modale dédiée (`modal==='byok-anthropic'`) :
statut (`Configurée · se termine par XXXX` / `Non configurée`), champ `type="password"` pour saisir/
remplacer, boutons Enregistrer/Supprimer visibles uniquement pour `role==='owner'` (miroir exact de
`require_owner` côté RPC — un non-owner voit le statut mais pas les actions). La clé n'est **jamais**
réaffichée après sauvegarde : seul `key_last4` revient du serveur. Utilise exclusivement les routes BYOK
existantes (`GET`/`POST`/`DELETE /api/v1/provider-credentials/:organization_id`) via le helper `api()`
déjà en place — aucune nouvelle route. `organization_id` a été ajouté (additif) à la réponse
`GET /api/v1/account` pour que le client puisse adresser ces routes.

### Test critique bytea — désormais exercé par mocks (pas seulement documenté comme risque)

`src/server/byok.ts` et `src/server/usage.ts` importaient leurs modules serveur voisins sans extension
(`./crypto`, `./admin-client`, `./pricing`) — un style incompatible avec le runtime `node --test` utilisé
par la suite de tests (seul le bundler Next.js tolérait cette omission). Corrigé ici (`./crypto.ts`,
`./admin-client.ts`, `./pricing.ts`, comportement identique sous Next.js grâce à
`allowImportingTsExtensions`, déjà activé) — cela aligne `src/server/` sur la convention déjà suivie
partout ailleurs dans `src/discovery/` et `src/domain/`, et rend ces modules réellement testables en
isolation pour la première fois. `tests/byok-anthropic.test.ts` (nouveau, `npm test`) exerce désormais
réellement, via `node:test`'s `mock.module`/`mock.method` (aucun réseau, aucune DB réelle) :

- **Chemin bytea complet** : `encryptSecret` produit un ciphertext/iv/authTag réels, encodés exactement
  comme `toBytea` le fait (`\x`-hex) — la forme JSON exacte qu'un vrai PostgREST renverrait pour une
  colonne bytea — puis `resolveProviderCredential` (code de production, non réimplémenté) les décode et
  déchiffre via `decryptSecret` réel, et le texte clair obtenu est comparé strictement à l'original.
- `saveProviderCredential` n'envoie jamais le texte en clair à la RPC, uniquement `\x`-hex + `key_last4`.
- Sélection de la clé BYOK vs plateforme dans `analyzeOffer` (en-tête HTTP réellement envoyé, mocké au
  niveau `fetch`), `credential_source` correct dans les deux cas, ignoré silencieusement si le provider
  configuré n'est pas `anthropic`.
- `recordApiUsage` : `billing_source` par défaut `'PLATFORM'`, propagation correcte de `'BYOK'`, coût
  toujours `null` en l'absence de tarif Anthropic, aucun champ clé/secret dans la ligne insérée.
- Preuves statiques (source-level, même convention que `tests/account-session.test.ts`) que
  `credential_source`/`usage` sont retirés de la réponse HTTP, et que `route.ts` ne fait plus jamais un
  `.catch()` indistinct sur `resolveProviderCredential` (voir « Machine d'état » ci-dessus).
- **4A.3.1** : matrice complète NONE/VALID/INVALID × plateforme présente/absente (ciphertext tampered,
  auth tag tampered, IV de mauvaise longueur, `BYOK_MASTER_KEY` incorrecte) exécutée sur le vrai
  `resolveProviderCredential`, prouvant qu'`INVALID` ne déclenche jamais ni un appel fournisseur ni un
  fallback plateforme, et que `provider!=='anthropic'` empêche même la construction du client admin
  (donc `resolveProviderCredential` n'est jamais consulté).

Ce que ceci ne remplace toujours pas : un vrai serveur PostgREST/Supabase n'a jamais reçu ni renvoyé ce
format bytea en conditions réelles. Le smoke production décrit ci-dessous reste la validation
définitive end-to-end.

### Smoke production futur — UN seul appel réel, jamais pendant le développement

**Aucun appel Anthropic réel n'a été fait pendant ce bloc.** Procédure à exécuter plus tard, en
production, avec le petit crédit Anthropic déjà disponible :

1. Sur l'environnement de production réel, en tant qu'owner d'une organisation de test/pilote, saisir une
   vraie clé Anthropic valide via la nouvelle UI Compte → Clé API Anthropic → Enregistrer. Vérifier que le
   statut affiche `Configurée · se termine par XXXX` (jamais la clé elle-même).
2. Confirmer que `AI_PROVIDER=anthropic` est bien la configuration Vercel active pour cet environnement
   (sinon la clé BYOK reste inerte par design — voir plus haut).
3. Depuis l'UI (onglet Offre & ICP → « Analyser l'offre »), soumettre **un seul** texte minimal mais
   réaliste (30-200 caractères, pas de boucle, pas de retry manuel).
4. Vérifier dans `api_usage_events` (requête SQL directe, jamais via une route publique) : une seule
   nouvelle ligne, `provider='anthropic'`, `billing_source='BYOK'`, `model` = valeur réelle observée de
   `AI_MODEL`, `input_tokens`/`output_tokens` non nuls, `estimated_cost_micros` = `null` (aucun tarif
   seedé) — c'est le signal que le coût est correctement fail-closed plutôt que deviné.
5. Noter le modèle exact observé dans `model` — c'est la première fois qu'il est connu avec certitude.
   Ne PAS insérer de ligne `provider_pricing` sans vérifier au préalable, hors de ce dépôt, le tarif
   officiel exact d'Anthropic pour ce modèle précis.
6. Supprimer la clé de test via Compte → Clé API Anthropic → Supprimer si elle ne doit pas rester active.
   Budget consommé : exactement un appel `messages`, aucun retry, aucune boucle.

## Variables d'environnement

- `BRAVE_SEARCH_API_KEY`, `AI_PROVIDER`/`AI_API_KEY`/`AI_MODEL` : inchangées, déjà documentées dans `.env.example`.
- `BYOK_MASTER_KEY` (nouveau, serveur uniquement, jamais `NEXT_PUBLIC_`) : clé maîtresse AES-256-GCM,
  32 octets encodés en base64 (`openssl rand -base64 32`). Sans elle, `encryptSecret`/`decryptSecret`
  échouent avec `CONFIGURATION_REQUIRED` — aucune sauvegarde BYOK n'est possible tant qu'elle n'est pas
  configurée, mais le reste du produit (Discovery, compte, export) fonctionne normalement.
