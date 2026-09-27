# Kevin — Benchmark V2 (pré-recontact)

Rapport figé le 27/09/2026, sur `main` = f543d81 (production), branche `feat/pre-kevin-benchmark-polish`.
Mesures **en lecture seule** sur la base de production (SELECT uniquement) : aucun run, aucune écriture,
aucune réécriture de métriques. Le moteur n'a pas été modifié pendant la mesure.

Conventions :

- les chiffres viennent de `discovery_runs.metrics`, de `discovery_results` (colonne `source_class`,
  instantané `normalized_payload.raw_metadata.novelty`), de `website_analysis_audit`,
  `prospect_observations` et `evidence` ;
- « exploitable » = `COMPANY_CANDIDATE` ; « écarté » = tout le reste (ici uniquement `IRRELEVANT`) ;
- « n/d » = la donnée n'existe pas pour ce run (run antérieur au moteur concerné) — jamais estimée ;
- coût = ledger `api_usage_events` au tarif `brave-search-2026-09-18` (5 000 micro-$ par requête) ;
- **Trouvé ≠ observé ≠ supposé ≠ vérifié** : aucune preuve n'est vérifiée dans ces deux projets
  (0 `VERIFIED`), donc tous les scores sont à 0/100.

Connaissance de Kevin : Kevin n'a encore rien révélé. Tous les acteurs ci-dessous sont classés
`UNKNOWN_UNTIL_KEVIN_REVIEW`. `KNOWN_BY_KEVIN_CONFIRMED` = 0, `NEW_TO_KEVIN_CONFIRMED` = 0.

---

## CASE 1 — PADEL

Projet : **Kevin — Blind Test Avignon** (`9903f499…`).

### Search parameters

| Paramètre | Valeur du benchmark | Valeur réellement envoyée (dernier run, 8c4f58d8) |
|---|---|---|
| Requête | « Identifier les infrastructures, clubs, organisateurs et communautés de padel réellement actifs dans la zone de pratique autour d’Avignon, avec des signaux publics de matchs, parties, réservations, tournois, événements, plusieurs terrains ou activité régulière. » (260 caractères) | « …tournois, événements,plusieurs terrains,activité » (≤ 250 caractères : le champ tronque au-delà de 250, voir friction F-02) |
| Zone | Avignon et périphérie, Grand Avignon, Vaucluse et communes limitrophes | identique |
| Catégories | padel, club de padel, complexe sportif, sports de raquette, loisirs sportifs | identique |
| Max résultats | 20 | 20 |
| Fournisseur | Brave | Brave |

### ICP (base Kevin, inchangée)

| # | Critère | Poids | Clé stockée |
|---|---|---|---|
| 1 | Infrastructure ou acteur padel réellement actif | 25 | `target_fit` |
| 2 | Matchs / parties / réservations actives | 25 | `need_fit` |
| 3 | Communauté / événements / tournois | 20 | `commercial_signal` |
| 4 | Capacité exploitable / plusieurs terrains | 20 | `contactability` |
| 5 | Canal de contact ou d’activation identifiable | 10 | `criterion_1b2e…` |

### Runs

| Run | Date (UTC) | Zone | Mode | Résultats gardés | Exploitables | Écartés | Coût |
|---|---|---|---|---|---|---|---|
| f77bcc71 | 26/09 14:43 | Avignon, Vaucluse | (avant modes) | 20 | 7 | 13 | 0,0150 $ |
| 6a2a2ef6 | 26/09 14:53 | … rayon 25 à 30 km | (avant modes) | 19 | 6 | 13 | 0,0150 $ |
| 847e5230 | 26/09 14:59 | … commune limitrophe | (avant modes) | 19 | 6 | 13 | 0,0150 $ |
| 7b000991 | 26/09 14:59 | Grand Avignon, Vaucluse | (avant modes) | 20 | 6 | 14 | 0,0150 $ |
| f051fe85 | 26/09 15:04 | zone du benchmark | (avant modes) | 19 | 6 | 13 | 0,0150 $ |
| 5d95b008 | 26/09 15:09 | zone du benchmark | (avant modes) | 19 | 6 | 13 | 0,0150 $ |
| 8c4f58d8 | 26/09 15:16 | zone du benchmark | (avant modes) | 19 | 6 | 13 | 0,0150 $ |

Les 7 runs Padel sont **antérieurs** au moteur Novelty (0e06620) et à Search-Until-New (e32cf4f) :
aucun instantané de nouveauté, aucune métrique de passes.

**Rejeu V2 (A. Tous, B. Rechercher de nouveaux acteurs) : NON EXÉCUTÉ dans ce bloc.** Cet
environnement n'a ni accès à l'application de production (`*.vercel.app` bloqué par le proxy sortant) ni
identifiants de compte ; lancer un run exige une session utilisateur. Aucun chiffre n'est inventé pour
A et B. Protocole exact à exécuter depuis le compte du projet, puis mesure en lecture seule :

1. Projet « Kevin — Blind Test Avignon » → Trouver des prospects.
2. Coller la requête du benchmark (le champ en garde les 250 premiers caractères : « …plusieurs terrains
   ou activité »), zone, catégories et max 20 ci-dessus, source Brave.
3. Run A : mode « Tous les résultats ». Run B : mode « Rechercher de nouveaux acteurs », objectif 20.
4. Ne rien ajouter ni ignorer entre A et B.

### Discovery (dernier run comparable : 8c4f58d8)

| Métrique | Valeur |
|---|---|
| provider_results_total | n/d (métrique introduite avec Search-Until-New) |
| unique_candidates_total | n/d |
| results gardés | 19 |
| eligible_candidates_total (recalcul lecture seule) | 6 |
| rejected_results (recalcul lecture seule) | 13 (`IRRELEVANT`) |
| requêtes fournisseur | 3 (plan de requêtes) |
| coût | 0,0150 $ |

Exploitables de 8c4f58d8 : Chez PaPé Padel, Le Hangar Sport & Co, Paul & Louis Sport (ajouté),
« Club de padel à Avignon » (titre « Padel Zone Avignon – … », domaine non résolu), « Club de Padel
Avignon » (titre « Urban Padel – … », domaine non résolu), Padel Magazine.

### Novelty

| new | seen | added | ignored |
|---|---|---|---|
| n/d | n/d | n/d | n/d |

Aucun run Padel ne porte d'instantané Novelty (tous antérieurs au moteur). État actuel du projet :
3 prospects (les 3 acteurs de référence).

### Search-Until-New

| passes | provider calls | stop reason | cost |
|---|---|---|---|
| non exécuté | — | — | — |

### Qualification (3 prospects, analyses du 26/09)

| Prospect | Analyse | Pages | Critères avec signal (sur 5) | Preuves à confirmer | Vérifiées | Coordonnées observées |
|---|---|---|---|---|---|---|
| Chez PaPé Padel | ANALYZED | 1 | 1 — Capacité (« 3 terrains de padel intérieur ») | 1 | 0 | téléphone |
| Le Hangar Sport & Co | ANALYZED | 2 | 2 — Événements (« Anniversaire »), Capacité (« Six terrains doubles … et deux terrains simples ») | 3 | 0 | téléphone |
| Paul & Louis Sport | ANALYZED | 3 | 2 — Événements (« tournois et événements sportifs … régulièrement »), Capacité (« 4 terrains indoor ») | 2 | 0 | téléphone |

- Prospects analysables : 3/3 (site propre résolu).
- Analyses réussies : 3/3. Analyses échouées : 0.
- Critères avec signaux : 5 signaux sur 15 cases (3 × 5). Jamais de signal pour « Infrastructure padel
  réellement active », « Matchs / parties / réservations » et « Canal de contact ».
- Preuves à confirmer : 6 (`INFERRED_UNCONFIRMED`). Vérifiées : 0.
- Faux mappings observés : 1 — Le Hangar, « Anniversaire » (offre d'anniversaire) proposé pour
  « Communauté / événements / tournois ». À trancher par Kevin.
- Signal manqué observé : le téléphone est observé chez les 3 (`PHONE_RAW`) mais jamais proposé pour le
  critère « Canal de contact ou d’activation identifiable ».
- Coordonnées exploitables : 3/3 téléphone, 0 e-mail.

### Actionability (3 acteurs de référence)

| Indicateur | Valeur |
|---|---|
| Activité pertinente (padel dans le titre de la source) | 3/3 |
| Localisation exploitable | 3/3 zone `VERIFIED` à la découverte ; ville de la fiche vide 3/3 |
| Moyen de contact | 3/3 (téléphone) |
| Au moins un signal métier utile (proposé) | 3/3 (capacité) |
| Actionnables commercialement avec au moins 1 preuve **vérifiée** | 0/3 (aucune confirmation humaine) |
| Réunissent activité + contact + ≥ 1 signal proposé | 3/3 |

### Prospects de référence

| Acteur | Novelty | Résolution | Analyse | Mapping ICP | Contact | Événements | Réservations | Capacité | Faux positifs | Manquant |
|---|---|---|---|---|---|---|---|---|---|---|
| Chez PaPé Padel | n/d (aucun instantané) ; état actuel : prospect du projet | nom + domaine | 1 page | Capacité | tél. 04… | — | — | 3 terrains | — | réservations, événements, canal (non mappé) |
| Le Hangar Sport & Co | idem | nom + domaine | 2 pages | Événements, Capacité | tél. 07… | « Anniversaire » (discutable) | — (`UNKNOWN` sur la page) | 8 terrains | mapping « Anniversaire » | réservations, canal (non mappé) |
| Paul & Louis Sport | idem (ajouté depuis 8c4f58d8) | nom + domaine | 3 pages | Événements, Capacité | tél. 04… | tournois réguliers | — | 4 terrains | — | réservations, canal (non mappé) |

### Observed strengths

- Présence des acteurs de référence, sous leur nom et leur domaine propre : Chez PaPé Padel 6/7 runs,
  Paul & Louis Sport 6/7, Le Hangar Sport & Co 5/7 ; les trois dans chacun des 3 runs avec la zone exacte
  du benchmark (f051fe85, 5d95b008, 8c4f58d8).
- 3/3 analyses abouties ; 5 signaux proposés, chacun avec l'extrait exact et l'URL source.
- Capacité (nombre de terrains) extraite chez les 3 avec le chiffre lu (3, 8, 4).
- Aucun score attribué sans confirmation humaine (0/100 partout).

### Observed failures

- 13 résultats écartés sur 19 dans chaque run de la zone du benchmark (68 %) : coût payé pour des pages
  non exploitables.
- Zone « Grand Avignon, Vaucluse » (7b000991) : aucun des 3 acteurs de référence (14 écartés sur 20).
- Faux positifs gardés comme exploitables : Padel Magazine (média) ; dans f77bcc71 : un annuaire
  d'associations sportives, le Club alpin (FFCAM, « raquette » = raquettes à neige), une page université,
  une page de magazine de boutique (« Monplaisir Ballconcept » pour un titre « Magazine Bandeja Shop »).
- Noms mal extraits : « Club de padel à Avignon » (Padel Zone Avignon) et « Club de Padel Avignon »
  (Urban Padel), domaine non résolu.
- Le téléphone observé n'alimente pas le critère « Canal de contact ».
- Requête du benchmark tronquée à 250 caractères par le formulaire.

### Open questions for Kevin

1. Parmi Chez PaPé Padel, Le Hangar Sport & Co, Paul & Louis Sport, Padel Zone Avignon, Urban Padel :
   lesquels connaissiez-vous déjà ?
2. Une offre « Anniversaire » compte-t-elle pour « Communauté / événements / tournois » ?
3. EFive (futsal, complexe sportif, Vaucluse) est-il dans votre cible ?
4. Quel signal public vaut pour « Matchs / parties / réservations actives » (lien de réservation,
   application tierce, planning) ?

---

## CASE 2 — SPORT & BIEN-ÊTRE

Projet : **Kevin — Avignon — Sport & Bien-être** (`3068b6c2…`).

### Search parameters

| Paramètre | Valeur |
|---|---|
| Requête | « Acteurs sport & bien-être actifs autour d’Avignon : Hyrox, Pilates, Yoga, Pole Dance, Fitness, RPM/Cycling et Reformer. » |
| Zone | Avignon et périphérie |
| Catégories | hyrox, pilates, yoga, pole dance, fitness, cycling, reformer |
| Max résultats | 20 |

### ICP

| # | Critère | Poids | Clé stockée |
|---|---|---|---|
| 1 | Activité correspondant explicitement à une discipline cible | 30 | `target_fit` |
| 2 | Lieu physique ou activité exploitable localement | 20 | `need_fit` |
| 3 | Cours / séances / réservation active | 20 | `commercial_signal` |
| 4 | Planning ou activité régulière observable | 15 | `contactability` |
| 5 | Canal de contact ou d’activation identifiable | 15 | `criterion_f0dc…` |

### Runs

| Run | Date (UTC) | Mode | Gardés | Exploitables | Écartés | Novelty exploitables (new / seen / added) | Coût |
|---|---|---|---|---|---|---|---|
| 4d077d07 | 26/09 15:39 | (avant modes) | 20 | 13 | 7 | n/d | 0,0150 $ |
| 89756d8b | 26/09 15:42 | (avant modes) | 20 | 13 | 7 | n/d | 0,0150 $ |
| bb9a18ff | 26/09 15:44 | (avant modes) | 20 | 13 | 7 | n/d | 0,0150 $ |
| bb239f17 | 27/09 08:49 | Tous (Novelty, avant correctif) | 20 | 13 | 7 | 0 / 10 / 3 | 0,0150 $ |
| 1e0462dc | 27/09 09:28 | Rechercher de nouveaux acteurs (avant correctif) | 20 | 1 | 19 | 1 / 0 / 0 | 0,0100 $ |
| **d891fa07** | 27/09 09:55 | **Rechercher de nouveaux acteurs (après correctif)** | 20 | 11 | 9 | **0 / 8 / 3** | **0,0100 $** |

Métriques stockées de bb239f17 (2 new · 15 seen · 3 added) et de 1e0462dc (20 new) comptaient les pages
écartées : elles restent telles quelles en base (pas de backfill). Les colonnes « Novelty exploitables »
ci-dessus sont recalculées en lecture seule depuis les instantanés.

### Discovery — run de référence A (Tous) : bb239f17 · run de référence B (Search-Until-New) : d891fa07

| Métrique | A — bb239f17 | B — d891fa07 |
|---|---|---|
| provider_results_total | n/d | 38 |
| unique_candidates_total | n/d | 37 |
| eligible_candidates_total | 13 (recalcul) | 11 |
| rejected_results | 7 (recalcul) | 9 |

### Novelty (exploitables uniquement)

| | new | seen | added | ignored |
|---|---|---|---|---|
| A — bb239f17 | 0 | 10 | 3 | 0 |
| B — d891fa07 | 0 | 8 | 3 | 0 |

### Search-Until-New (d891fa07)

| passes | provider calls | résultats par passe | nouveaux exploitables par passe | stop reason | cost |
|---|---|---|---|---|---|
| 2 | 2 | 20, 18 | 0, 0 | `NO_NEW_RESULTS` | 0,0100 $ |

La 2ᵉ passe n'a apporté aucun nouvel exploitable : la 3ᵉ requête n'a pas été envoyée (0,005 $ non
dépensé). Aucun nouveau prospect trouvé sur ce marché avec ces paramètres, à cette date.

### Qualification (3 acteurs distincts ; 5 fiches, dont 2 doublons)

| Prospect | Analyses | Critères avec signal (sur 5, dernière analyse) | Preuves à confirmer | Vérifiées | Coordonnées observées |
|---|---|---|---|---|---|
| Studio Pilates Avignon (×2 fiches) | 3 ANALYZED (2 à 3 pages) | 4 — Lieu (adresse), Cours (« Prenez votre premier cours », « Cours privé Reformer et Cadillac »), Planning (« Tarifs & planning »), Canal (2 e-mails) | 15 | 0 | 2 e-mails (dont 1 sur un autre domaine) |
| Mouvement Yoga Pilates | 2 ANALYZED (1 à 2 pages) | 4 — Lieu (adresse Le Pontet), Cours (« Conseil Premier Cours »), Planning, Canal (téléphone) | 8 | 0 | téléphone |
| RoxNation (×2 fiches) | 2 ANALYSIS_FAILED | 0 | 0 | 0 | — |

- Prospects analysables : 3 acteurs (5 fiches), tous avec site résolu.
- Analyses réussies : 5 (sur 7). Analyses échouées : 2 (RoxNation, 2 fois).
- Critères avec signaux : 8 sur 15 cases (3 acteurs × 5). « Activité correspondant explicitement à une
  discipline cible » : `UNKNOWN` pour les deux studios de Pilates.
- Preuves à confirmer : 23 (`INFERRED_UNCONFIRMED`). Vérifiées : 0.
- Faux mappings observés : 1 — Studio Pilates Avignon (analyse du 26/09) : « physique » dans « forme
  physique et mentale » proposé pour « Lieu physique ou activité exploitable localement ». Non reproduit
  dans l'analyse du 27/09.
- Signal manqué observé : la discipline (Pilates, Yoga) n'est jamais proposée pour le critère 1.
- Coordonnées exploitables : 2/3 acteurs (e-mail ou téléphone).

### Actionability (3 acteurs ajoutés)

| Indicateur | Valeur |
|---|---|
| Activité pertinente | 2/3 (RoxNation = page « Clubs Hyrox par région », pas un lieu local) |
| Localisation exploitable (adresse observée) | 2/3 |
| Moyen de contact | 2/3 |
| Au moins un signal métier utile (proposé) | 2/3 |
| Actionnables avec au moins 1 preuve **vérifiée** | 0/3 |
| Réunissent activité + contact + ≥ 1 signal proposé | 2/3 |

### Observed strengths

- d891fa07 : la mémoire du projet reconnaît les 3 acteurs ajoutés (`ADDED`) et 8 acteurs vus
  (`SEEN`) ; 0 faux « nouveau » ; arrêt `NO_NEW_RESULTS` après 2 requêtes au lieu de 3.
- Coût par run mesuré : 0,0150 $ (3 requêtes) en mode Tous, 0,0100 $ (2 requêtes) pour d891fa07.
- Studios de Pilates : 4 critères sur 5 avec un signal proposé, chacun avec extrait et URL.

### Observed failures

- 2 doublons de prospects (Studio Pilates Avignon, RoxNation), créés le 27/09 entre 02:40 et 02:45 UTC,
  avant l'existence de la garde `ALREADY_ADDED` (0e06620 à 04:01, durcie en 31e349c). Non supprimés
  (hors périmètre).
- RoxNation : ajouté alors que la source est une page d'annuaire national ; analyse échouée 2/2.
- Faux positif gardé comme exploitable dans d891fa07 : Hyresult (site d'analyse de résultats Hyrox,
  localisation `UNKNOWN`).
- Nom incohérent : « Gym Avignon » pour une source titrée « Pilates Avignon association Asca ».
- Critère 1 (discipline) jamais proposé pour des studios dont le nom contient la discipline.
- 9 résultats écartés sur 20 dans d891fa07 (45 %).

### Open questions for Kevin

1. Parmi Studio Pilates Avignon, Mouvement Yoga Pilates, Studio du Nid, Studio Harmonie, M' Feel Good,
   The Gymnase, Coachingzone, Club Hyrox COACH 4U : lesquels connaissiez-vous déjà ?
2. Un cours à domicile (M' Feel Good) compte-t-il comme « lieu physique » ?
3. Sorgues (The Gymnase, Coachingzone) est-il dans votre zone ?
4. Le critère « Planning » est-il satisfait par une simple rubrique « Tarifs & planning » ?

---

## Known / new to Kevin

| Statut | Acteurs |
|---|---|
| KNOWN_BY_KEVIN_CONFIRMED | 0 |
| NEW_TO_KEVIN_CONFIRMED | 0 |
| UNKNOWN_UNTIL_KEVIN_REVIEW | Padel : 6 (Chez PaPé Padel, Le Hangar Sport & Co, Paul & Louis Sport, Padel Zone Avignon, Urban Padel, EFive). Sport : 11 (Studio Pilates Avignon, Mouvement Yoga Pilates, RoxNation, Studio du Nid, Studio Harmonie, M' Feel Good, The Gymnase, Coachingzone, Gym Avignon / ASCA, Club Hyrox COACH 4U, Hyresult) |

---

## BETA END-TO-END — FRICTION LOG

Parcours fait comme un utilisateur externe, dans le navigateur (Chromium), à 390×844 (iPhone 13) et
1440×900 : démo publique (projet → offre → ICP → Discovery → résultats → ajouter → analyser → synthèse
→ preuves → retour à Discovery → filtres → rejouer → historique), puis espace connecté simulé (réponses
d'API simulées, aucune donnée réelle) pour la connexion, la confirmation d'une preuve et
Search-Until-New. Aucun raccourci développeur dans le parcours (clics et saisies uniquement).

| # | Écran | Action | Problème | Gravité | Traitement |
|---|---|---|---|---|---|
| F-01 | Discovery → résultats | Ajouter un résultat, revenir, filtrer « Nouveaux » / « Ajoutés » | Le résultat ajouté restait compté dans « Nouveaux » et « Ajoutés » affichait 0 (compteur trompeur) | IMPORTANT | **Corrigé** : onglets et compteurs suivent la décision prise dans le run (ajouté → Ajoutés, ignoré → Ignorés) ; instantané et métriques inchangés. Vérifié : « Nouveaux 2 · Ajoutés 1 » |
| F-02 | Discovery → formulaire | Coller la requête Padel du benchmark (260 caractères) | Le champ coupe à 250 caractères sans le dire | IMPORTANT | Documenté (changer la limite = contrat d'entrée du moteur) |
| F-03 | Discovery → mode de recherche | Choisir entre « Nouveaux en priorité » et « Rechercher de nouveaux acteurs » | La différence n'est expliquée que pour le second (aide visible seulement une fois choisi) | IMPORTANT | Documenté |
| F-04 | Démo → Discovery → fiche TEST | « Analyser le site » sur un exemple TEST avec l'ICP générique | 0 signal proposé, donc aucune preuve à confirmer : l'étape « confirmer une preuve » est impossible sur le chemin que l'aide de la démo recommande | IMPORTANT | Documenté (la confirmation fonctionne sur les 5 fiches Foodatoi et dans l'espace connecté) |
| F-05 | Fiche prospect | Lire l'aide « score 0 » après une analyse | L'aide ne citait que le bouton « J’ai vérifié la source : valider » ; les preuves issues de l'analyse ont un bouton « Confirmer » | MINEUR | **Corrigé** : l'aide cite les deux boutons |
| F-06 | Discovery → résultats | « Afficher 6 de plus (N) » | Le libellé annonçait toujours 6 (le bureau affiche par 20, et il peut en rester moins de 6) | MINEUR | **Corrigé** : « Afficher plus de résultats (N) » |
| F-07 | Fiche prospect | Chercher comment revenir | Seul le bouton navigateur permettait de revenir hors Discovery ; le filtre Novelty était perdu au retour | IMPORTANT | **Corrigé** (Phase 1) |
| F-08 | Démo → mode de recherche | Ouvrir la liste des modes | « Rechercher de nouveaux acteurs » est grisé sans explication | MINEUR | Documenté |
| F-09 | Historique | Comparer la ligne d'historique aux onglets | Historique « 0 nouveau · 3 déjà vus » ; onglets « Déjà vus 2 · Ajoutés 1 » (l'historique regroupe vus + ajoutés + ignorés) | MINEUR | Documenté |
| F-10 | Prospects (390) | Toucher une ligne de la liste | La fiche s'ouvre sous la liste (haut de fiche à 465 px sur 844 avec 2 prospects ; hors écran avec une liste longue) | MINEUR | Documenté |
| F-11 | Démo (390) | « Trouver des prospects » | Le formulaire est sous l'aide de la démo : aucun changement visible sans défiler | MINEUR | Documenté |
| F-12 | Résultats (390) | Onglets Novelty | « Ajoutés » et « Ignorés » ne sont visibles qu'en faisant défiler la rangée d'onglets | MINEUR | Documenté |
| F-13 | Résultats | Bouton « Ajouter au projet puis analyser » | L'analyse n'est pas lancée par ce bouton : il faut ensuite « Analyser le site » | MINEUR | Documenté |
| F-14 | Menu | Libellés | Le menu dit « Vue d’ensemble », le retour de repli aussi (« ← Retour à la vue d’ensemble ») ; le terme « Dashboard » n'apparaît nulle part dans l'interface | — | Choix de cohérence |

Bloquants : 0. Importants : 5 (F-01, F-07 corrigés ; F-02, F-03, F-04 documentés). Mineurs : 8
(F-05, F-06 corrigés ; 6 documentés).

## Navigation interne (Phase 1)

| Provenance de la fiche | Bouton | Effet |
|---|---|---|
| Discovery (« Voir le prospect », candidat ajouté) | ← Retour à Discovery | même projet, même run, même filtre Novelty, même nombre de résultats affichés, même défilement ; `history.back()` seulement au-dessus de l'entrée Discovery |
| Liste Prospects (ligne, ajout manuel) | ← Retour aux prospects | liste ramenée à l'écran, ligne ouverte focalisée ; aucune entrée d'historique |
| Inconnue (ouverture à l'arrivée, menu, vue d'ensemble) | ← Retour à la vue d’ensemble | écran « Vue d’ensemble » |

Le bouton retour du navigateur reste pris en charge (inchangé). Vérifié dans Chromium à 390 et 1440 :
ancien run → fiche → retour (même run), filtre « Ajoutés » conservé, 12 résultats affichés conservés
(390), défilement restauré à ± 60 px, aucune requête de recherche au retour, retour navigateur conservé.

## Responsive

Débordement horizontal mesuré sur chaque écran du parcours (accueil, démo, projet, ICP, Discovery,
résultats, fiche, analyse, synthèse, historique, vue d'ensemble, prospects) : 0 px à 390 et 1440.
Suites navigateur relancées : navigation 28/28, parcours détaillé 27/27, clavier 16/16, Novelty 34/34,
Search-Until-New 20/20.
