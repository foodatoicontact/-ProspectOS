# Discovery — qualité des candidats Brave

Référence technique du bloc `fix/discovery-candidate-quality`.

## Diagnostic

Premier smoke Brave réel (projet Foodatoi, requête « restaurants Toulouse commande en ligne »,
`max_results=3`) : les 3 résultats étaient des pages éditoriales/agrégateurs (Uber Eats, un listicle
« 10 restaurants… », un article de blog local), aucun établissement individuel.

Deux causes, aucune ne relevant du pipeline evidence-first (resté intact et correct) :

1. **Requête trop générique** : `[query, location, ...categories].join(' ')` ne porte aucun biais vers
   une page d'entreprise individuelle. Pour un contenu commercial local à forte concurrence, le contenu
   éditorial (guides, comparatifs, marketplaces) est structurellement mieux référencé que la page d'un
   petit établissement — Brave renvoie donc en priorité ce contenu, pas parce que Brave « se trompe »
   mais parce que la requête ne demande rien d'autre.
2. **Aucun filtre/tri de qualité** : `searchCompanies` ne demandait que `min(max_results, 20)` résultats
   à Brave (donc littéralement 3 pour ce test) et les retournait tels quels, dans l'ordre de pertinence
   générique de Brave — sans aucune relecture. Avec un pool de 3, il n'y avait même pas de marge pour
   reclasser quoi que ce soit.

## Fichiers modifiés

- `src/discovery/candidate-quality.ts` (nouveau) — heuristique pure, déterministe, générique.
- `src/discovery/providers/brave.ts` — requête + sur-échantillonnage + tri, avant troncature à `max_results`.
- `tests/candidate-quality.test.ts`, `tests/brave-candidate-ranking.test.ts` (nouveaux).

Aucun autre fichier touché. `types.ts` (schémas), `services.ts`, `deduplication.ts`, `observations.ts`,
`repository.ts`, migrations, RLS, quotas, `scoreProspect`, Evidence, Outreach, Account/RGPD : inchangés.

## Algorithme

### 1. Construction de requête (légèrement biaisée, générique)

Ajout du terme `"site officiel"` à la requête existante (`query + location + categories`) — une
expression générique, valable pour n'importe quel secteur (un restaurant, un cabinet comptable, une
agence immobilière ont tous potentiellement « un site officiel »), jamais un nom de secteur/marque/ville.

### 2. Sur-échantillonnage dans le même appel

`count` passe de `min(max_results, 20)` à **toujours 20** (le plafond de l'API Brave), quel que soit
`max_results`. Brave facture par requête, pas par résultat (`provider_pricing` : 5000 micros/`request`,
inchangé) — demander 20 résultats au lieu de 3 dans le **même** appel HTTP ne coûte rien de plus et ne
constitue pas une requête supplémentaire. C'est ce qui donne enfin une marge au tri : reclasser 3
résultats ne change rien, reclasser un pool de 20 permet de faire remonter les bons candidats
initialement classés au-delà de la position `max_results` par le tri générique de Brave.

### 3. Filtre/tri de qualité (`assessCandidateQuality`)

Pour chaque résultat brut (title/url/description), calcule une confiance (base 0,45, bornée à [0,05 ;
0,9]) et un signal explicable, à partir de signaux uniquement observables :

| Signal | Détection | Effet |
|---|---|---|
| `listicle_pattern` | titre commençant par un nombre (`^(les )?\d{1,3}\s+\S`) | −0,25 |
| `editorial_pattern` | vocabulaire générique de classement (meilleur·e·s, top, classement, comparatif, guide, sélection, palmarès) | −0,20 |
| `aggregator_pattern` | vocabulaire générique multi-entités (annuaire, comparateur, plateforme, marketplace, trouvez) **ou** domaine connu (voir liste) | −0,20 à −0,30 |
| `multi_entity_page` | domaine connu comme plateforme multi-entités | (cumulé avec aggregator_pattern) |
| `likely_business_site` | **uniquement si aucun signal négatif** ET chemin peu profond (`/` ou un seul segment) ET titre court (≤60 caractères) | +0,15 |
| `location_match` | la zone demandée (premier segment avant la virgule) apparaît dans le titre/description/URL — purement observationnel | +0,05 |
| `ambiguous` | aucun signal positif ni négatif détecté | inchangé (reste à 0,45, sauf `location_match` indépendant) |

Liste `KNOWN_AGGREGATOR_HOSTS` (signal secondaire, volontairement courte, générique multi-secteurs) :
Uber Eats, Deliveroo, Just Eat, TripAdvisor, PagesJaunes, Yelp, LeBonCoin, SeLoger, Google, Facebook,
Instagram, Wikipedia, Trustpilot.

**Jamais d'exclusion dure** : tous les résultats sur-échantillonnés sont conservés jusqu'au tri, seul le
classement change, puis troncature à `max_results` — un faux positif de l'heuristique ne fait donc que
reclasser un résultat plus bas, jamais le supprimer silencieusement avant que l'utilisateur ne le voie.

`quality_signal`/`quality_reasons` sont stockés dans `Candidate.raw_metadata` (champ déjà libre,
`z.record`) — jamais présentés comme une preuve ICP, jamais une Evidence.

## Exemples avant/après (fixtures)

| Résultat (titre) | Avant (ordre Brave brut) | Après (signal / confiance) |
|---|---|---|
| Uber Eats — « Plats à emporter… » | position 1 (conservé) | `aggregator_pattern`, 0,20 |
| « 10 restaurants avec service de livraison… » | position 2 (conservé) | `listicle_pattern`, 0,25 |
| toulouscope.fr — article éditorial | position 3 (conservé) | `ambiguous`, 0,50 (référence de zone dans l'URL, honnête) |
| Chez Mario — site individuel (hypothétique, 4ᵉ position brute) | **absent** du top-3 avant, jamais montré | `likely_business_site`, 0,65 — **désormais dans le top-3** |

Avec `max_results=3`, le résultat exclu après tri est l'agrégateur (0,20), pas Chez Mario — Chez Mario
apparaît maintenant en tête. Aucun appel Brave réel n'a été effectué pour produire ce tableau : ces
scores sont calculés déterministiquement par `tests/brave-candidate-ranking.test.ts` sur des fixtures
mockées reproduisant fidèlement les 3 résultats réellement observés + un candidat individuel hypothétique.

## Risque résiduel assumé

Le 3ᵉ résultat réellement observé (« toulouscope.fr ») ne matche aucun mot-clé listicle/agrégateur —
c'est un article au ton éditorial mais sans vocabulaire de classement détectable génériquement.
L'heuristique le laisse donc `ambiguous`, ni pénalisé ni favorisé au-delà de l'observation de zone. C'est
un choix délibéré : inventer un signal taillé pour reconnaître spécifiquement ce nom de domaine
reviendrait à sur-ajuster sur cet unique exemple plutôt qu'à généraliser — exactement ce que le brief
interdit. Une future itération pourrait ajouter un signal générique supplémentaire (longueur de titre à
la voix journalistique, absence de mention de nom propre) si ce cas se révèle fréquent en usage réel,
mais aucun signal de ce type n'est ajouté ici sans validation empirique.
