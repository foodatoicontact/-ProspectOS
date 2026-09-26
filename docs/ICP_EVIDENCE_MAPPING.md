# ICP evidence mapping + preuves lisibles

Une phrase explicite d'une page peut être **proposée** pour un critère de l'ICP du projet. Une
proposition n'est jamais une preuve : elle vaut 0 point tant qu'un humain ne l'a pas confirmée.

## Chaîne (aucune migration, aucun nouveau moteur de score)

| Étape | Où | Résultat |
|---|---|---|
| Proposition | `src/discovery/strategies/icp-concepts.ts` (appelé par `generic.ts`) | observation `INFERRED`, `value=true`, type `ICP_SIGNAL:<clé>` |
| Stockage | `save_discovery_observations` (migration 004, inchangée) | preuve `INFERRED_UNCONFIRMED`, `verified_by` nul |
| Score avant revue | `scoreProspect` (inchangé) | 0 : seules les preuves `VERIFIED` + `verified_by` comptent |
| Revue | `review_discovery_observation` (inchangée) | Confirmer → `VERIFIED` (+ poids du critère) ; Contredire → `CONTRADICTED` (0) |

## Règles de proposition

- Un concept s'active uniquement d'après le **libellé** du critère écrit par l'utilisateur ; jamais par
  une clé, un nom de projet, de client ou de secteur. Un libellé qui ne nomme aucun concept ne reçoit
  aucune proposition (les ICP existants sans ces libellés gardent exactement le comportement antérieur).
- Concepts : capacité multi-unités (un nombre ≥ 2 suivi d'une unité que le libellé nomme lui-même),
  amplitude horaire (plage explicite ≥ 12 h ou 24h/24), réservation par créneau (« créneau » + durée, ou
  réservation à l'heure), offres groupes / entreprises / événements (seul le vocabulaire que le libellé
  nomme), lieu ou équipement réservable (verbe de réservation/location + lieu dans la même phrase).
- Une phrase contenant une négation est ambiguë : aucune proposition, le critère reste « À confirmer ».
- Une même phrase peut être proposée pour plusieurs critères : une ligne (et une preuve) par critère,
  chacune revue séparément.
- Clé de déduplication d'une proposition : `(source_url, ICP_SIGNAL:<clé>, empreinte de la phrase)`.
  Une réanalyse retrouve la même ligne (mise à jour si non revue, **gelée** si vérifiée ou contredite,
  règle existante de la migration 004).
- Une analyse enregistre d'abord toutes les observations informatives de toutes les pages, puis une
  seule ligne « absent » par critère non informé (borne de 40 lignes).

## Affichage (`src/components/evidence-presentation.ts`, `ObservationsReview.tsx`)

- Carte : critère ICP (titre), « Signal trouvé » (extrait cité), « Pourquoi c'est pertinent », source
  (`<titre> — site officiel`, lien `https` uniquement, nouvel onglet sans `opener`), statut humain
  (À confirmer / Observé — non vérifié / Vérifié / Contredit), actions Confirmer · Contredire · Laisser
  non vérifié, et ligne de score (« 0 point tant que… Après confirmation : +N points »).
- Les libellés techniques (`PHONE_RAW`, `GENERIC_KEYWORD_MATCH`, `UNKNOWN`, énumérations, confiance
  d'extraction) ne sont visibles que dans « Détails techniques ».
- `PHONE_RAW` → « Téléphone professionnel trouvé » ; `GENERIC_KEYWORD_MATCH` → « Information
  potentiellement pertinente » ; `UNKNOWN` → « Information à examiner » ; critères non trouvés listés une
  fois (« Non trouvé sur les pages analysées : … »).
- Section ICP : « Signal trouvé — à confirmer », « 0 pt », bouton « Examiner la preuve » (défile vers la
  carte) ; après confirmation « Vérifié +N ».

## Limites connues

- Détection déterministe en français (et quelques mots anglais) ; pas de synonymes hors libellé.
- `GENERIC_KEYWORD_MATCH` et `UNKNOWN` partagent toujours une clé de stockage par page (comportement
  antérieur) : une seule de ces lignes survit par page ; l'affichage ne s'appuie plus sur elles.
