# Mapping sémantique ICP — déterministe (V2 P0-a)

Objectif : mieux exploiter ce que ProspectOS lit déjà, et lire les bonnes pages.
Contenu public → intention de la phrase → proposition vers le bon critère ICP.
Sans LLM, sans migration, sans score automatique, sans règle de secteur ou de client.

## Architecture

```
RULE ENGINE (strategies/icp-concepts.ts)          → concepts précis (multi-unités, amplitude horaire,
                                                     créneaux, offres groupes, lieu réservable)
  └─ rien trouvé ?
SEMANTIC PROPOSER (strategies/icp-intents.ts)     → intentions génériques lues dans le LIBELLÉ du critère
  └─ proposition INFERRED (0 point)
HUMAN REVIEW (review_discovery_observation)       → Confirmer / Contredire / Laisser non vérifié
  └─ VERIFIED seulement après confirmation → scoreProspect (inchangé)
```

### Intentions (activées uniquement par le libellé écrit par l'utilisateur)

| Intention | Le libellé parle de… | La phrase doit établir… |
|---|---|---|
| ACTIVITY_OR_SERVICE | cours, séances, ateliers, activités, discipline… | une offre explicite (« premier cours », « cours de X », « séances coachées »…). Si le libellé nomme l'activité (« Discipline : X ou Y »), X/Y doivent apparaître dans un contexte d'activité. |
| BOOKING_OR_REGISTRATION | réservation, inscription, rendez-vous | un canal (« en ligne », « via l'application »…) ; si le libellé exige le canal, rien d'autre ne suffit |
| SCHEDULE_OR_REGULARITY | planning, horaires, activité régulière… | un planning, des jours + heures, une récurrence (« tous les jours », « hebdomadaires ») |
| CAPACITY | capacité, plusieurs, multi… (sans unité nommée) | un total ≥ 2 unités (terrains, salles, espaces, sites…) |
| EVENT_OR_COMMUNITY | tournois, compétitions, événements, communauté | un événement daté/récurrent/organisé, ou une communauté active |
| CONTACTABILITY | contact pro, joignable, coordonnées… (pas « liste de contacts », pas « commandes par téléphone ») | téléphone, e-mail, invitation à contacter |
| PRICING_OR_OFFER | tarifs, abonnements, formules, fidélisation, offres commerciales (pas « l'offre » seule) | un montant, une promotion, une formule |
| LOCATION_OR_PHYSICAL_PRESENCE | adresse, implantation, présence physique | une adresse physique |

Quand un concept du rule engine possède le libellé mais ne trouve rien, une intention peut répondre,
**jamais** une version affaiblie du concept (un horaire quelconque ne prouve pas une « amplitude étendue »).

### Polarité

- **positive** → observation `INFERRED`, `value: true`, type `ICP_SIGNAL:<clé>` (le type que la revue
  humaine connaît déjà), extrait exact, URL source, raison (« Pourquoi c'est pertinent »), confiance ≤ 0,6.
  Stockée comme preuve `INFERRED_UNCONFIRMED` : **0 point** jusqu'à confirmation humaine.
- **negative** (« pas de réservation », « aucun cours ») et **insufficient** (« bientôt », année passée,
  mention seulement tarifaire, formulation négative ambiguë) → **jamais de proposition**. Une note de
  contexte (`ICP_INTENT_NEGATIVE` / `ICP_INTENT_INSUFFICIENT`, `value: null`, stockée sans critère) explique
  pourquoi le critère reste « À confirmer ».
- Les données de contact (téléphone, e-mail) ne soutiennent **que** un critère de contact.

## Pages internes analysées

Toujours **3 pages maximum** (page d'accueil + 2), même origine, même fetcher (robots.txt, politique
SSRF, redirections, taille, délai). Seul l'**ordre** change :

1. la page d'accueil est analysée d'abord ;
2. les critères qu'elle soutient déjà fortement (confiance ≥ 0,5) ne consomment plus de page ;
3. les liens internes sont classés : +3 par intention encore manquante que leur chemin/texte nomme
   (planning, tarifs, activités, cours, réservation, événements, tournois, contact…), +1 pour les pages
   génériques historiques (contact, à propos, services…) ; à égalité, l'ordre du site ;
4. mentions légales, CGV, panier, compte, connexion… ne sont jamais retenus.

Sans critère correspondant, le comportement historique est conservé (pages génériques dans l'ordre du site).

## Mesure avant / après

`tests/fixtures/semantic-icp-benchmark.ts` : fixtures représentatives et anonymisées du benchmark réel
(studios, box communautaire, clubs, page de négations). Attendus et interdits écrits **avant**
l'implémentation. Référence « avant » mesurée sur `52bc1f3` et figée dans
`tests/fixtures/semantic-icp-baseline.json`.

| | Avant (52bc1f3) | Après (P0-a) |
|---|---|---|
| Propositions correctes / attendues | 3 / 22 | 22 / 22 |
| Faux positifs | 0 | 0 |
| Encore non mappés | 19 | 0 |

Ces fixtures ont servi à écrire les règles : le 22/22 ne vaut pas une mesure en conditions réelles. Des
phrases non vues (autres secteurs, pièges) sont testées à part, et le juge final reste le rejeu des trois
cas du benchmark réel (mêmes requêtes, zones et critères).

## Tests

- `tests/semantic-icp-mapping.test.ts` : 16 cas de régression, invariants, phrases non vues, avant/après.
- `tests/semantic-icp-db.mjs` : stockage et revue réels (PGlite), notes sans preuve, score exact après
  confirmation, nouvelle analyse sans rétrogradation d'un VERIFIED.
