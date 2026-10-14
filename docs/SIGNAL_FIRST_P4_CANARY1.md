# Signal-first Discovery V1 — P4: itération après le canary #1

Branche `feat/signal-first-discovery`, HEAD avant P4 `f3fd5721`. Aucune migration (030 inchangée), aucun changement
d'API, de quota ou de RLS. ENTITY / Registry Discovery et `src/discovery/geo-fr.ts` ne sont pas modifiés.

## Canary #1 — verdict `SIGNAL_FIRST_V1_NEEDS_ITERATION`

Run staging `4baae3b8-e115-4c15-872d-c05f814d9c2f` — « restaurant » × Occitanie, Brave, 3 requêtes, 56 résultats,
25 lignes enregistrées : **4 IN, 13 UNKNOWN, 8 OUT**. Environ 3 ouvertures réelles dans la zone (Quick Le Crès,
O'Tacos Carcassonne, Burger King Castelnaudary).

| # | Défaut observé | Cause |
|---|---|---|
| 1 | Ouvertures hors zone (Coutances, Loudéac, Connerré, Les Ulis, Vannes…) classées UNKNOWN, donc proposées à la revue | Le référentiel géo ne connaît que les préfectures et départements |
| 2 | « au Mans » lu « Mans », « aux Ulis » lu « Ulis » | Article contracté non restitué |
| 3 | Castelnaudary perdu (lieu écrit seulement dans le titre) | Le lieu du titre n'était lu que si la phrase n'en donnait aucun |
| 4 | Quick Le Crès : 5 lignes pour un seul événement | Noms non résolus (« un nouveau Quick », « Quick s'installe… ») ; « Crès » ≠ « Hérault (34) » |
| 5 | « … - MontpelYeah Magazine » → OUT `non_commercial:MEDIA` ; noms de site dans les extraits | Le nom du média collé au titre était lu comme l'organisation |
| 6 | Un guide (« Guide pour ouvrir un snack ») et un classement (« Top 200 ») acceptés comme événements | Filtre « listicle » limité à certaines règles |
| 7 | « Jonzac » pris pour une entreprise | Une commune en tête de phrase n'était pas reconnue comme lieu |
| 8 | 48 résultats sur 56 hors Occitanie | Le nom de région dans la requête ne cadre pas le moteur |

## Correctifs P4

- `src/signal-discovery/communes-fr.ts` (généré, 5 268 communes) : communes de 2 000 habitants ou plus, source
  officielle Etalab `@etalab/decoupage-administratif@4.0.0` (COG INSEE). Un homonyme n'est gardé que si une commune est
  au moins 5× plus peuplée que la suivante ; sinon il est exclu (jamais deviné). Régénération :
  `node scripts/build-communes-fr.mjs <communes.json>`.
- `places.ts` : une commune n'est lue **que** lorsque le texte l'introduit comme lieu (« à », « au », « aux »,
  « dans la commune de », « près de », « zone commerciale du »…), nom complet, article tel qu'écrit (jamais ajouté :
  « dans le Val-d'Oise » n'est pas la commune « Le Val »). Départements homonymes de mots courants (« dans l'Eure »,
  « dans le Var ») ; gentilés des grandes villes uniquement après un mot de lieu (« la métropole montpelliéraine »).
- `extract.ts` : nom du site retiré du titre (après « | » toujours ; après un tiret seulement s'il correspond à
  l'hôte) ; nouveau rejet `GENERIC_CONTENT` (guides, coûts, étapes, top N, classements) sur toutes les règles ;
  le lieu du titre est utilisé quand la phrase de l'événement ne nomme aucun lieu connu.
- `entity.ts` : nom lu comme **objet** de l'événement (« nouveau restaurant Burger King », « un nouveau Quick »),
  en-tête de titre « X s'installe / ouvre / arrive… » ; une commune seule en tête de proposition n'est jamais un nom
  (sauf introduite : « l'enseigne Orange »).
- `rank.ts` : zone calculée d'abord depuis les départements résolus du lieu de l'événement ; le type « non
  commercial » se lit sur l'organisation (nom, sujet), jamais sur la source ; deux lieux concordent s'ils partagent
  un département ; à la fusion, la source IN est montrée en premier.
- `plan.ts` : une région est atteinte par six villes (Occitanie : Toulouse, Montpellier, Nîmes, Perpignan, Béziers,
  Carcassonne) ; toujours ≤ 3 requêtes, mêmes limites Brave, même fraîcheur 180 jours.

## Rejeu hors ligne des 25 lignes du canary #1

| | Avant | Après P4 |
|---|---|---|
| Lignes | 25 | 19 |
| IN | 4 | 4 (dont Burger King Castelnaudary désormais nommé et localisé) |
| UNKNOWN | 13 | 2 (La Jonquera en Espagne ; une ouverture sans lieu) |
| OUT | 8 | 13 |
| Quick Le Crès | 5 lignes | 1 ligne + 3 autres sources (la 5e est une histoire « expansion » distincte) |
| Guide / classement | acceptés | rejetés `GENERIC_CONTENT` |

Limite du rejeu : seules la phrase retenue et le titre sont stockés, pas le snippet complet ; un titre seul peut donc
être rejeté au rejeu alors qu'il passait avec son snippet (cas « Le Crès : Quick arrive prochainement »). Le plan de
requêtes (#8) ne se valide qu'en conditions réelles : c'est l'objet du canary #2.

Tests : `tests/signal-discovery-canary1.test.ts` (7 tests, marques fictives, communes réelles) ; suites P1–P3
inchangées et vertes (61 tests Signal-first, PGlite 35/35 et 9/9).

## Canary #2 — protocole et critères

Même projet, mêmes entrées que le canary #1 (« restaurant », Occitanie, `new_site` + `expansion`, 20 résultats),
sur le Preview de la branche, `SIGNAL_DISCOVERY_ENABLED=true` en Preview uniquement.

`SIGNAL_FIRST_V1_GO` si les quatre critères tiennent :

1. ≥ 50 % des lignes non-OUT sont réellement en Occitanie (lecture humaine) ;
2. ≤ 20 % des lignes en UNKNOWN ;
3. 0 guide / classement / article de conseil parmi les lignes ;
4. aucun événement présent en plus de deux lignes non fusionnées.

Sinon `NEEDS_ITERATION`, avec pour prochain levier le plan de requêtes (une requête par ville, ou le mot-clé du
département).
