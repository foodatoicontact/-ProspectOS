# Search-Until-New (V2, V1)

Quand une recherche ramène surtout des acteurs déjà connus du projet, ProspectOS peut explorer d’autres
variantes pour essayer d’en faire émerger de nouveaux — **dans les limites configurées**. Il ne promet
jamais « N nouveaux prospects » ; chaque run dit pourquoi il s’est arrêté.

## Modes (choix explicite, défaut : Tous)

| Mode | Moteur | Écran |
|---|---|---|
| **Tous les résultats** (`all`, défaut) | recherche historique inchangée | comportement Novelty actuel (nouveaux en tête, filtres) |
| **Nouveaux en priorité** (`new_first`) | identique — aucun appel supplémentaire | le run s’ouvre sur le filtre « Nouveaux » (les autres à un tap) |
| **Rechercher de nouveaux acteurs** (`search_new`) | jusqu’à **3 requêtes Brave**, une par passe | résumé « N passes · raison d’arrêt », détails repliés |

Le mode, l’objectif de nouveaux (`desired_new_results`, 1 à `max_results`, défaut `max_results`) et le
plafond (`max_provider_calls`, ≤ 3) sont stockés dans `discovery_runs.filters_json`. « Rejouer la
recherche » les préremplit et ne lance rien.

## Budget (V1, sans migration)

- **1 passe = 1 requête Brave. Au plus 3 requêtes par run** — le plafond déjà existant d’une recherche
  normale (plan de 1 à 3 requêtes). Même quota (1 run = 1 unité), même enveloppe de coût et de temps.
- **Temps** : une nouvelle passe ne démarre que si `écoulé + 12 s ≤ 40 s` (12 s = timeout d’une requête
  Brave) ; pire cas 3 × 12 s = 36 s, sous le `maxDuration` de 60 s. Sinon arrêt `TIME_BUDGET`.
- **Coût** : chaque requête est enregistrée dans le ledger existant (nombre réel, une seule écriture par
  run) — 1 / 2 / 3 requêtes = 0,005 / 0,010 / 0,015 $ au tarif `brave-search-2026-09-18`. Visible dans le
  coût du run. Aucun coût fictif (mode TEST : aucun coût).
- **Quota** : inchangé, consommé au démarrage (`start_discovery`) ; s’il est atteint, le run ne démarre
  pas (`quota_exceeded`, comportement existant).

## Algorithme

1. Variantes **déterministes et finies** (≤ 6), construites uniquement avec les mots de l’utilisateur :
   A. chaque requête du `query-plan` existant, seule ; C. une variante par catégorie + zone.
   (B — pagination `offset` Brave — n’est **pas** utilisée en V1 : non exercée dans le code actuel.)
2. Passe = 1 requête → normalisation → fusion avec les passes précédentes (`mergeSameEntityCandidates`,
   même identité que Novelty) → comptage des **NEW** avec la mémoire du projet (Novelty). Un acteur vu
   dans plusieurs passes n’est qu’une ligne et n’est compté qu’une fois.
3. Arrêts :
   - `TARGET_REACHED` — objectif de nouveaux atteint ;
   - `NO_NEW_RESULTS` — **une passe complémentaire (2ᵉ ou 3ᵉ) n’a ajouté aucun nouvel acteur** après
     dédoublonnage et mémoire : on n’utilise pas les requêtes restantes ;
   - `MAX_PROVIDER_CALLS` — 3 requêtes envoyées ;
   - `NO_MORE_VARIANTS` — plus de variante ;
   - `TIME_BUDGET` — une passe de plus dépasserait le budget temps ;
   - `PROVIDER_ERROR` — une passe ≥ 2 a échoué : **les résultats déjà trouvés sont conservés**, run
     `completed`. Si la passe 1 échoue : run `failed` (comportement existant).
4. Sélection finale : toutes les passes fusionnées, **nouveaux d’abord**, limitée à `max_results`.
   **Un seul `discovery_run`**, classifié et sauvegardé comme un run normal.

Sans mémoire projet (lecture impossible) ou avec un fournisseur qui ne sait pas faire une passe, le mode
retombe sur la recherche normale (`search_mode_fallback` dans les métriques) — jamais un faux « nouveau ».

## Ce qui compte comme « nouveau prospect »

Uniquement un **COMPANY_CANDIDATE** (classe de la porte d'admissibilité, inchangée), unique après
fusion des passes, conservé dans les résultats et classé **NEW** par Novelty. Les pages écartées
(IRRELEVANT) et les sources non résolues (UNCERTAIN, SIGNAL_SOURCE) ne comptent **jamais** : leur
identité se réduit à leur URL, donc elles seraient « jamais vues » par construction. `TARGET_REACHED`
seulement si ce nombre ≥ `desired_new_results`.

Sélection finale : 1) exploitables NEW, 2) autres exploitables (déjà vus, ajoutés, ignorés), 3) résultats
écartés, puis limite `max_results` — une page écartée n'évince jamais une entreprise connue.

Correctif du test réel sur la Preview (run 1e0462dc) : 22 « nouveaux » affichés alors qu'un seul
candidat exploitable l'était ; les pages écartées gonflaient le compteur et avaient remplacé les
entreprises connues dans la sélection. Ce run garde ses métriques d'origine (pas de réécriture).

## Métriques (`discovery_runs.metrics`, métriques existantes conservées)

- `provider_results_total` : résultats bruts du fournisseur (toutes passes) ;
- `unique_candidates_total` : résultats uniques après fusion des passes ;
- `eligible_candidates_total` / `rejected_results` : exploitables / écartés ou non résolus, parmi les résultats gardés ;
- `new_results_found` : exploitables gardés classés NEW (= `new_results`) ;
- `pass_new_results` : nouveaux exploitables apportés par **chaque** passe (non cumulé) ;
- `search_mode`, `provider_calls`, `search_passes`, `desired_new_results`, `stop_reason`,
  `pass_durations_ms`, `pass_results`, `pass_kinds` ;
- compteurs Novelty (`new_results`, `seen_results`, `already_added`, `ignored_results`,
  `duplicate_results`, `new_discovery_rate`) calculés sur les **seuls exploitables**.

Jamais une requête ni une URL.

## Interface

- Formulaire : « Mode de recherche » ; en mode approfondi, « Objectif de nouveaux prospects ».
- Pendant la recherche : « Recherche approfondie en cours… (jusqu’à 3 passes) » (pas de progression
  live en V1 — elle demanderait d’écrire/sonder les métriques pendant le run).
- Résumé : « 3 passes de recherche · Arrêt : limite de recherche atteinte » (ou « Objectif atteint : 10
  nouveaux acteurs trouvés », « aucun nouveau résultat supplémentaire », « budget temps atteint »,
  « erreur fournisseur après résultats partiels ») ; détails par passe repliés ; compteurs Novelty et coût
  à côté. Historique : « X nouveaux · Y déjà vus · 3 passes de recherche ».

## Tests

- `tests/search-until-new.test.ts` : modes, 1/2/3 passes, chaque raison d’arrêt, plafond, budget temps,
  échec partiel, dédoublonnage inter-passes, SEEN/ADDED/IGNORED/NEW, métriques, comptage ledger, run
  unique, variantes, replay, cas de référence saturé (sans exiger de nouveau).
- `tests/search-until-new-db.mjs` (PGlite) : `filters_json`, métriques jsonb, un seul run / une unité
  de quota, coût réel 1/2/3 requêtes, RLS tenant et projet, aucune migration.
