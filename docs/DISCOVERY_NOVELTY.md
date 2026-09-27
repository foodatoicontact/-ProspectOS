# Discovery Novelty Engine (V2 P0-C)

Revenir sur le même marché doit faire émerger de **nouveaux** acteurs. ProspectOS sait maintenant ce que
le projet a déjà vu. Aucune migration, aucune table, aucun appel fournisseur supplémentaire.

## Statuts (par projet)

| Statut | Sens | Action proposée |
|---|---|---|
| `NEW` | jamais vu dans ce projet | Ajouter / Ignorer |
| `SEEN` | apparu dans un run antérieur, jamais ajouté | Voir l’ancien run · Ajouter / Ignorer |
| `ADDED` | déjà un prospect du projet | **Voir le prospect** (jamais « Ajouter ») |
| `IGNORED` | ignoré explicitement dans un run antérieur | « Ignoré précédemment » · Voir l’ancien run · réexamen possible |
| `CURRENT_RUN_DUPLICATE` | même acteur plus haut dans ce run | signalé, compté à part |

La comparaison porte sur **tout l’historique du projet**, jamais sur un autre projet ni une autre
organisation (le même acteur est `NEW` pour chacune).

## Identité (du plus fort au plus faible)

1. même `prospect_id` (lien de dédoublonnage vers un prospect existant, ou résultat antérieur accepté) ;
2. même **domaine** de l’organisation (uniquement un site propre résolu — jamais un annuaire, une
   marketplace ou un article), sauf deux villes connues et différentes (chaîne) ;
3. même **téléphone** normalisé ;
4. **nom canonique + localisation compatible** (ville du résultat, sinon zone du run), jamais si les
   deux côtés ont des sites différents ;
5. même page source canonique (résultats non résolus : la même page, pas le même acteur).

Jamais une simple similarité de nom.

## Mémoire du projet (`PROJECT DISCOVERY MEMORY`)

Sources existantes, lues **une fois par run** (pas de N+1), avec le client de l’utilisateur (RLS) :

- `prospects` du projet (déjà lus par le dédoublonnage) ;
- `discovery_results` du projet, hors run courant : colonnes d’identité + `status` + `prospect_id` +
  statuts de résolution lus dans `normalized_payload` ; pages de 1000, 10 000 lignes au plus
  (au-delà : `novelty_memory_truncated` dans les métriques) ;
- `discovery_runs` du projet (zone de chaque run).

Le classement se fait en mémoire (`src/discovery/novelty-engine.ts`). Le résultat est un **instantané**
stocké dans `normalized_payload.raw_metadata.novelty` : ce que le projet savait au moment du run.
Le run précédent reste inchangé. Si la lecture de la mémoire échoue, la recherche aboutit quand même,
sans étiquette (`novelty_unavailable: 1`) — jamais un faux « nouveau ».

## Compteurs (métriques du run, `discovery_runs.metrics`)

`results_total`, `new_results`, `seen_results`, `already_added`, `ignored_results`,
`duplicate_results` (doublons du run, y compris les pages fusionnées), plus deux ratios de marché :

- `new_discovery_rate` = nouveaux / acteurs distincts du run ;
- `repeat_rate` = (déjà vus + ajoutés + ignorés) / acteurs distincts.

Ce ne sont pas des scores : ils décrivent la saturation d’un marché dans le temps. Les métriques
existantes sont conservées.

### Univers des compteurs (correctif)

Les compteurs `new_results`, `seen_results`, `already_added`, `ignored_results`, `duplicate_results` et
`new_discovery_rate` portent **uniquement sur les candidats exploitables** (COMPANY_CANDIDATE). Les pages
écartées et sources non résolues sont comptées à part (`rejected_results`) ; `results_total` reste le
nombre total de résultats du run et `eligible_candidates_total` le nombre d'exploitables. À l'écran, seuls
les exploitables portent une pastille de nouveauté et entrent dans les filtres ; les autres restent visibles
dans « Tous », après les exploitables. L'identité Novelty et l'admissibilité sont inchangées.

**Runs antérieurs au correctif** : leurs métriques (et leur ligne d'historique « X nouveaux ») ne sont pas
recalculées et peuvent être gonflées par des pages écartées comptées comme nouvelles. Aucun backfill.

## Interface

- Résumé du run : « 7 nouveaux · 6 déjà vus · 4 déjà ajoutés · 3 ignorés » (mobile).
- Onglets (desktop) / puces compactes 44 px (mobile) : Tous · Nouveaux · Déjà vus · Ajoutés · Ignorés
  (· Doublons s’il y en a).
- Par défaut : **Tous, nouveaux en premier**. « Nouveaux uniquement » = onglet Nouveaux, seulement sur
  choix de l’utilisateur (B5).
- Historique : « X nouveaux · Y déjà vus » (colonne Résultats sur desktop, ligne courte sur mobile).
  Les runs antérieurs au moteur n’affichent rien (aucun chiffre inventé).
- « Rejouer la recherche » préremplit toujours seulement ; le nouveau run est comparé à toute la mémoire.

## Snapshot historique vs état actuel

- `historical` : l'instantané du run (`normalized_payload.raw_metadata.novelty`) et ses compteurs
  (`discovery_runs.metrics`). **Jamais réécrits.**
- `current_project_status` : calculé à chaque lecture d'un run (`GET discovery-runs/:id/results`), une
  lecture des prospects du projet sous RLS, affichage seulement. Un acteur devenu prospect depuis le run
  (même domaine propre ou téléphone, ou le prospect du snapshot toujours présent) est `ADDED`.
- L'écran montre l'état actuel (« Déjà ajouté » → Voir le prospect, pas d'« Ajouter ») ; l'état au moment
  du run reste en infobulle (« Au moment de cette recherche : Déjà vu »). Un snapshot `ADDED` dont le
  prospect a été supprimé s'affiche « Déjà vu ».
- **Tri** : l'ordre suit le snapshot (nouveaux en premier au moment du run). Il est stable : une ligne
  réconciliée en « Déjà ajouté » reste là où l'utilisateur l'a touchée (sur mobile, elle ne sort pas des
  résultats visibles).
- **Filtres, compteurs de l'écran et actions** suivent l'état actuel : un acteur `ADDED` aujourd'hui n'a
  jamais de bouton « Ajouter ».
- Un résultat décidé **dans ce run** compte selon cette décision dans les onglets et compteurs de l'écran
  (ajouté → « Ajoutés », ignoré → « Ignorés ») ; sa carte garde l'étiquette du run à côté de « Ajouté au
  projet » / « Ignoré ». Instantané et métriques du run inchangés (`decidedNovelty`).
- **Aucune réécriture des métriques historiques** : la lecture d'un run n'écrit rien ; l'historique des runs
  garde les compteurs d'origine (`X nouveaux · Y déjà vus` au moment du run).

## Jamais un second prospect (B14)

- UI : un résultat `ADDED` n’a pas de bouton « Ajouter », seulement « Voir le prospect ».
- Serveur : `POST discovery-results/:id/accept` refuse (409 `ALREADY_ADDED`, avec le prospect à ouvrir)
  quand le résultat a le même domaine propre ou le même téléphone qu’un prospect du projet et que la RPC
  en créerait un nouveau. Le lien de dédoublonnage existant (`duplicate_candidate`) et la réutilisation
  de la même clé restent gérés par `accept_discovery_result`, inchangée.
- Écran périmé (acteur ajouté entre-temps depuis un autre run, onglet ou utilisateur) : le 409
  `ALREADY_ADDED` n'est pas affiché comme une erreur. La ligne est réconciliée (« Déjà ajouté au projet »,
  « Voir le prospect »), le run est relu depuis le serveur et la liste des prospects rafraîchie. Aucun
  second appel, aucun second prospect.

## Préparé, non implémenté (B6/B8)

`SearchUntilNewTarget {desiredNewResults, maxProviderCalls, seenEntityIds}` et `entityKey()` : une
version future pourra relancer des variantes de requête jusqu’au quota de nouveaux, au budget
fournisseur ou à l’épuisement de l’espace de recherche. La version 1 n’ajoute **aucun** appel Brave.

## Tests

- `tests/discovery-novelty.test.ts` : B18 1–15, exemple Kevin (B13), identité (B2), échec de mémoire,
  B8, B21.
- `tests/discovery-novelty-db.mjs` (PGlite, chaîne complète, RLS) : instantané en jsonb, ADDED/IGNORED
  via les vraies RPC, compteurs dans `metrics`, isolation projet et tenant, lecture croisée refusée.
- Durcissement final : ancien run réouvert (snapshot `SEEN` conservé, état actuel `ADDED`, métriques
  identiques) ; course entre deux onglets (le second « Ajouter » périmé est refusé avec le prospect
  existant — sans la garde, la RPC seule aurait créé un doublon, vérifié puis annulé) ; UI réconciliée
  sans erreur brute (navigateur, 390 et 1440).
