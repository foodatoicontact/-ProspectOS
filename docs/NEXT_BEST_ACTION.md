# Next Best Action — cerveau de distribution (V1)

Branche `feat/next-best-action`, partie de `feat/signal-first-discovery` (`1efd562`). Migration `031`. Flag
`NEXT_BEST_ACTION_ENABLED` (absent = OFF ; jamais activé en Production par ce bloc). Aucun envoi : ni SMTP, ni IONOS, ni
IMAP, ni LinkedIn, ni commentaire, ni DM automatiques.

## 1. Audit (phase 0)

Le dépôt contient déjà l'essentiel des briques ; le moteur NBA les **compose**, il n'en duplique aucune.

| Brique | Où | Ce qu'elle fait déjà | Usage NBA |
|---|---|---|---|
| Evidence | `db/schema.sql` `evidence`, `src/domain/core.ts` | Preuves par critère, statut, `verified_by`, 90 j | FIT, `WHY_THIS_ACCOUNT` (ids de preuves) |
| FIT | `scoreProspect`, `estimateFit` | FIT vérifié + FIT estimé (preuves à vérifier) | `FIT_SCORE` (vérifié ; estimé signalé comme tel) |
| Signaux | migration 024/026, `src/signals/*` | Fait public daté, sourcé, `PENDING_REVIEW → VERIFIED/REJECTED` par une personne, confiance par règle de source | Matière première des signaux commerciaux |
| Intent Engine | `src/domain/intent.ts` | `scoreIntent` : poids × confiance × récence (demi-vie / âge max par type) × pertinence ; rendements décroissants ; VERIFIED seulement (+ estimé) | `INTENT_SCORE` tel quel ; ses demi-vies servent de décroissance par défaut |
| Why now | `src/domain/why-now.ts` | Phrase verbatim du meilleur signal vérifié | Repris pour le brouillon CONTACT |
| Contenus publics | migration 027 `prospect_public_content` | Post/article ajouté par une personne, revu VERIFIED, auteur, date | **Conversations publiques** (ENGAGE) |
| Outreach | 027–029, `src/outreach/*` | Brouillon DRAFT→APPROVED→USED, provenance figée, `fact-guard` | Brouillons NBA vérifiés par `checkComposedMessage` ; aucun envoi |
| Feedback | migration 025 `contact_snapshots`, `src/domain/feedback.ts` | Instantané FIT/INTENT/signaux au contact, taux par bande | NBA y ajoute action recommandée / décision / résultat |
| Multi-tenant | `prospectos_private.is_member/require_member`, RLS | Isolation organisation | Mêmes fonctions, mêmes motifs |
| Flags | `*_ENABLED` lus côté serveur (`aiOutreachEnabled`, `signalDiscoveryEnabled`) | Absent = OFF | Même motif |
| UI | `app/page.tsx` (SPA), `ProspectDetailB` `NextBestActionHead` | « Prochaine action » = étape du workflow de message (générer / approuver / copier) | Conservé ; la vue `actions` est une file inter-prospects, pas un remplacement |

Constats :
- Il n'existe **aucune** file inter-prospects, aucune notion d'action recommandée persistée, ni de TIMING séparé de
  l'INTENT, ni de décision humaine sur une recommandation.
- Les types de signaux (024) sont génériques (`hiring_role`, `funding`…) et figés par une contrainte SQL que de nombreux
  tests épinglent. Les types commerciaux demandés (`HIRING_SDR`, `PIPELINE_BUILDING`…) sont donc une **classification**
  au-dessus de 024, pas un nouveau stockage.
- Il n'existe aucun modèle « personne ». La seule personne publique fiable connue est l'auteur d'un contenu public
  vérifié (027).
- Une ICP par projet (`icps.project_id unique`) : filtrer par ICP revient à filtrer par projet.
- Le script de migration staging refuse une migration numérotée sous la plus haute déjà appliquée (030) : NBA part de la
  branche Signal-first et prend le numéro 031.

## 2. Composants réutilisés / manquants

Réutilisés sans modification : `scoreProspect`, `estimateFit`, `scoreIntent`, `recency`/`DECAY`, `whyNow`,
`checkComposedMessage`, `prospect_public_content`, `signals`, `evidence`, `is_member`/`require_member`, motif flag.

Manquants (ajoutés) : registre des signaux commerciaux, classification + statut de preuve, scores TIMING / FRESHNESS /
EVIDENCE_QUALITY / OPPORTUNITY, règles NBA, explication factuelle référencée, rôle cible, conversations ENGAGE, file et
« Today », état et historique des décisions, résultat (feedback), UI `actions`.

## 3. Architecture

```
signals (024) ─┐                       ┌─ registry.ts  (types commerciaux, décroissance, rôles, thèmes)
public content ┼─► classify.ts ────────┤
evidence ──────┘   (type commercial,   └─ config.ts    (seuils, poids, limites — versionnés)
                    VERIFIED/INFERRED/UNKNOWN)
        │
        ▼
   score.ts  FIT (core) · INTENT (intent.ts) · TIMING · FRESHNESS · EVIDENCE_QUALITY → OPPORTUNITY
        │
        ▼
   decide.ts  règles ordonnées → CONTACT / ENGAGE / WATCH / WAIT / DISMISS + raison de règle
        │
        ▼
   explain.ts WHY_THIS_ACCOUNT / WHY_NOW / WHY_THIS_ACTION (chaque phrase : fait|inférence|inconnu + refs)
   content.ts brouillon CONTACT / commentaire + DM ENGAGE, passés au fact-guard
        │
        ▼
   api.ts (flag) ─► save_nba_actions (031, instantané figé) ─► file / today / décision / résultat
```

Le calcul est **pur et déterministe** (`now` passé en paramètre) ; la base ne recalcule rien mais valide que chaque
référence (signal, contenu, preuve) appartient au prospect et au tenant.

## 4. Risques

- Classification par mots : un intitulé d'offre ambigu tombe en type de base (`OTHER`/générique), jamais « deviné ».
- Personne cible : seule source fiable = auteur d'un contenu public vérifié ; sinon `UNKNOWN`.
- Les seuils V1 sont des choix explicites, documentés et versionnés (`config_version`), pas des valeurs apprises.
- Dépendance de branche : la PR NBA contient la PR Signal-first (#31) tant que celle-ci n'est pas fusionnée.

## 5. Modèle de score (config `nba-v1.3-2026-10`, `src/nba/engine.ts` `NBA_DEFAULT_CONFIG`)

Chaque score va de 0 à 100 et garde ses lignes (`scores.*.lines`) ; aucun n'est masqué derrière le total.

| Score | Calcul |
|---|---|
| FIT | `scoreProspect` (preuves vérifiées). Sans couverture vérifiée : `estimateFit`, marqué `estimated` (inférence). Sans preuve : `null` (`unknown`). Inchangé, stocké et affiché. **v1.3 : la décision lit `scores.fit.profile`** (§ 6, FIT semantics). |
| INTENT | `scoreIntent` inchangé (signaux VERIFIED uniquement). |
| FRESHNESS | `100 × 0,5^(âge / demi-vie)` du signal moteur, 0 au-delà de l'âge max. Décroissance par type (registre ; sinon celle de l'Intent Engine). Conversation : demi-vie 3 j, âge max 14 j. |
| TIMING | Par type commercial, seul le meilleur signal compte (les doublons corroborent, n'ajoutent rien) : `poids_timing(type) × fraîcheur × facteur_statut` (VERIFIED 1, INFERRED 0,5). Entre types : rendements décroissants 1, ½, ¼, plafond 100. Une conversation pertinente compte `0,7 × fraîcheur`. |
| EVIDENCE_QUALITY | `60 × (confiance de la source × facteur_statut)` du moteur + `40 × couverture ICP vérifiée`. |
| OPPORTUNITY | `0,35 FIT + 0,30 TIMING + 0,15 INTENT + 0,10 EVIDENCE + 0,10 FRESHNESS`. Sert au classement, **jamais** à décider seul. |

Décroissances propres (justifiées dans `registry.ts`) : recrutement SDR / BDR 14 / 60 j (annonces pourvues en quelques
semaines), AE et premier commercial 21 / 75 j, Head of Sales 30 / 90 j, besoin public et appel d'offres 14 / 45 j. Levée de
fonds, nouveau dirigeant, implantation… reprennent celles de l'Intent Engine (ex. levée 60 / 270 j).

## 6. Règles Next Best Action (ordonnées, la première qui s'applique décide ; `RULES`)

| # | Règle | Action | Condition |
|---|---|---|---|
| 1 | CLOSED_PROSPECT | DISMISS | statut Gagné / Perdu / Ignoré |
| 2 | OFF_TARGET | DISMISS | FIT **KNOWN_LOW** (information défavorable vérifiée) et niveau < 30 (v1.3) |
| 3 | EXPLICIT_RECENT_NEED | CONTACT | signal « contact » **VERIFIED** dans la zone (si l'ICP en a une), besoin explicite, fraîcheur ≥ 70 %, FIT **vérifié** ≥ 60 |
| 4 | RELEVANT_CONVERSATION | ENGAGE | contenu public VERIFIED, daté, pertinent, ≤ 7 j, niveau FIT ≥ 50 |
| 5 | CONTACT_SIGNAL | CONTACT | signal « contact » VERIFIED dans la zone, fraîcheur ≥ 50 %, FIT **vérifié** ≥ 60, TIMING des seuls signaux de la zone ≥ 50 |
| 6 | SIGNAL_TO_VERIFY | WATCH | meilleur signal « contact » **INFERRED** (non revu), fraîcheur ≥ 50 %, niveau FIT ≥ 50 |
| 7 | SOME_TIMING | WATCH | TIMING ≥ 15, niveau FIT ≥ 50 |
| 8 | FIT_FRESH_SIGNAL | WATCH | niveau FIT ≥ 50 + signal frais pas hors zone (v1.3, monotonie) |
| 9 | FIT_WITHOUT_TIMING | WAIT | niveau FIT ≥ 50 |
| 10 | UNKNOWN_FIT_FRESH_SIGNAL | WATCH | FIT **UNKNOWN** + signal non rejeté, fraîcheur ≥ 50 %, pas hors zone (v1.1) |
| 11 | INCOMPLETE_FIT_FRESH_SIGNAL | WATCH | FIT **INCOMPLETE** (rien de défavorable) + même signal frais (v1.3) |
| 12 | FIT_UNKNOWN_NO_TIMING | DISMISS | FIT **UNKNOWN**, rien de frais pour WATCH — **à documenter**, pas rejeté (v1.3.x) |
| 13 | FIT_INCOMPLETE_NO_TIMING | DISMISS | FIT **INCOMPLETE**, rien de frais pour WATCH — **à documenter**, pas rejeté (v1.3.x) |
| 14 | LOW_FIT_NO_TIMING | DISMISS | FIT **KNOWN_LOW** entre 30 et 49 (OFF_TARGET non atteint) — faible adéquation (v1.3.x) |

### NBA v1.3.x — sémantique de l'ancien NOT_ENOUGH (2026-10-18)

L'ancienne règle terminale NOT_ENOUGH (DISMISS) mélangeait trois états : FIT inconnu, FIT incomplet mais favorable, FIT
faible vérifié. Elle est remplacée par les règles 12–14 ci-dessus, **mêmes actions, mêmes seuils** (contactMin 60,
engageMin 50, watchMin 50, dismissBelow 30, fraîcheur inchangée) : aucune décision CONTACT / ENGAGE / WATCH / WAIT ne
change. Les trois cas sont exhaustifs (SUFFISANT est toujours pris par FIT_WITHOUT_TIMING) ; un cas non couvert est une
erreur, jamais une règle inventée. OFF_TARGET reste le seul rejet fort par inadéquation vérifiée.

*Aujourd'hui* : `hidden.document` compte FIT_UNKNOWN_NO_TIMING et FIT_INCOMPLETE_NO_TIMING (« À documenter · N », compteur
non interactif dans Today 2.0 : aucune carte, aucun filtre, jamais « en veille ») ; `hidden.dismiss` ne compte plus que
LOW_FIT_NO_TIMING, OFF_TARGET, CLOSED_PROSPECT. Les recommandations déjà stockées avec `rule = NOT_ENOUGH` ne sont pas
réécrites : *Aujourd'hui* les lit selon leur `scores.fit.profile.state` stocké (UNKNOWN / INCOMPLETE → à documenter,
KNOWN_LOW ou absent → écarté).

**Version.** `config_version` reste `nba-v1.3-2026-10`. Il entre dans l'empreinte (`version:action:primary`) qui décide si
une recommandation ouverte est remplacée et si une recommandation close (REJECTED / DONE) peut être reproposée : le changer
remplacerait au prochain calcul toutes les recommandations ouvertes (reports SNOOZED compris) et reproposerait celles
qu'une personne a closes, alors qu'aucune action ni aucun paramètre ne change. La traçabilité est portée par `rule`, stocké
sur chaque ligne ; l'action et l'empreinte étant identiques, les lignes NOT_ENOUGH existantes restent « inchangées » jusqu'à
leur prochain vrai changement.

### NBA v1.3 — FIT semantics + GEO data quality (canary 2, 2026-10-17)

Canary 2 6XPOS (verdict FAIL) : Mojo et O’Crousti Poulet (restaurants ouverts il y a 6 jours dans la zone, `target_fit`
vérifié) → DISMISS « FIT 35/100 insuffisant », alors que 65 % de l'ICP était simplement **non documenté** ; Popeyes (Les
Ulis), Tasty Crousty (Vannes), McDonald's (Connerré) → WATCH, leurs anciens signaux n'ayant pas de lieu structuré.

**Cause FIT.** Les règles comparaient `scores.fit.score` (somme des critères TRUE) aux seuils : un critère inconnu valait
0, comme un critère faux. Ajouter une preuve vraie faisait passer un compte du FIT `unknown` (règle UNKNOWN_FIT_FRESH_SIGNAL,
WATCH) au FIT `verified` 35 (NOT_ENOUGH, DISMISS) : le moteur punissait la vérification.

**Modèle (`FitProfile`, `fitProfileOf`).** Par critère : *positif* (vérifié TRUE, ou estimé TRUE), *négatif* (vérifié
FALSE — la seule « information défavorable »), *inconnu* (sans preuve, contradiction à revoir, observation FALSE non
vérifiée). On en tire `positive_weight`, `negative_weight`, `unknown_weight`, `observed_weight`, `coverage` (= observé /
total), `verified_coverage`, `direction` (POSITIVE / NEGATIVE / MIXED / NONE), `level` (= score `estimateFit` fusionné :
points vérifiés + points estimés) et `verified_score` (= `scoreProspect`). État : UNKNOWN (rien d'observé), INCOMPLETE
(rien de défavorable, niveau < 50), SUFFICIENT (niveau ≥ 50), KNOWN_LOW (défavorable vérifié **et** niveau < 50). Le score
historique `scores.fit.score` / `basis` / `coverage` est inchangé (stocké, affiché, OPPORTUNITY).

**Décision.** WATCH / WAIT / ENGAGE lisent le niveau ; **CONTACT lit le seul score vérifié** (≥ 60, inchangé : un FIT
estimé n'atteint plus jamais CONTACT) ; OFF_TARGET et le refus de WATCH exigent une information défavorable vérifiée.
Seuils, poids, demi-vies, expirations : inchangés.

**Invariant de monotonie** (`tests/next-best-action-v13.test.ts`, exhaustif : 4 critères × 4 états × 9 situations) : un
critère qui passe de UNKNOWN à TRUE vérifié, toutes choses égales par ailleurs, ne rend jamais l'action moins favorable
(CONTACT > ENGAGE > WATCH > WAIT > DISMISS). La règle FIT_FRESH_SIGNAL existe pour lui : sans elle, un compte INCOMPLETE
avec un signal frais (WATCH) passait en WAIT en devenant SUFFISANT.

**Explications.** INCOMPLETE : « Le compte correspond aux critères vérifiés disponibles, mais seulement 35 % de l’ICP est
documenté : des informations supplémentaires sont nécessaires avant une prise de contact », et la liste des critères non
documentés (UNKNOWN). KNOWN_LOW : « Des éléments vérifiés indiquent que le compte ne correspond pas suffisamment à la cible
(défavorable : …) ». « Insuffisant » n'est plus jamais écrit pour une absence d'information.

**Garde-fou GEO.** Avec un ICP géographique, un signal de lieu UNKNOWN ne fait jamais CONTACT : les règles CONTACT ne
retiennent que les signaux MATCH, et le TIMING qu'elles comparent ne compte que ces signaux. Il peut au plus faire WATCH.
NBA ne lit toujours aucun texte de lieu.

**LEGACY_GEO_BACKFILL** (`src/signal-discovery/legacy-geo.ts`, `scripts/legacy-geo-backfill.ts`, migration 032). Le
pipeline Signal-first actuel (P4, `places.ts` `eventPlacesIn` : préfectures, départements, communes de ≥ 2 000 habitants
introduites comme lieu) enregistre déjà un lieu structuré (`raw_metadata.location` : départements, régions), traduit par
l'adaptateur France (`src/geo/fr.ts`) en pays / admin_area_level_1 / admin_area_level_2 / locality : rien à dupliquer. Les
signaux antérieurs à P4 n'en ont pas. Le backfill relit **avec le même lecteur**, sur le texte déjà stocké (phrase de
l'événement, puis titre), ne touche que les signaux Signal-first sans lieu structuré, garde tout lieu ambigu tel quel
(plusieurs départements → UNKNOWN par le modèle), écrit la provenance (`raw_metadata.location_backfill` : version, source,
lecteur, lieu précédent, date) et est idempotent. Les signaux étant immuables (`guard_signal`, 024), la migration 032 ajoute
une seule exception au garde-fou : ce backfill, une fois, sur un signal sans lieu structuré, sans toucher aucune autre clé
ni colonne (`tests/legacy-geo-backfill-db.mjs`). Aucun droit client ajouté.

### Correctif canary 1 (v1.1, 2026-10-17)

Canary 6XPOS sur staging : 10 DISMISS sur 10 et une explication fausse (« ni un signal récent » à côté d'un signal de
5 jours). Trois corrections, rien d'autre (poids, seuils FIT, demi-vies, expirations, règles CONTACT / ENGAGE inchangés) :

- **FIT inconnu ≠ FIT faible ≠ hors ICP** : un signal frais non rejeté donne WATCH (« à vérifier par une personne »), jamais
  CONTACT (toutes les règles CONTACT exigent un FIT connu).
- **WHY_THIS_ACTION dérivé de l'état réel** (`actionReason`) : signal récent présent, signal trop ancien (nommé, avec sa
  durée de vie), signal hors zone (nommé, avec son lieu), FIT faible, ou informations insuffisantes — jamais une phrase
  générique.
- **SIGNAL_GEO_RELEVANCE** (`geoRelevance`) — **remplacé en v1.2 par le modèle géographique générique, voir `docs/GEO_MODEL.md`.** Version v1.1 d'origine : zone = localisations `target_fit` de l'ICP résolues en codes de département /
  régions (geo-fr : régions, départements, préfectures — une commune plus petite saisie dans l'ICP n'est pas résolue, donc pas de zone) ; lieu du signal = `raw_metadata.location` structuré de Signal-first. MATCH (département de la
  zone, ou région nommée en entier), MISMATCH (toutes ses régions hors zone : TIMING 0 pour cet ICP), UNKNOWN (pas de zone,
  lieu non structuré, ou même région mais autre département) : compté comme avant, l'incertitude est écrite. Aucune
  comparaison de texte.
- La version de configuration fait partie de l'empreinte : un recalcul par une nouvelle version réécrit ses raisons.

Restent pour une phase suivante (documentés, non traités) : rôle cible CHR (gérant / franchisé plutôt que CEO) et
distinction enseigne / établissement local.

Conséquences voulues : FIT 95 sans signal → WAIT ; un signal non vérifié ne déclenche jamais CONTACT ; un besoin explicite
frais l'emporte sur une conversation ; un signal de 6 mois → WAIT, et l'explication le nomme, avec sa source.

## 7. Explication, personne, contenus

- Chaque phrase est typée `fact` (avec ses références ouvrables), `inference`, `unknown` ou `rule`. Les extraits sont
  cités mot pour mot.
- `TARGET_ROLE` vient du type de signal (registre), annoncé comme inférence. `TARGET_PERSON` = auteur d'un contenu public
  VERIFIED, sinon `UNKNOWN`. Aucune personne n'est déduite d'un rôle.
- CONTACT : brouillon du composeur existant (`composeRuleBased`), passé au `fact-guard`. ENGAGE : angle, commentaire suggéré
  (une idée sur le sujet, sans flatterie ni affirmation sur l'auteur) et DM après échange. Refus systématique des offres
  gratuites (essai, bêta, test) et de la fausse familiarité ; les noms propres ne déclenchent pas le filtre de flatterie.
- Rien n'est envoyé : l'UI ne fait que copier un texte et enregistrer une décision humaine.

## 8. États, historique, feedback

`PENDING → APPROVED / DONE / SNOOZED / REJECTED`, `APPROVED → DONE / REJECTED`, `SNOOZED → PENDING / REJECTED` ;
`EXPIRED` quand la raison ne compte plus (`expires_at` = fin de vie du signal moteur, fin de fenêtre ENGAGE, ou +30 j sans
raison datée). Une seule recommandation ouverte par prospect ; un recalcul remplace une PENDING / SNOOZED (événement
`superseded`), jamais une APPROVED. L'instantané calculé est immuable (trigger, même pour le propriétaire de la table).
`nba_action_events` garde chaque décision ; `recommended_action`, `human_action`, état et `outcome` sont stockés côte à
côte pour analyser plus tard ce qui convertit (aucun modèle ML).

## 9. Sécurité

RLS lecture membres sur les deux tables ; aucune écriture client (privilèges révoqués) ; fonctions `security definer`,
`search_path` vide, `require_member` ; chaque référence (signal non rejeté, contenu VERIFIED, preuve) doit appartenir au
prospect et au tenant. Contrôle post-migration `db/migrations/checks/031_next_best_action.sql`.

## 10. Limites connues (V1)

- Explications et brouillons rédigés en français (l'interface est bilingue, le contenu généré ne l'est pas encore).
- Thèmes de conversation orientés « vente / prospection » ; un projet d'un autre secteur s'appuie sur ses termes INTENT.
- Calcul à la demande (bouton « Recalculer »), sur les 500 prospects les plus récents d'un projet ; pas de tâche planifiée.
- Pas encore de canal d'exécution : IONOS / SMTP viendront ensuite, derrière la décision humaine déjà enregistrée ici.
