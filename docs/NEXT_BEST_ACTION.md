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

## 5. Modèle de score (config `nba-v1-2026-10`, `src/nba/engine.ts` `NBA_DEFAULT_CONFIG`)

Chaque score va de 0 à 100 et garde ses lignes (`scores.*.lines`) ; aucun n'est masqué derrière le total.

| Score | Calcul |
|---|---|
| FIT | `scoreProspect` (preuves vérifiées). Sans couverture vérifiée : `estimateFit`, marqué `estimated` (inférence). Sans preuve : `null` (`unknown`). |
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
| 2 | OFF_TARGET | DISMISS | FIT connu < 30 |
| 3 | EXPLICIT_RECENT_NEED | CONTACT | signal « contact » **VERIFIED**, besoin explicite, fraîcheur ≥ 70 %, FIT ≥ 60 |
| 4 | RELEVANT_CONVERSATION | ENGAGE | contenu public VERIFIED, daté, pertinent, ≤ 7 j, FIT ≥ 50 |
| 5 | CONTACT_SIGNAL | CONTACT | signal « contact » VERIFIED, fraîcheur ≥ 50 %, FIT ≥ 60, TIMING ≥ 50 |
| 6 | SIGNAL_TO_VERIFY | WATCH | meilleur signal « contact » **INFERRED** (non revu), fraîcheur ≥ 50 %, FIT ≥ 50 |
| 7 | SOME_TIMING | WATCH | TIMING ≥ 15, FIT ≥ 50 |
| 8 | FIT_WITHOUT_TIMING | WAIT | FIT ≥ 50 |
| 9 | NOT_ENOUGH | DISMISS | sinon (FIT inconnu ou faible, aucun moment) |

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
