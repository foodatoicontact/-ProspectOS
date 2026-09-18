# Discovery — diversité / déduplication des candidats

Référence technique du bloc `fix/discovery-candidate-diversity`.

## Diagnostic

Après 4A.1, le smoke réel a montré 2 des 3 slots occupés par des variantes quasi identiques de « Resto
Drive » (même domaine, titres partageant un long préfixe générique). Le pipeline evidence-first n'y est
pour rien.

Cause exacte, confirmée par lecture directe :

- `BraveProvider.searchCompanies` (4A.1) applique uniquement le tri de qualité
  (`assessCandidateQuality`) avant `.slice(0, max_results)` — **aucune étape de diversité/déduplication
  n'existe entre le tri et la troncature**.
- `DeduplicationService` (utilisée dans `services.ts`, `DiscoveryService.find_prospects`) s'exécute
  **après** la troncature (sur les 3 résultats déjà finaux), et uniquement pour **étiqueter**
  `dedupe_status` en vue d'une revue humaine — jamais pour retirer ni remplacer un candidat.
- Même appliquée plus tôt, `DeduplicationService` serait **inopérante** ici : son modèle d'identité
  compare `website`/`phone`/`address`/`city`, tous `null` pour un résultat Brave brut
  (`normalizeResult` fixe `website:null,city:null,phone:null,address:null` avant toute analyse de page).
  Sa comparaison floue nom+ville exige explicitement que les deux villes soient renseignées
  (`c.city&&other.city&&...`) — jamais le cas ici. Elle a été conçue pour des prospects déjà analysés,
  pas pour des résultats de recherche bruts.

## Fichiers modifiés

- `src/discovery/candidate-diversity.ts` (nouveau) — sélection de diversité, pure et déterministe.
- `src/discovery/deduplication.ts` — `normalize` rendu `export` (aucun changement de comportement,
  évite de dupliquer la même normalisation dans le nouveau module).
- `src/discovery/providers/brave.ts` — insertion de l'étape de diversité entre le tri qualité et la
  troncature à `max_results`.
- `tests/candidate-diversity.test.ts` (nouveau), `tests/brave-candidate-ranking.test.ts` (test de bout
  en bout ajouté).

Rien d'autre touché — `types.ts`, `services.ts`, `candidate-quality.ts`, migrations, RLS, quotas,
`scoreProspect`, Evidence, ICP, Outreach, Account/RGPD, pricing Brave : inchangés.

## Algorithme

Sélection gloutonne sur le pool **déjà trié par qualité** (celui de 4A.1, jusqu'à 20 résultats dans le
même appel), strictement avant la troncature :

1. Parcourir le pool dans l'ordre de qualité décroissant.
2. Garder un candidat seulement s'il n'est pas un quasi-doublon d'un candidat déjà retenu.
3. Une fois `max_results` candidats distincts retenus, les suivants sont mis de côté (`skipped`).
4. Si le premier passage n'a pas atteint `max_results` (pas assez de candidats réellement distincts dans
   tout le pool), compléter avec les candidats mis de côté, dans leur ordre de qualité d'origine —
   jamais retourner moins de résultats que le pool ne peut en fournir.

### Détection du quasi-doublon (`isNearDuplicateCandidate`)

Deux signaux, jamais un domaine partagé seul :

- **Similarité de titre élevée (≥ 0,85)**, quel que soit le nom d'hôte — suffit seule (cas d'un même
  établissement listé sous deux URLs différentes, titres quasi identiques).
- **Même hôte normalisé** ET **un titre normalisé contient l'autre comme préfixe/sous-chaîne** (au moins
  15 caractères) — signal plus faible, retenu **uniquement** combiné au même domaine. Nécessaire car une
  similarité d'édition classique sur deux chaînes de longueurs très différentes (le cas réel exact :
  « Commande en ligne restaurant Toulouse » contre la même phrase suivie de « : solution click & collect
  | Resto Drive ») reste basse malgré un recouvrement total du préfixe.

**Un domaine partagé seul ne suffit jamais** : deux pages clairement distinctes d'un domaine corporate
multi-établissements ne sont jamais fusionnées automatiquement.

## Comportement sur quasi-doublons

Deux résultats « Resto Drive » quasi identiques (même domaine, préfixe commun) → un seul occupe un slot
final ; l'autre est écarté au profit du meilleur candidat distinct suivant dans le pool.

## Comportement multi-entités même domaine

Deux pages du même domaine mais à titres réellement différents (ex. un domaine de groupe listant
plusieurs enseignes) → **toutes deux conservées**, aucune fusion automatique — testé explicitement
(fixture C).

## Impact coût fournisseur

Aucun. Cette étape ne touche ni `count` (toujours 20, un seul appel HTTP), ni `request_count` (toujours
1 dans `recordApiUsage`), ni `provider_pricing` (5000 micros/`request`, inchangé). C'est une sélection
en mémoire sur des résultats déjà reçus dans l'unique appel Brave facturé.

## Mise à jour 4A.2.1 — régression production : résolution par domaine enregistrable (eTLD+1)

### Régression observée et diagnostic

Après déploiement de 4A.2, le smoke production a montré les deux résultats « Resto Drive » toujours
présents dans le top 3. Diagnostic détaillé (bloc 4A.2 « PRODUCTION REGRESSION ») : `normalizeHost`
comparait les noms d'hôte par **égalité stricte** après avoir seulement retiré un préfixe `www.` — sans
aucune notion de domaine racine partagé entre sous-domaines. Reproduit empiriquement : avec les deux
titres réels exacts (similarité d'édition ≈0,514, très inférieure au seuil de 0,85 ; préfixe normalisé
partagé de 37 caractères, condition de longueur satisfaite), le signal faible (même hôte + préfixe) ne
se déclenchait que si les deux URLs partageaient le **même hostname littéral** — hypothèse vérifiée par
la fixture 4A.2, mais **non confirmée** sur les vraies données Brave (le JSON brut réel n'a pas été
observé directement). Une variante plausible et courante (sous-domaine de commande dédié vs domaine
principal, ou deux sous-domaines frères) reproduit exactement le symptôme observé.

### Dépendance ajoutée : `tldts`

Avant d'ajouter une dépendance, `package.json`/`package-lock.json`/`node_modules` ont été inspectés :
aucune capacité de résolution de domaine enregistrable (Public Suffix List) n'existait, ni directement
ni en transitif (aucun `psl`, `tldts`, `parse-domain`, etc.). Une heuristique naïve « 2 derniers labels »
a été explicitement écartée : elle échoue sur les TLD composés (`foo.example.co.uk` et
`bar.other.co.uk` se réduiraient tous deux, à tort, à `co.uk`, fusionnant deux entités totalement
distinctes — exactement le risque que ce bloc doit éviter).

`tldts@7.4.13` (épinglé exact, comme toutes les dépendances du repo) a été retenu : activement
maintenu, une seule dépendance propre (`tldts-core`), typé TypeScript nativement, API minimale
(`getDomain(hostname)` → domaine enregistrable ou `null`), utilisé uniquement côté serveur (jamais
embarqué côté client — Discovery est exclusivement logique de route API). Comportement vérifié
explicitement avant intégration sur tous les cas requis : sous-domaines (`commande.`/`www.`/`pro.`),
TLD composés (`.co.uk`), domaines distincts sous même suffixe, et retour `null` (jamais un crash, jamais
une supposition) pour `localhost`, les IP littérales et les URLs invalides.

### Algorithme mis à jour

`isNearDuplicateCandidate` remplace la comparaison de hostname strict par une comparaison de
**domaine enregistrable exact** (`getDomain(a) === getDomain(b)`, jamais `null === null`) — toujours
combinée au signal de contenu (préfixe partagé ≥15 caractères), **jamais suffisante seule** : ce
garde-fou (Test 3) reste strictement inchangé. Le signal fort (similarité de titre ≥0,85, indépendant du
domaine) est également inchangé.

## Risques résiduels

- Le seuil de similarité de titre (0,85) et le seuil de longueur minimale de préfixe partagé (15
  caractères) restent des constantes choisies raisonnablement, pas dérivées empiriquement d'un grand
  corpus.
- La cause « sous-domaines différents » reste une explication **reproduite et fortement probable**, pas
  un fait de production définitivement établi (le JSON brut réel de Brave n'a jamais été inspecté
  directement dans ce projet). Si le prochain smoke production montre encore le même symptôme, il
  faudra obtenir les hostnames/URLs bruts réels pour confirmer ou infirmer cette hypothèse.
- Comme en 4A.1/4A.2, aucun appel Brave réel n'a validé ce comportement en conditions réelles —
  uniquement fixtures reproduisant fidèlement le pool et les titres observés.
