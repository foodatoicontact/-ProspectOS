# Signal Engine V1 / Intent Engine — audit et plan

Statut : **proposition, rien n'est codé**. Base : `main` à 65003f8 (6 octobre 2026).
Les affirmations sur Lidmeo ont été vérifiées le 6 octobre 2026 par recherche web (voir §2 pour le niveau de preuve) ; ce qui n'est pas public est marqué **UNKNOWN**.

---

## 1. CURRENT_ARCHITECTURE

| Couche | Ce qui existe (vérifié dans le repo) |
|---|---|
| Application | Next.js 16 (App Router), une route API unique `app/api/v1/[...path]/route.ts` (runtime nodejs, `maxDuration=60`), ressources : organizations, projects, icps, prospects, evidence, channels, outreach, events, export, analyze-company, discovery, billing, account (+ équipe), admin, provider-credentials. Route publique `api/public/trial-availability`. |
| Auth / tenant | Supabase Auth (JWT Bearer), RLS `is_member(organization_id)` sur toutes les tables métier, écritures sensibles via RPC `SECURITY DEFINER` `search_path=''`. Équipe Pro (022) : 5 comptes, pot commun de quotas. |
| Données métier | `prospects` (statuts pipeline : À analyser, Qualifié, À contacter, Contacté, Réponse, Intéressé, Gagné, Perdu, Ignoré), `evidence` (VERIFIED impossible sans `verified_by` + `source_url` + `excerpt`), `prospect_observations` (OBSERVED / UNKNOWN / INFERRED / CONTRADICTED, `source_type`, `content_hash`, `expires_at` 90 j, dédup unique), `channels`, `outreach` (DRAFT → APPROVED → USED / DISCARDED, `evidence_ids`), `events` (append-only, triggers sur prospects / evidence / outreach). |
| Discovery | Interface `DiscoveryProvider` (`searchCompanies`, `searchVariant`, `normalizeResult`, `lastSearch: ProviderSearchReport`). Providers : fixture, brave, registry (API Recherche d'entreprises, NAF, tranches d'effectif, 429/retry, budget 30 s), reused (réutilisation équipe). Pipeline : admissibilité, classification de source, résolution d'entité, dédup, nouveauté, sources secondaires, priorité de revue. **Tout est synchrone dans la requête HTTP**, sous budget de temps. |
| Analyse site | `safeFetch` (robots.txt respecté, politique d'hôte, taille / timeout / redirections bornés), autorisation serveur + audit (`website_analysis_audit`), max 3 pages, observations déterministes (stratégies generic / restaurant). |
| Scoring | `scoreProspect` (src/domain/core.ts) : **pur, déterministe**, critères ICP pondérés à 100, seules les preuves VERIFIED de moins de 90 jours comptent, état TRUE / FALSE / UNKNOWN / CONFLICT par critère, `coverage`. |
| Messages | `generateOutreach` : gabarit factuel qui cite mot pour mot l'extrait vérifié du critère le plus lourd. Aucun envoi. |
| IA | `analyzeOffer` (Anthropic / OpenAI, BYOK possible), prompt d'extraction stricte « jamais VERIFIED, extrait exact obligatoire ». Pas d'IA dans le score. |
| Quotas / coûts | `enforce_plan_limit` (TRIAL / BETA=Solo / PRO / ENTERPRISE), limites horaires anti-abus, `api_usage_events` immuable, `provider_pricing` (Brave : 0,005 USD / requête). |
| Exports | CSV prospects, export ZIP complet du compte. **Pas d'export PDF dans le code** (contrairement au brief). |
| Orchestration | **Aucun cron, aucune file, aucun worker.** CI GitHub Actions. |
| Garde-fous | `NO_UNAUTHORIZED_LINKEDIN_AUTOMATION = true` (core.ts). |

Constats utiles pour le Signal Engine :

1. **Le FIT mélange déjà un peu d'intention.** `DEFAULT_CRITERIA` contient `commercial_signal` (25 points sur 100). Ajouter un INTENT sans traiter ce critère compterait deux fois le même fait.
2. **Discovery jette déjà des signaux.** `source-classification.ts` reconnaît `job_board` et `editorial` (classe `SIGNAL_SOURCE`) et les exclut des candidats. Ces résultats, déjà payés, peuvent alimenter les signaux d'un prospect existant sans aucune requête supplémentaire.
3. **Le journal `events` enregistre déjà chaque changement de statut** : la boucle de feedback a ses données brutes.
4. **Toutes les règles critiques sont côté serveur** (fonctions pures + RPC) : une app mobile peut consommer la même API sans dupliquer de logique.
5. Point de vigilance hors sujet : `.github/workflows/import-prospectos.yml` contient des charges utiles encodées capables de pousser sur `main`. À retirer (risque de chaîne d'approvisionnement).

## 2. LIDMEO_PUBLIC_ARCHITECTURE

Vérification du 6 octobre 2026. Le réseau de cet environnement bloque lidmeo.com, theorg.com et trustpilot.com : aucune page n'a pu être lue directement. Les éléments ci-dessous viennent des **résumés de résultats de recherche** pointant vers ces pages. Niveau de preuve : **indirect**. À relire sur les pages elles-mêmes avant toute communication publique.

| Brique | Statut | Ce que disent les résultats | Source citée |
|---|---|---|---|
| Positionnement | CONFIRMÉ | « Lidmeo Signal — Prospection LinkedIn par signaux d'intention » ; de la détection au rendez-vous en 5 étapes | lidmeo.com |
| Signaux | CONFIRMÉ | Likes et commentaires sur les publications du secteur ; surveillance des pages LinkedIn du secteur ; fenêtre d'ouverture annoncée de 5 à 10 jours ; le CTO ajoute les abonnements (« suivent »), lus « tous les jours » | lidmeo.com ; post de Dorian Lasne |
| Suivi de sujets / comptes | DÉCLARÉ par le CTO | « En lisant ce que tes prospects likent, commentent et suivent, tous les jours » | Post LinkedIn de Dorian Lasne, 6 oct. 2026 (capture fournie par Kevin) |
| Qualification | CONFIRMÉ | « L'IA croise chaque signal avec votre ICP : poste, taille, secteur, zone » ; mécanisme non décrit | lidmeo.com |
| Déduction de l'offre et de l'ICP depuis le site | DÉCLARÉ par le CTO | « Tu donnes l'URL de ton site. L'IA comprend ton offre, ta cible, et te sort les profils qui montrent un vrai intérêt pour ton marché. » Les pages du site décrivent aussi un onboarding de 30 minutes où l'utilisateur définit ses clients idéaux : les deux coexistent sans doute | Post de Dorian Lasne ; lidmeo.com/prospection-linkedin-automatique |
| Autres canaux | CONFIRMÉ | LinkedIn **et Google Maps** (absent du brief) | lidmeo.com, theorg.com |
| Messages / envoi | CONFIRMÉ | Messages personnalisés envoyés en votre nom ; offre Pro « 100 % automatique, aucune validation quotidienne » (l'offre Essential implique donc une validation quotidienne) ; réponses dans la messagerie LinkedIn | lidmeo.com |
| Enrichissement | CONFIRMÉ | E-mail professionnel et téléphone direct ; 50 à 100 crédits d'enrichissement par mois selon l'offre | lidmeo.com |
| Modèle d'IA | DÉCLARÉ par le CTO | « Claude Opus 5.5 vient de remplacer Sales Navigator. […] On l'a branché sur LinkedIn » (formule marketing ; le mode de connexion n'est pas décrit) | Post de Dorian Lasne |
| Stack : Unipile (envoi LinkedIn), Claude via MCP (personnalisation), orchestration 24/7, Supabase (stockage des interactions) | RAPPORTÉ, source primaire non identifiée | Un seul résumé de recherche l'affirme, sans désigner la page ; une recherche ciblée sur ces quatre mots n'a rien trouvé. Claude est désormais déclaré par le CTO ; Unipile, MCP, l'orchestration et Supabase restent non vérifiés | indéterminé |
| CRM intégré (contacté, répondu, RDV, gagné, perdu) | NON CONFIRMÉ | Seuls un « tableau de bord en temps réel » et le suivi des réponses sont mentionnés | — |
| Fondateurs | CONFIRMÉ (partiel) | Antoine Ageon et Lilian (nom non trouvé) d'après les résultats de recherche ; **Dorian Lasne, « Co-fondateur & CTO de Lidmeo »** (titre de son profil) | Profils LinkedIn, post du 6 oct. 2026 |
| Tarifs | CONFIRMÉ | Essential 59 € HT/mois, Pro 99 € HT/mois, Team à partir de 179 € HT/mois (2 comptes LinkedIn, puis 60 € par compte) ; jusqu'à 15 prospects par jour ; essai de 7 jours, sans engagement | lidmeo.com |
| Essai | DÉCLARÉ par le CTO | Test gratuit : « l'analyse de ton site et de ta cible », « tes premiers prospects qualifiés », « les signaux d'intention détectés » | Post de Dorian Lasne |
| Résultats annoncés | DÉCLARATIF | Taux de réponse « environ 3 fois » supérieur (avis d'utilisateurs) ; premiers rendez-vous en 2 à 3 semaines | lidmeo.com, trustpilot |
| RGPD / conditions LinkedIn | NON TROUVÉ | Aucun résultat | — |

Unité d'analyse : la **personne** (profil LinkedIn qui interagit).

Comparaison utile : leur Pro est au même prix que ProspectOS Pro (99 € HT), mais pour **1** compte LinkedIn, alors que ProspectOS Pro couvre jusqu'à 5 comptes.

## 3. UNKNOWN_LIDMEO_COMPONENTS

Framework frontend : UNKNOWN. Framework backend : UNKNOWN. Workers / files / planificateur : UNKNOWN (une « orchestration 24/7 » est seulement rapportée). Hébergement / cloud : UNKNOWN. Modèle de scoring : UNKNOWN (« l'IA croise avec l'ICP », sans détail). Fournisseur d'enrichissement : UNKNOWN. Fréquence de surveillance : UNKNOWN. RGPD (base légale, information des personnes, rétention) : UNKNOWN. Conformité aux conditions LinkedIn : UNKNOWN. Multi-tenant / isolation : UNKNOWN. Existence d'un CRM intégré : NON CONFIRMÉ. Usage de Claude (Opus 5.5) : déclaré par le CTO. Usage d'Unipile, de MCP et de Supabase : rapporté, non vérifié sur une source primaire. Manière dont l'activité LinkedIn (likes, commentaires, abonnements) est lue tous les jours : UNKNOWN.

## 4. GAP_ANALYSIS

| Axe | Lidmeo (brief) | ProspectOS actuel | ProspectOS cible |
|---|---|---|---|
| Source de prospects | Activité LinkedIn + Google Maps | Registre officiel + web + site officiel | Inchangé, + signaux multi-sources |
| Unité d'analyse | Personne | Entreprise | Entreprise d'abord, rôles ensuite, personnes en V2 encadré |
| Signaux | Engagement LinkedIn | Aucun objet signal (critère `commercial_signal` dans le FIT) | Objet `signal` daté, sourcé, revu |
| Scoring | UNKNOWN | FIT déterministe sur preuves vérifiées | FIT inchangé + INTENT déterministe séparé |
| Preuve | UNKNOWN | URL + extrait + date + vérification humaine | Idem pour FIT ; signaux traçables, jamais convertis en preuve automatiquement |
| Explicabilité | UNKNOWN | Par critère | Par critère (FIT) et par signal (INTENT, « pourquoi maintenant ») |
| LinkedIn | Central (Unipile) | Aucune automatisation | URL fournie à la main ; connecteur autorisé plus tard, jamais central |
| Messages | Générés + envoyés | Gabarit factuel, pas d'envoi | + phrase « pourquoi maintenant » citant les signaux |
| Automatisation | Workflow continu | Aucune | Surveillance bornée (quotas, fréquence), pas d'envoi |
| CRM | Tableau de bord + suivi des réponses (CRM intégré non confirmé) | Pipeline 9 statuts | + statut RDV, instantané FIT / INTENT au contact |
| Feedback | UNKNOWN | Journal d'événements brut | Analytics explicables (taux de réponse par FIT, INTENT, type de signal) |
| Multi-source | Non (LinkedIn) | Oui | Oui, renforcé (site, presse, emploi, BODACC, marchés publics) |
| Registre officiel | UNKNOWN | Oui | Oui + annonces légales (BODACC) comme signaux datés |
| Site officiel | Pour l'onboarding | Oui (analyse bornée) | + pages actualités / carrières |
| Conformité | UNKNOWN | Robots, audit, RLS, revue humaine | Idem + gouvernance par source |
| Dépendance fournisseur | Forte (LinkedIn via Unipile) | Brave, API publique | Faible : chaque provider est remplaçable |
| Avantage défendable | Ciblage personne en temps réel | Preuves vérifiées | Preuve + temporalité + registre + feedback par utilisateur |

**A. À copier conceptuellement :** l'entrée par une simple URL de site, qui donne offre, cible et premiers résultats dans l'essai (ProspectOS propose déjà l'ICP depuis la **description** de l'offre ; partir de l'**URL** serait une amélioration d'onboarding peu coûteuse, avec `safeFetch` et l'analyse d'offre existants) ; l'idée de signal d'intention ; le score de priorité « maintenant » ; la boucle CRM → apprentissage ; un flux continu de nouveautés.

**B. À éviter :** dépendre de LinkedIn ; automatiser les invitations et messages ; scorer des personnes sur de l'engagement social, qui est un signal faible, volatil et sensible au RGPD ; un score sans détail.

**C. Où ProspectOS peut être meilleur :** l'entreprise réelle vérifiée au registre (SIREN), des signaux **officiels datés** (BODACC, marchés publics), chaque point d'INTENT justifié par une source, la séparation FIT / INTENT, la revue humaine, un coût marginal faible et aucun risque de compte LinkedIn banni.

## 5. TARGET_ARCHITECTURE

```
Registry / Web (Discovery, inchangé)
   → prospect accepté (entreprise réelle)
       ├─ FIT  : scoreProspect(critères ICP, preuves VERIFIED)          [inchangé]
       └─ INTENT : Signal Engine
            signal_run (manuel ou surveillance)
              → SignalProvider[] (web ciblé, site officiel, BODACC, Discovery recyclé, URL manuelle)
              → normalisation (Zod) → résolution d'entité → dédup (hash + clé d'événement)
              → save_signals (RPC)  → statut PENDING_REVIEW
              → revue humaine (VERIFIED / REJECTED)
              → scoreIntent(signaux VERIFIED, profil d'intention, maintenant)   [pur]
              → « pourquoi maintenant » (gabarit, IA optionnelle sur signaux vérifiés)
       → message (gabarit factuel : preuve FIT + signal INTENT cités)
       → revue humaine → pipeline (+ instantané FIT / INTENT / signaux au contact)
       → analytics de feedback (explicables)
```

Principes : même forme que Discovery (provider + rapport + RPC + quotas) ; un seul moteur par dimension, chacun pur et testé ; aucun état métier calculé uniquement dans le navigateur.

## 6. SIGNAL_DATA_MODEL

### Table `public.signals`

| Colonne | Type / règle | Pourquoi |
|---|---|---|
| id | uuid pk | |
| organization_id, project_id, prospect_id | not null, FK composites `(prospect_id, organization_id)` comme `evidence` | Multi-tenant, signal toujours rattaché à une entreprise |
| signal_run_id | uuid null | Traçabilité du lancement (null si saisi à la main) |
| provider | enum `web_search`, `official_site`, `bodacc`, `discovery_recycled`, `user_provided` | Provenance |
| signal_type | enum fermé (voir §9) | Pas de type libre inventé |
| title | ≤ 300 | |
| excerpt | **not null**, ≤ 500, extrait exact de la source | Même règle que les observations ; plus fort que `summary`, qui serait une paraphrase |
| source_url | not null, http(s), canonicalisée | Obligatoire |
| source_domain | dérivé de l'URL (colonne générée) | Filtrage et analytics par source |
| source_type | enum `official_website`, `news`, `job_board`, `legal_announcement`, `public_procurement`, `user_provided` | Fixe la confiance (§8) |
| event_date | date null | Date de l'événement **lue dans la source** ; null si absente |
| published_at | timestamptz null | Date de publication de la page, si lisible |
| observed_at | timestamptz not null | Date de lecture par ProspectOS |
| date_basis | enum `event`, `published`, `observed_only` | Explique quelle date pilote la décroissance |
| confidence | numeric 0–1, **calculée par règle** (source_type × date_basis) | Jamais un nombre produit par un LLM |
| matched_terms | text[] | Mots du profil d'intention trouvés dans l'extrait (explique la pertinence) |
| status | `PENDING_REVIEW`, `VERIFIED`, `REJECTED` | Voir ci-dessous |
| reviewed_by, reviewed_at, rejection_reason | | Revue humaine tracée |
| content_hash | sha256 de l'extrait normalisé | Dédup exacte |
| event_key | `type:prospect:date:hash court du titre normalisé` | Dédup du même événement vu sur plusieurs sources |
| raw_metadata | jsonb ≤ 8 Ko (codes, rang, pas de page complète) | Diagnostic sans stocker le contenu |
| purge_after | timestamptz | Rétention (§12) |
| created_at | | |

Contraintes : unique `(prospect_id, source_url, content_hash)`. Index `(organization_id, project_id, status, observed_at desc)` et `(prospect_id, status)`. Trigger de garde : seules les colonnes de revue sont modifiables après insertion. Trigger d'événement : `signals.insert`, `signals.update`.

**Statuts, avec ce que je remets en cause dans le brief :**
- `DETECTED` et `REVIEW_REQUIRED` désignent le même état côté utilisateur : je propose de les fusionner en `PENDING_REVIEW`.
- `EXPIRED` ne doit **pas** être un statut stocké. Il dépend de l'heure ; le stocker exigerait un job qui réécrit des lignes, donc des jobs fantômes et des états faux entre deux passages. L'expiration est calculée à la lecture par la fonction de décroissance (signal « archivé / contexte »).
- `relevance` ne doit pas être stockée : elle dépend du profil d'intention, que l'utilisateur peut modifier. Elle est recalculée à la lecture, et `matched_terms` en garde la trace.

### Table `public.signal_runs`

id, organization_id, project_id, trigger (`manual` | `monitor`), prospect_ids uuid[] (≤ 10), status (`queued`, `running`, `completed`, `partial`, `failed`), idempotency_key unique, lease_until, attempts (≤ 3), metrics jsonb (requêtes envoyées, répondues, échouées, signaux trouvés, doublons, coût), started_at, completed_at, error_code. Même philosophie que `discovery_runs`.

### Table `public.intent_profiles` (une par projet)

Choix explicites de l'utilisateur : types de signaux suivis et leur poids (valeurs par défaut proposées), mots-clés de rôles ou de sujets (« RSSI », « cybersécurité », « ERP »…). L'analyse d'offre IA peut **proposer** un profil ; l'utilisateur valide, exactement comme pour l'ICP. Validation Zod partagée, comme `CriterionRulesSchema`.

### Ajouts au pipeline (bloc S8)

- `prospects.status` : ajout de `RDV`.
- Table `contact_snapshots` : prospect_id, outreach_id, fit_score, intent_score, signal_ids, evidence_ids, contacted_at. Écrite quand un message passe à USED ou que le statut passe à Contacté. Elle fige « pourquoi on l'a contacté », que le recalcul ultérieur ne doit pas réécrire.
- `outreach.signal_ids` jsonb, à côté de `evidence_ids`.

### Signal ≠ preuve

Aucun lien automatique. En V1, un signal ne peut **ni créer ni modifier** une ligne `evidence`. Si l'utilisateur veut se servir d'un fait pour un critère ICP, il passe par le chemin existant : observation, puis vérification. En option V2, un bouton « Proposer comme preuve » créerait une **proposition** NOT_VERIFIED, à vérifier séparément.

## 7. SIGNAL_PROVIDER_INTERFACE

```ts
type SignalTarget = {prospect_id:string; name:string; website:string|null; siren:string|null; city:string|null};
type SignalScanInput = {targets:SignalTarget[]; types:SignalType[]; profile:IntentProfile; budget:{maxRequests:number; deadlineMs:number}};
type SignalProviderReport = ProviderSearchReport & {signals_found:number; duplicates:number};
interface SignalProvider {
  id: 'web_search'|'official_site'|'bodacc'|'discovery_recycled'|'user_provided';
  mode: 'live'|'test';
  supports(target:SignalTarget, type:SignalType): boolean;   // ex. bodacc exige un SIREN
  searchSignals(input:SignalScanInput): Promise<RawSignal[]>;
  normalizeSignal(raw:RawSignal, target:SignalTarget, now:Date): SignalCandidate|null;  // null = rejeté, avec un code de raison
  lastReport?: SignalProviderReport;
}
```

`SignalCandidate` est validé par un schéma Zod strict : URL publique, extrait non vide présent dans le texte source, type fermé, dates ISO. La normalisation rejette tout candidat sans URL exploitable : un signal non sourcé n'atteint jamais la base.

Providers proposés :

| Provider | V | Requêtes | Ce qu'il produit | Remarque |
|---|---|---|---|---|
| `discovery_recycled` | V1 | 0 | Résultats `job_board` / `editorial` déjà renvoyés par Discovery et rattachés à un prospect existant par la résolution d'entité (domaine, nom canonique) | Gratuit, données déjà payées |
| `web_search` (Brave) | V1 | 1–2 par entreprise | Requêtes ciblées `"<nom>" (recrute OR recrutement)`, `"<nom>" (nomination OR nommé)`, `"<nom>" (levée OR acquisition OR rachat)`, filtre de fraîcheur Brave | Le snippet ne suffit pas comme extrait : confiance plus basse. Conditions de stockage des résultats Brave : **à vérifier** avant la mise en production |
| `official_site` | V1 | 0 (fetch) | Pages actualités / presse / carrières / recrutement trouvées depuis les liens de la page d'accueil, via `safeFetch` et l'autorisation existante, 3 pages max | Source la plus fiable après les sources officielles |
| `bodacc` | V1.5 | 1 par SIREN | Annonces légales datées : modification de dirigeants, création d'établissement, cession, fusion, procédure collective (exclusion) | Données publiques DILA (Licence Ouverte), date officielle, SIREN exact donc pas d'homonymie |
| `user_provided` | V1 | 0 | URL + extrait collés par l'utilisateur (y compris un post LinkedIn) | **Aucun fetch de linkedin.com** ; l'utilisateur colle lui-même le texte ; le statut reste PENDING_REVIEW |
| Marchés publics (BOAMP / DECP) | V2 | 1 | Attributions de marchés publics à l'entreprise | Signal « croissance / capacité » ; à valider selon les ICP réels |
| Connecteur LinkedIn autorisé | Plus tard | — | Import de signaux via une API officielle ou partenaire, avec consentement | Jamais central, jamais de scraping ni d'automatisation de navigateur |

Extraction V1 **déterministe** : lexiques FR/EN par type, analyse de dates (formats français, « il y a 3 jours », `<time datetime>`, JSON-LD `datePublished` / `JobPosting.datePosted`). Une page de type `JobPosting` en JSON-LD donne directement le titre du poste et la date. Pas d'IA dans la détection en V1.

## 8. INTENT_SCORING_MODEL

Fonction pure `scoreIntent(signals, profile, now)` dans `src/domain/intent.ts`, au même niveau que `scoreProspect`.

```
Pour chaque signal VERIFIED :
  points = poids_type × confiance × récence(âge, type) × pertinence
  confiance  = fixée par la source, jamais par un LLM :
               source officielle (BODACC, site officiel, avec date d'événement) 1,0
               article de presse lu (page)                                      0,8
               offre d'emploi (job board)                                       0,8
               snippet de recherche seul                                        0,6
               saisie utilisateur                                               0,7
               × 0,7 si date_basis = observed_only (date de publication inconnue)
  pertinence = 1,0 si le type est suivi ET qu'un mot du profil est dans l'extrait
               0,6 si le type est suivi, sans mot du profil
               0   si le type n'est pas suivi
Par type : rendements décroissants (1 ; 0,5 ; 0,25 ; puis 0) et plafond = poids_type,
           pour que 10 offres d'emploi ne valent pas 10 signaux.
INTENT = min(100, somme arrondie des points)
```

Poids par défaut, modifiables dans le profil : levée de fonds 30, incident cyber 30 (seulement si suivi), nouveau dirigeant ou rôle clé 25, recrutement d'un rôle ciblé 25, acquisition 20, nouvel établissement 20, expansion géographique 20, changement de technologie 20, marché public remporté 20, lancement produit 15, hausse d'effectif 15, partenariat 10, certification 10, événement 5.

- **Seuls les signaux VERIFIED comptent.** Les signaux en attente s'affichent à part : « 3 signaux à revoir (jusqu'à +40) ».
- **Lisible ligne par ligne :** `+25 Recrutement d'un RSSI — publié il y a 4 jours — welcometothejungle.com`, chaque ligne donnant son calcul au survol (25 × 0,8 × 0,92 × 1 = 18).
- **FIT inchangé.** Pour les **nouveaux** projets, l'ICP par défaut ne contient plus `commercial_signal` (redistribution proposée : cible 30, besoin 40, contactabilité 30). Les ICP existants ne bougent pas : on y affiche seulement une note « ce critère recouvre l'INTENT ». C'est une décision produit à valider (§17, S5).
- **Priorité affichée** : FIT et INTENT restent deux nombres. Le tri par défaut se fait par FIT, puis INTENT à FIT égal ; d'autres tris sont au choix. Pas de score combiné opaque.

## 9. TEMPORAL_DECAY_MODEL

`récence(âge) = 0` si `âge < 0` (date future) ou `âge > âge_max` ; sinon `0,5^(âge / demi-vie)`. L'âge se compte depuis `event_date`, sinon `published_at`, sinon `observed_at`.

| Type | Demi-vie | Âge max | Justification |
|---|---|---|---|
| incident_cyber | 5 j | 30 j | Fenêtre d'urgence courte |
| event (salon, conférence) | 7 j | 21 j | Autour de la date |
| hiring_role (offre d'emploi) | 21 j | 90 j | Re-observée tant que l'offre est en ligne (`observed_at` mis à jour) |
| leadership_change | 30 j | 120 j | Un nouveau dirigeant revoit ses fournisseurs pendant plusieurs semaines |
| product_launch, partnership | 30 j | 120 j | |
| new_site, expansion, tech_change | 45 j | 180 j | |
| funding, acquisition | 60 j | 270 j | Plusieurs mois de budget |
| certification, public_contract_won | 60 j | 180 j | |
| headcount_growth | 90 j | 365 j | Tendance lente |

Repères pour l'interface : récence ≥ 0,7 = fort, 0,35–0,7 = moyen, > 0 = faible, 0 = archive / contexte, toujours visible mais sans points. Les changements réglementaires du marché ne sont pas des signaux d'entreprise : ils sont exclus de l'INTENT en V1.

## 10. ORCHESTRATION_MODEL

Recommandation : **une file d'attente dans Postgres, sans nouvelle infrastructure.**

| Option | Verdict |
|---|---|
| Exécution synchrone dans la requête (comme Discovery) | **V1 manuel** : « Chercher des signaux » sur 1 à 5 prospects, sous budget de 50 s |
| `signal_runs` + réservation `FOR UPDATE SKIP LOCKED` + bail (`lease_until`) | **V1 surveillance** : idempotent, reprend après crash, pas de job fantôme (bail expiré = repris ; 3 tentatives max, puis `failed`) |
| Vercel Cron → `/api/cron/signals` (secret `CRON_SECRET`) | **Déclencheur V1** : réserve N exécutions dues, travaille 50 s, laisse le reste au passage suivant. Fréquence permise selon le plan Vercel du compte (**à vérifier**). Une fois par jour suffit vu les demi-vies. Variable à créer par Kevin, pas par moi |
| Supabase pg_cron + pg_net | Alternative si Vercel Cron ne suffit pas, mais le secret d'appel vit alors en base |
| Supabase Edge Functions | Non : il faudrait dupliquer le code TypeScript (Deno) des providers |
| Redis / BullMQ, Kafka, Temporal, worker dédié | Non : aucun besoin au volume visé (centaines de vérifications par jour) |

Étapes d'une exécution : réserver → appeler les providers sous budget → normaliser → résoudre l'entité → dédupliquer → `save_signals` (RPC transactionnelle, idempotente sur `content_hash`) → métriques et coût (`api_usage_events`) → `completed` ou `partial` → événement. L'INTENT n'est pas stocké : il est recalculé à la lecture, ce qui évite les incohérences de cache. Le cron utilise le client service_role : chaque requête est explicitement filtrée par organisation, et les quotas sont débités sur le titulaire du plan (`plan_subject`).

## 11. RLS / SECURITY IMPACT

- `signals`, `signal_runs`, `intent_profiles`, `contact_snapshots` : RLS `is_member(organization_id)` en lecture. Écriture **uniquement par RPC** (`save_signals`, `review_signal`, `start_signal_run`, `save_intent_profile`), avec `require_member` et les quotas dans la même transaction.
- Trigger de garde : source, extrait et dates immuables après insertion. Seule la revue est modifiable, et seulement par un membre.
- Le cron n'accepte que le `CRON_SECRET` (comparaison à temps constant) ; aucun paramètre ne vient de la requête.
- `safeFetch` : `linkedin.com` ajouté à une liste d'hôtes interdits pour tout fetch automatique.
- **Données personnelles :** un extrait peut contenir un nom (nomination). Règles :
  - pas de colonne « personne » en V1 ;
  - extrait limité à 500 caractères ;
  - rétention bornée ;
  - suppression en cascade avec le prospect et le compte ;
  - inclusion dans l'export de compte.

  Le module « décideurs » (§13) exige une revue juridique avant d'être lancé : intérêt légitime, information des personnes (art. 14 RGPD), droit d'opposition.
- Gouvernance par source, documentée dans le code et `docs/` : provider, licence ou base légale, champs conservés, rétention, possibilité de suppression.

## 12. QUOTA / COST MODEL

Nouvelle action de quota : `signal_scan` (1 entreprise analysée = 1 unité), sur le modèle de `analysis`.

| Offre | Scans manuels / mois | Entreprises surveillées | Fréquence de surveillance | Coût Brave estimé / mois* |
|---|---|---|---|---|
| Essai | 10 | 0 | — | ≤ 0,10 $ |
| Solo | 50 | 10 | 1 fois par semaine | ≈ 0,90 $ |
| Pro (pot commun) | 150 | 50 | 1 fois par semaine | ≈ 3,50 $ |
| Entreprise | sur devis | sur devis | jusqu'à 1 fois par jour | sur devis |

\* 2 requêtes Brave par entreprise et par scan à 0,005 $ ; site officiel, BODACC et Discovery recyclé ne coûtent rien en requêtes payantes.

Rétention : PENDING_REVIEW purgé après 60 j, REJECTED après 30 j, VERIFIED conservé tant que le prospect existe (affiché en « contexte » au-delà de l'âge max). Une surveillance sans aucune ouverture de l'application pendant 30 jours se met en pause automatiquement : pas de coût sans utilisateur.

## 13. UI / UX CHANGES

Pas de refonte du tableau de bord, seulement des ajouts :

1. **Fiche prospect** : à côté du FIT, un bloc « INTENT 76/100 — Pourquoi maintenant ? » avec les lignes de points, les sources, l'âge et l'état de décroissance ; signaux à revoir (Vérifier / Rejeter, comme `ObservationsReview`) ; bouton « Chercher des signaux » ; bouton « Ajouter un signal » (URL + extrait collés).
2. **Liste des prospects** : colonne INTENT, tri, pastille « nouveau signal ».
3. **Projet** : écran « Profil d'intention » (types suivis, poids, mots-clés), avec une proposition IA à valider.
4. **Message** : le gabarit factuel cite la preuve FIT **et** le signal le plus fort (« j'ai vu que vous recrutez un RSSI »), extrait mot pour mot.
5. **Pipeline** : statut RDV ; petit tableau « ce qui a produit des réponses », avec la mention « échantillon insuffisant » sous 10 cas.
6. **Décideurs (V2)** : rôles recommandés seulement (table déterministe signal → rôles), aucun nom.

## 14. MOBILE_API_IMPACT

Toute la logique reste dans `src/domain` / `src/discovery`, et les réponses portent déjà le détail calculé :

- `GET /api/v1/signals?project_id&status&since` : flux de nouveaux signaux, paginé.
- `POST /api/v1/signals/:id/review` `{decision:'VERIFIED'|'REJECTED', reason?}`
- `POST /api/v1/signals` : signal saisi à la main.
- `POST /api/v1/prospects/:id/signal-scan`, `POST|DELETE /api/v1/prospects/:id/monitor`
- `GET /api/v1/prospects/:id` : enrichi de `fit` (détail existant), `intent` (score, lignes, en attente) et `why_now`.
- `PATCH /api/v1/prospects/:id` `{status}` : existe déjà.

Auth par JWT Bearer Supabase, utilisable telle quelle depuis Expo. Les schémas Zod des réponses sont exportés et forment le contrat ; l'app ne calcule aucun score. Les futures notifications passent par une table `notification_outbox`, alimentée par les événements `signal.verified` et `intent.crossed_threshold` (V2), consommée par e-mail ou push.

## 15. IMPLEMENTATION_BLOCKS

| Bloc | Contenu | Fichiers | Migration | Tests | Rollback | GO / NO_GO | Dépend de | Jours |
|---|---|---|---|---|---|---|---|---|
| **S1** Schéma signaux + RLS | `signals`, `signal_runs`, `intent_profiles`, RPC `save_signals` / `review_signal` / `save_intent_profile`, gardes, événements, purge | `db/migrations/023_signals.sql`, `src/discovery/signal-types.ts` (Zod) | 023 | PGlite : RLS inter-tenant, garde d'immuabilité, dédup, revue, rejet d'un signal sans URL ou sans extrait ; règle de garde « pas de signal → evidence » | `drop` des 3 tables + fonctions (documenté dans l'en-tête) | GO si tous les tests DB passent et la Preview est appliquée avec empreintes identiques | — | 1,5 |
| **S2** Interface SignalProvider | Interface, `SignalCandidate`, rapport, provider fixture, orchestrateur synchrone sous budget | `src/signals/provider.ts`, `src/signals/service.ts`, `providers/fixture.ts` | — | Budget respecté, rejets codés, rapport exact, aucun appel réseau en fixture | Suppression du dossier | GO si le flux fixture va de bout en bout sans réseau | S1 | 1 |
| **S3** Providers web + site + recyclé | Brave ciblé, pages actualités / carrières via `safeFetch`, recyclage des `SIGNAL_SOURCE` de Discovery, saisie manuelle | `src/signals/providers/{web,site,recycled,manual}.ts`, `services.ts` (hook Discovery) | — | Requêtes simulées, `robots.txt`, linkedin.com interdit, JSON-LD JobPosting, dates FR, homonymes rejetés | Désactivation du provider par configuration | NO_GO si un faux rattachement d'entreprise passe dans les tests d'homonymie | S2 | 2,5 |
| **S4** Normalisation + dédup | Lexiques par type, analyse de dates, `content_hash`, `event_key` multi-sources | `src/signals/normalize.ts`, `dedupe.ts` | — | Corpus FR/EN de 40+ cas, même événement vu sur 3 sources = 1 signal | — | GO si précision ≥ 90 % sur le corpus de test (cas réels anonymisés) | S2 | 1,5 |
| **S5** Scoring INTENT + décroissance | `scoreIntent`, `recency`, poids par défaut, profil, ICP par défaut sans `commercial_signal` pour les nouveaux projets | `src/domain/intent.ts`, `core.ts` (ICP par défaut), route prospects | — | Pur et déterministe : bornes, plafonds par type, rendements décroissants, dates futures, signaux en attente exclus, FIT des ICP existants inchangé au point près | Rétablir l'ICP par défaut (une constante) | **Décision produit requise** : retrait de `commercial_signal` pour les nouveaux projets | S1 | 1,5 |
| **S6** Interface de revue | Bloc INTENT / Pourquoi maintenant, revue, saisie manuelle, profil d'intention, colonne de liste, i18n FR/EN | `src/components/SignalsPanel.tsx`, `IntentProfile.tsx`, `app/page.tsx` (ajouts), `src/i18n/*` | — | Tests de composants, Playwright 390 / 1280 px, mode démo avec signaux de test marqués TEST | Retrait des composants | GO après validation visuelle par Kevin en Preview | S3, S5 | 2,5 |
| **S7** Pourquoi maintenant | Phrase par gabarit déterministe ; réécriture IA optionnelle : JSON `{sentence, signal_ids}` validé (ids existants et vérifiés, aucun nombre ni nom absent des extraits), sinon repli sur le gabarit ; intégration dans `generateOutreach` | `src/domain/why-now.ts`, `src/server/ai.ts` | — | Rejet de toute sortie IA citant un id inconnu ou un fait absent ; gabarit sans IA | Désactiver l'IA (gabarit seul) | NO_GO si une seule phrase de test contient un fait non sourcé | S5 | 1,5 |
| **S8** Feedback pipeline | Statut RDV, `contact_snapshots`, `outreach.signal_ids`, analytics (taux de réponse par tranche de FIT / INTENT, type de signal, source, âge du signal au contact) | `024_pipeline_feedback.sql`, `src/domain/feedback.ts`, route | 024 | Instantané figé, statut RDV, chiffres sur données de test, « échantillon insuffisant » | Retrait du statut (si aucune ligne RDV) | GO si les analytics sont reproductibles à partir des seuls événements | S5 | 2 |
| **S9** Surveillance + cron | `monitored_prospects`, réservation par `SKIP LOCKED` + bail, `/api/cron/signals`, quotas `signal_scan` / surveillance, pause d'inactivité | `025_signal_monitoring.sql`, `app/api/cron/signals/route.ts`, `vercel.json` (crons) | 025 | Concurrence sur Postgres réel (deux crons simultanés = zéro doublon), reprise après bail expiré, quota atteint, secret absent ou faux = 401 | Retirer le cron de `vercel.json` | GO après 7 jours en Preview sans job bloqué ; `CRON_SECRET` créé par Kevin | S3, S4 | 2,5 |
| **S10** BODACC (V1.5) | Provider d'annonces légales par SIREN | `src/signals/providers/bodacc.ts` | — | Réponses enregistrées, mapping des types d'annonce, procédure collective = exclusion et non signal positif | Désactivation | GO après vérification de la licence et des quotas de l'API | S2 | 2 |

## 16. TEST_PLAN

- **Unitaires purs** : `scoreIntent`, `recency`, normalisation, dédup, dates, profil (Zod), gabarit « pourquoi maintenant ».
- **Propriétés** : INTENT toujours dans [0, 100] ; un signal non VERIFIED ne change jamais le score ; l'ordre des signaux ne change pas le score ; un âge supérieur à l'âge max donne 0 point ; le FIT est identique avant et après le bloc pour tous les ICP existants.
- **Base (PGlite, chaîne complète)** : RLS inter-organisation, gardes, dédup, quotas, purge, équipe Pro (pot commun).
- **Concurrence (Postgres réel, `*-realpg.sh`)** : réservation de cron en parallèle, double clic sur « Chercher des signaux ».
- **Providers** : fetch simulé, aucun réseau en CI ; robots.txt ; liste d'hôtes interdits.
- **Garde-fous** (tests qui verrouillent les principes) : aucun import de `signals` dans `evidence` ; pas de LLM dans `intent.ts` ; pas de linkedin.com dans les fetchers.
- **Interface** : Playwright, revue d'un signal, détail des points, mobile 390 px.
- **Canari Preview** : 10 entreprises réelles connues de Kevin, précision des signaux mesurée à la main avant la Production.

## 17. RISKS

| Risque | Mitigation |
|---|---|
| Faux positifs (homonymes, filiales) | Résolution par domaine officiel ou SIREN ; revue humaine obligatoire ; BODACC par SIREN |
| Dates absentes ou fausses | `date_basis`, confiance réduite, dates futures refusées |
| Inflation du score (10 offres d'emploi) | Plafond par type, rendements décroissants |
| Double comptage FIT / INTENT | Retrait de `commercial_signal` des nouveaux ICP, note sur les anciens |
| Conditions Brave (stockage des résultats) | Vérification avant S3 ; ne stocker que l'URL, le titre et un extrait court |
| RGPD (noms dans les extraits, décideurs) | Minimisation, rétention, revue juridique avant le module décideurs |
| Coût de la surveillance | Quotas, pause d'inactivité, providers gratuits en priorité |
| Fréquence de cron selon le plan Vercel | Une fois par jour suffit ; pg_cron en alternative |
| Limite de 60 s par requête | Lots de 5 entreprises maximum, état `partial` |
| Charge de revue pour l'utilisateur | Priorité de revue, filtre par type, revue rapide sur mobile |
| Workflow d'import encodé sur `main` | À supprimer dans un bloc à part |

## 18. WHAT_NOT_TO_BUILD

Scraping ou automatisation de navigateur sur LinkedIn ; envoi automatique d'invitations ou de messages ; score produit par un LLM ; modèle de ML auto-entraîné en V1 ; Redis, Kafka, Temporal ou microservices ; crawler maison à grande échelle ; base de personnes ou enrichissement massif d'e-mails ; veille générale de marché non rattachée à une entreprise ; notifications push temps réel en V1 ; refonte du tableau de bord ; second moteur de FIT ; statut `EXPIRED` stocké.

## 19. ESTIMATED_DEV_DAYS

| Ensemble | Blocs | Jours |
|---|---|---|
| Socle utilisable (signaux manuels + web + score + interface) | S1–S6 | ≈ 10,5 |
| Pourquoi maintenant + feedback | S7–S8 | ≈ 3,5 |
| Surveillance | S9 | ≈ 2,5 |
| BODACC | S10 | ≈ 2 |
| **Total** | | **≈ 18,5 jours**, plus environ 20 % de marge pour la validation en Preview |

Ordre de livraison conseillé : S1 → S2 → S5 (score testable sur des signaux saisis à la main) → S3 → S4 → S6 → S7 → S8 → S10 → S9.

## 20. VALUE_CREATED

- Répondre à « **pourquoi maintenant** » avec des sources, la question que posent les commerciaux et que le FIT seul ne traite pas.
- Des messages plus pertinents : un fait daté et vérifiable dans la première phrase.
- Un avantage défendable face aux outils centrés LinkedIn : registre officiel, annonces légales datées, preuves vérifiées, aucun risque de compte banni ni de dépendance à une plateforme.
- La base d'un apprentissage propre à chaque utilisateur (quels signaux produisent des réponses), d'abord en analytics explicables.
- Une vraie raison de choisir l'offre Pro (surveillance d'entreprises partagée par l'équipe) sans augmenter fortement les coûts.

## Décisions à prendre avant de coder

1. Retirer `commercial_signal` de l'ICP par défaut des **nouveaux** projets (proposé : oui ; les ICP existants restent inchangés).
2. Seuls les signaux VERIFIED comptent dans l'INTENT (proposé : oui).
3. Quotas et prix de la surveillance (§12).
4. Ordre des blocs : socle manuel d'abord (S1, S2, S5), surveillance en dernier.
5. BODACC en V1.5 ou dès le socle.
6. Suppression du workflow d'import encodé (bloc séparé).

## État de livraison

| Bloc | État | Notes |
|---|---|---|
| S1, S2, S5 | En production (PR #24, migration 024) | Score INTENT vérifié + estimé |
| S3 + S4 | Branche `feat/signal-engine-s3` | `src/signals/extract.ts` (lexiques FR/EN, dates, JSON-LD), providers `official_site`, `web_search`, saisie manuelle, routes API |
| S6 | Branche `feat/signal-engine-s3` | Bloc « INTENT — pourquoi maintenant ? » sur la fiche (`SignalsPanel.tsx`) : recherche sur le site, saisie, revue, calcul visible, réglages INTENT du projet ; démo avec signaux TEST. Colonne INTENT de la liste reportée (demande une lecture groupée des signaux) |

Choix faits en S3 (révisables) :

- **Site officiel** : même autorisation, même audit (`website_analysis_audit`) et même unité de plan que « Analyser le site » (`consume_analysis_quota`), unité rendue si la page d'accueil n'a pas pu être lue. Pas de nouvelle migration. Le quota dédié `signal_scan` arrivera avec la surveillance (S9).
- **Recherche web (Brave)** : codée et testée, mais **non branchée** et désactivée par défaut (`SIGNALS_WEB_SEARCH_ENABLED` exactement `true` + clé). Conditions Brave sur le stockage des résultats : **UNKNOWN** (pages inaccessibles depuis l'environnement de développement), à vérifier par l'opérateur avant activation. Seuls l'URL, le titre et l'extrait sont conservés ; la page tierce n'est jamais lue.
- **Homonymes** : un résultat web n'est rattaché que s'il nomme l'entreprise en mots entiers **et** qu'il est sur son domaine, cite son domaine ou nomme sa ville. Le nom seul ne suffit jamais.
- **Saisie manuelle** : URL + extrait exact ; un lien LinkedIn est accepté comme source de l'utilisateur, jamais lu.
- **Corpus S4** : 48 cas FR/EN rédigés avec des entreprises fictives (précision 100 %). La validation sur des cas réels se fera en Preview.
- `discovery_recycled` reporté (bloc S8, avec le hook Discovery).
