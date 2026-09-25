# Discovery Recall V3 — requêtes courtes, marché Brave, détection first-party

Benchmark d'origine (« Export B2B — Maroc », production) : **1** requête Brave de 213 caractères
(brief + zone + 4 catégories + « site officiel »), `country=FR` par défaut pour une zone marocaine,
10 résultats → 9 pages d'annuaires/marketplaces + 1 site d'entreprise (Fournipro) lu comme éditorial à
cause de « Top 500 » dans son extrait → **0 candidat**.

## A — Planification des requêtes (`src/discovery/query-plan.ts`)

Déterministe, sans LLM, sans règle sectorielle ou pays :

- **sujets** : le groupe nominal d'ouverture du brief, découpé sur les coordinations
  (« Distributeurs et importateurs B2B » → `distributeurs`, `importateurs b2b`), lu jusqu'à la première
  préposition, relative, ponctuation ou mot de la zone ; verbes d'instruction (« Trouver… ») ignorés ;
- **thèmes** : les catégories de l'utilisateur, puis les autres segments du brief ; un thème qui ne fait
  que répéter un sujet est ignoré ;
- **zone** : la localisation telle que saisie, ajoutée à chaque requête ;
- paires sujet × thème, **au plus 3** requêtes ; une requête dont les mots (au singulier près) recouvrent
  à ≥ 75 % une requête déjà retenue n'est pas envoyée ; les clauses d'exclusion ne sont jamais envoyées.

Exemple (benchmark) : `distributeurs fournitures pro maroc`, `importateurs b2b équipements pro maroc`,
`distributeurs mobilier pro maroc`.

Le brief complet (et non la requête raccourcie) reste la référence pour la classification, la pertinence
et les exclusions.

## Marché Brave (`src/discovery/market.ts`)

Liste des valeurs `country` acceptées par Brave reprise du contrat publié par Brave
(`brave/brave-search-mcp-server`, `src/tools/web/params.ts`) : `ALL` + 36 pays. **MA n'y figure pas.**

- `optional_filters.country` explicite : utilisé s'il est supporté, sinon `ALL` ;
- zone nommant exactement un pays supporté (nom FR/EN) ou un lieu français connu de `geo-fr.ts` → ce pays ;
- zone inconnue, pays non supporté (Maroc, Tunisie, Sénégal…) ou plusieurs pays → `ALL` (neutre).
  Plus jamais `FR` par défaut.

## C — Multi-requête (`BraveProvider.searchCompanies`)

- Exécution **séquentielle** (pas de rafale contre la limite par seconde du plan Brave, comptage avant
  chaque appel) ; un 429 arrête les requêtes restantes.
- Fusion **avant** tri/sélection : round-robin entre requêtes, une entrée par URL canonique (sans `www`,
  slash final, fragment, paramètres de tracking), provenance dans `raw_metadata.search_queries`.
- Tri qualité, puis une page par site en priorité (les autres pages du même site ne comblent que le
  reste), puis la sélection de diversité existante, puis le pipeline V2 inchangé
  (classification → entité → admissibilité → géo → fusion même entité → dédup projet).
- Échec partiel : la Discovery continue sur les résultats réellement reçus ; l'échec est visible dans
  les métriques du run (`search_requests`, `search_requests_failed`, `search_failure_codes`,
  `search_country`) et le log `search_partial_failure` (codes uniquement). Toutes les requêtes en échec →
  `DISCOVERY_FAILED`, comme avant.

## Metering

`DiscoveryService` appelle le compteur **une seule fois** par run, dès la fin de l'étape de recherche —
succès, échec partiel ou échec total — avec le nombre de requêtes **réellement envoyées**
(`api_usage_events.request_count` = 1, 2 ou 3). Coût théorique : 0,005 $ par requête, soit 0,005 / 0,010 /
0,015 $ par Discovery. Une requête en échec est comptée (estimation prudente : borne haute). Le quota
horaire ProspectOS compte toujours les runs, inchangé.

## B — Détection first-party

- Vocabulaire éditorial (`top`, `meilleurs`, `guide`, `liste`…) lu **dans le titre seulement**.
- Nouveau signal positif `title_domain_match` : le domaine enregistrable écrit dans le titre, ou 1 à 3
  mots consécutifs du titre (ou les premiers mots de l'extrait) qui épellent exactement le label du
  domaine (≥ 4 caractères) — uniquement sur la racine du site ou une page « à propos / contact », jamais
  sur un article, et jamais en présence d'un signal négatif (annuaire, liste, éditorial, marketplace,
  emploi, formation, réseau social : ces classifications restent prioritaires).
- Nom : segment du titre (coupé aussi aux virgules et `||`) qui correspond au domaine, ≤ 6 mots ; sinon
  les premiers mots qui épellent le domaine ; sinon le label du domaine. Un nom composé uniquement des
  mots de la requête reste refusé (garde existante).
- Annuaires : phrases génériques (« entreprises et fournisseurs », « pages jaunes », « liste des
  fournisseurs », « annonces B2B », « annuaire »…) dans le titre ou l'extrait → `DIRECTORY`.

Hors périmètre V3 (D) : aucune entreprise n'est extraite d'un extrait d'annuaire.

## Invariants

Aucun changement : scoring, score initial 0, revue humaine, exigences VERIFIED, RLS, Auth, entitlement,
Stripe, schéma DB (aucune migration), `geo-fr.ts`.
