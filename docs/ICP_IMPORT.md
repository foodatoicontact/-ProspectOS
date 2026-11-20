# Importer mon entreprise (import ICP)

L'import pré-remplit le **profil de l'entreprise, de son offre et de sa cible** (`IcpProfile`) à partir d'un document que la personne fournit elle-même : texte collé, PDF, DOCX (et, à l'étape 3, l'adresse de son propre site). Le résultat est **toujours un brouillon** : rien n'est utilisé en prospection tant qu'une personne ne l'a pas relu et validé (`DRAFT → VALIDATED` uniquement par action humaine, migration 041).

État : étape 1 (schéma, migration 041), 2A (ingestion, structuration, API) et 2B (écran de revue) livrées. Restent 3 (import d'URL — après le smoke test réel), 4 (table de correspondance complète : APE, tailles, signaux), 5 (ré-import avec diff).

## Règles qui ne bougent pas

- **Le contenu importé est une donnée, jamais une instruction.** Il est envoyé au modèle une seule fois, encodé en JSON, entre deux marqueurs qui portent un nonce aléatoire (`<<<DOCUMENT_…>>>` / `<<<FIN_DOCUMENT_…>>>`), après un prompt système qui le dit. Un faux marqueur dans le document ne ferme rien : il ne connaît pas le nonce.
- **Réponse JSON uniquement, validée par Zod** (`parseIcpProfile`, objets stricts) : toute propriété hors schéma, tout type faux, tout code inconnu (département, tranche d'effectif, NAF, type de signal) fait refuser le profil **en entier**. Jamais de réparation silencieuse du JSON.
- **Zéro invention** : chaque valeur extraite est `{value, source, confidence}` ; `source` est un passage du document (200 caractères au plus), `confidence` entre 0 et 1. Une valeur donnée sans source est vidée (`null`, confiance 0), son chemin est signalé (avertissement `UNSOURCED_VALUES_DROPPED`) et devient une **question manquante**. **La source doit être un passage du document** : chaque source est cherchée dans le texte lu, après une simple normalisation (casse, apostrophes et guillemets, tirets, espaces et retours à la ligne) ; une paraphrase, une citation tronquée (« ... »), des lignes recollées ou une citation inventée vident la valeur exactement comme une source absente (avertissement `UNVERIFIED_SOURCES_DROPPED`, chemin journalisé, question manquante).
- **Aucune action automatique** : l'import n'écrit que la ligne `icp_imports` (brouillon). Le profil (`icps.profile`), l'offre et les critères ne sont écrits que par `validate_icp_import`, appelée par la personne.
- Le moteur de score, ses poids (total 100) et ses tests ne sont pas modifiés. Les signaux `WORKS` et `CONTRACT_RENEWAL` restent dans le brouillon, affichés « non surveillé pour l'instant », jamais notés (avertissement `SIGNAL_NOT_MONITORED`).

## Pipeline (étape 2A)

```
requête ─▶ droit d'accès ─▶ lecture bornée du corps ─▶ ingestion (texte brut)      ← aucun appel base, aucun quota
        ─▶ start_icp_import (1 unité du quota « analyse d'offre », 1 import en cours par projet)
        ─▶ clé BYOK (INVALID = échec fermé, jamais la clé plateforme)
        ─▶ structureIcp (1 nouvel essai au plus si la validation échoue)
        ─▶ complete_icp_import (EXTRACTED ou FAILED, usage réel de chaque appel)  ← rôle service uniquement
        ─▶ métrage de chaque appel facturé (registre des coûts, opération offer_analysis)
```

Un fichier illisible (mauvais format, scan, trop gros, bombe zip) est refusé **avant** toute écriture et ne coûte rien. Si le fournisseur n'a jamais été appelé (IA non configurée, clé BYOK illisible), l'unité de quota est rendue ; dès qu'il a été appelé, elle reste consommée, comme pour l'analyse d'offre.

### API

| Méthode | Chemin | Corps | Réponse |
|---|---|---|---|
| POST | `/api/v1/icp-imports/file?project_id=…` | octets bruts du PDF/DOCX (`application/octet-stream`), nom dans `X-File-Name` (encodé URI, simple libellé) | 201 `{import, profile, unmonitored_signals}` |
| POST | `/api/v1/icp-imports/text` | `{project_id, text}` (≤ 50 000 caractères) | idem |
| GET | `/api/v1/icp-imports?project_id=…` | — | les 20 derniers imports du projet (RLS : membres) |
| GET | `/api/v1/icp-imports/:id` | — | l'import et son brouillon **revalidé à chaque lecture** (`profile_state` : `valid`, `unreadable`, `none`) ; un `PENDING` de plus de 2 minutes est lu `FAILED` (`IMPORT_STALE`, « relancez-le ») |
| DELETE | `/api/v1/icp-imports/:id` | — | efface l'import, quel que soit son statut sauf un import en cours (`ICP_IMPORT_IN_PROGRESS`) |
| POST | `/api/v1/icp-imports/:id/validate` | `{profile, keep_offer, keep_criteria}` (≤ 150 Ko) | le profil relu est revalidé en entier, projeté, puis `validate_icp_import` sous l'identité de la personne |
| POST | `/api/v1/icp-imports/:id/discard` | — | rejette le brouillon (`DISCARDED`), rien n'est écrit dans le projet |
| POST | `/api/v1/icp-imports/:id/retry` | la source à nouveau (octets bruts ou `{text}`) | un nouvel import du **même** projet ; l'ancien brouillon n'est rejeté **qu'une fois le nouvel import `EXTRACTED`** : si la relance est refusée ou échoue, il reste consultable et validable |

Ces routes sont traitées dans `app/api/v1/[...path]/route.ts` **avant** la lecture JSON générique (plafonnée à 20 000 caractères). Toutes passent par la session de la personne connectée : sans session, la route répond 401 avant tout ; les fonctions SQL vérifient l'appartenance à l'organisation (un import d'un autre tenant n'existe pas : 404).

Codes d'erreur : `FILE_TOO_LARGE` (413), `UNSUPPORTED_FILE` (415), `FILE_EMPTY`, `TEXT_TOO_SHORT`, `TEXT_TOO_LONG`, `PDF_SCANNED`, `PDF_ENCRYPTED`, `PDF_UNREADABLE`, `PDF_TIMEOUT`, `DOCX_UNREADABLE`, `DOCX_TOO_LARGE` (422), `ICP_IMPORT_IN_PROGRESS` (409), `ICP_URL_DAILY_LIMIT`, `OFFER_LIMIT_REACHED`, `QUOTA_EXCEEDED` (429), `AI_UNAVAILABLE`, `AI_TRUNCATED_RESULT`, `AI_INVALID_RESULT` (502), `BYOK_CREDENTIAL_INVALID`, `AI_NOT_CONFIGURED` (503). Chaque refus d'ingestion porte une phrase qui dit quoi faire à la place (adresse du site, texte collé).

## Écran de revue (étape 2B)

`src/components/IcpImport.tsx`, en tête de la vue « Cible » (`app/page.tsx`), pour une personne connectée sur un vrai projet. Logique pure et testée dans `src/icp-import/review.ts` (état, éditions, questions), client navigateur dans `src/icp-import/client.ts`, textes FR/EN dans le dictionnaire local `src/icp-import/messages.ts` (pas dans `src/i18n/fr.ts` / `en.ts`).

- **État lu en base** : l'écran affiche le dernier import du projet tel que la base l'a (`GET /icp-imports?project_id`, puis le brouillon revalidé). Pendant un import, il interroge la base toutes les 3 s (jusqu'à 15 s quand le réseau ne répond plus, avec un message « nouvelle tentative ») : un rechargement ou une coupure réseau retrouvent le même import. Un chargement long montre les étapes, le temps écoulé et « cela peut prendre jusqu'à une minute », jamais un écran vide. Un `PENDING` de plus de 2 minutes est affiché en échec avec « Relancer ».
- **Revue** : chaque valeur est modifiable ; un badge dit sa confiance (Sûr ≥ 0,85, À vérifier ≥ 0,6, Peu sûr, Vide) ; « Source » montre au toucher le passage du document ; les champs vides sont surlignés. Une valeur saisie par la personne est sourcée « Saisi par vous » (confiance 1), jamais rattachée à un passage du document. Les modifications non validées sont gardées dans l'onglet (`sessionStorage`, par import) et restaurées après un rechargement ; elles disparaissent à la fermeture de l'onglet et sont effacées à la validation, au rejet, à la suppression, à la déconnexion (menu du compte) et à l'expiration de la session.
- **Questions manquantes** (5 au plus) : une à la fois, « Répondre » ou « Passer » ; la réponse va là où la question pointe (activité, services, types de clients, départements — codes ou noms —, interlocuteurs, exclusions).
- **Signaux** `WORKS` et `CONTRACT_RENEWAL` : badge « Non surveillé pour l'instant » ; aucun signal n'est présenté comme surveillé.
- **Brouillon illisible** (le schéma ne passe plus) : état « Brouillon illisible — à ré-importer », avec Relancer et Supprimer ; une erreur de rendu retombe sur ce même état.
- **Décision** : « Valider ce profil » et « Rejeter » dans une barre en bas de l'écran (à portée de pouce), cases « Garder mon offre actuelle » / « Garder mes critères actuels » juste au-dessus. `VALIDATED` n'est atteint que par ce clic : aucun effet, minuteur ni interrogation ne valide.
- **Relancer** : le document n'étant jamais conservé, l'écran renvoie la source encore en mémoire, sinon demande de la choisir à nouveau. Si la relance échoue, l'écran propose « Revoir le brouillon précédent », resté intact.

### Projection (version 2B)

`src/domain/icp/projection.ts`, déterministe et idempotente, appliquée côté serveur à la validation :
- **offre** (`projects.offer`, 4 000 caractères) : nom et activité, services, engagements, différences, preuves — sauf « Garder mon offre actuelle » ;
- **critère `target_fit`** existant : `categories` = libellés des types de clients, `locations` = villes des sites puis noms des départements — sauf « Garder mes critères actuels ». Une règle modifiée à la main depuis la dernière projection (ou écrite à la main avant toute projection) est gardée telle quelle, critère par critère ;
- **poids jamais modifiés** : mêmes clés, mêmes poids (les critères par défaut si le projet n'en a pas), somme 100 vérifiée avant l'envoi et par `validate_icp_import`. `need_fit` et les signaux attendent la table de correspondance de l'étape 4.

## Limites

| Élément | Limite | Où |
|---|---|---|
| Fichier | **4 Mio (4 194 304 octets)**, corps brut, jamais en base64 ; refus dès qu'un octet dépasse, même si `Content-Length` ment | `MAX_UPLOAD_BYTES`, `readBoundedBody` |
| Plateforme | Vercel refuse les corps de fonction au-delà de 4,5 Mo : la limite de 4 Mio passe dessous | — |
| Type | octets de tête uniquement : `%PDF-` ou `PK\x03\x04` + `word/document.xml` ; jamais l'extension ni le Content-Type | `sniff` |
| Texte collé | 30 à 50 000 caractères | `ingestText` |
| Texte extrait | coupé à 50 000 caractères, avertissement `TEXT_TRUNCATED` | `bounded` |
| PDF | 30 pages lues au plus (avertissement `PDF_PAGES_TRUNCATED`), 15 s, sans polices ni XFA ; moins de 50 caractères visibles = `PDF_SCANNED` (pas d'OCR) | `ingestPdf` |
| DOCX | 1 000 entrées au plus ; `word/document.xml` décompressé compté pendant l'inflation, arrêt à 10 Mio (bombe zip) | `ingestDocx` |
| Modèle | 4 096 tokens de sortie, réflexion désactivée, aucun outil, 40 s par appel ; nouvel essai seulement s'il reste 20 s sur le budget de 55 s de la route | `structureIcp` |
| Sortie | profil le plus rempli possible ≤ 2 920 tokens estimés (plafonds `ICP_LIMITS`, JSON compact) ; voir « Smoke test #3 » | `budget.ts` |
| Imports | 1 import en cours par projet (2 min) ; 10 imports d'URL par organisation et par 24 h | `start_icp_import` |

Une fonction interrompue par la plateforme (60 s) laisse sa ligne `PENDING`. Passé **2 minutes**, elle n'est plus un import en cours : toute lecture la présente `FAILED` (`IMPORT_STALE`) avec un message qui propose de relancer, le prochain import du projet l'enregistre `FAILED` en base, une réponse tardive n'est plus enregistrée, et elle peut être effacée.

## Données, rétention, RGPD

- Les fichiers sont lus en mémoire et **jamais stockés** (pas de bucket). Seuls restent le libellé de la source (nom de fichier réduit, ou « Texte collé »), le brouillon structuré, les questions, les avertissements, l'erreur éventuelle et l'usage réel (`token_usage`, `usage.attempts`).
- Imports `FAILED` et `DISCARDED` : purgés après **30 jours** (à chaque nouvel import, et par `purge_icp_imports()`).
- Export RGPD : `icp_imports.json` dans l'archive du compte.
- **Effacement** (`delete_icp_import`, route `DELETE`) : tout membre de l'organisation efface un import, quel que soit son statut (`VALIDATED` compris), sauf un import en cours (`PENDING` de moins de 2 minutes : son résultat arriverait sur une ligne effacée). Ni un autre tenant, ni un visiteur anonyme, ni le rôle serveur ne le peuvent.
- **Suppression d'un projet** : ses imports partent avec lui, quel que soit leur statut (clé étrangère `on delete cascade` ; le déclencheur l'autorise dès que le projet n'existe plus). L'application n'a pas encore de bouton de suppression de projet : c'est une opération d'administration.
- **Départ d'un membre** (suppression de son compte, départ ou retrait de l'équipe) : les imports **non validés** qu'il a lancés dans l'organisation (`PENDING`, `EXTRACTED`, `FAILED`, `DISCARDED`) sont supprimés. Les imports **`VALIDATED`** sont conservés : ils sont la trace de l'ICP de l'organisation, relu et accepté ; ils sont détachés de la personne, `created_by` et `validated_by` passant à `null` (y compris un import lancé par un autre membre et validé par celle qui part). Rien d'autre n'y change, et rien ne peut les réattribuer (déclencheur). La même mise à `null` s'applique si un compte est supprimé directement en base (clés étrangères `on delete set null`). Les imports des autres membres restent tels quels.
- **Ce qui reste : le profil validé dans `icps`.** Valider un import copie le profil relu dans `icps.profile` (avec `projected_offer`, `projected_criteria`, `profile_validated_by`) et peut réécrire `projects.offer` et les règles des critères. Effacer l'import n'efface pas cela, volontairement : c'est désormais l'ICP de l'organisation, relu et accepté par une personne, utilisé par le score et la recherche comme un ICP saisi à la main ; l'effacer en cascade casserait le ciblage des autres membres. `profile_import_id` pointe alors vers un import qui n'existe plus (ce n'est pas une clé étrangère). Ce profil décrit l'entreprise cliente et son offre, pas une personne ; le seul identifiant personnel est `profile_validated_by`, l'identifiant technique de qui a validé (un compte supprimé est anonymisé : e-mail remplacé, accès coupé ; l'identifiant reste). Il disparaît avec le projet, ou est remplacé par la validation suivante.
- La base ne contrôle que le contour du profil (objet, ≤ 100 Ko, 6 clés racine) ; **chaque lecture repasse par `parseIcpProfile`** et un profil qui ne passe plus est déclaré illisible (« Relancez un import »), jamais utilisé en partie.

## Coût

Chaque import consomme **une** unité du quota « analyse d'offre » (`ai_offer`), nouvel essai compris. Le coût réel est enregistré dans `icp_imports.token_usage` / `usage` et, appel par appel, dans le registre des coûts (`api_usage_events`, opération `offer_analysis`).

Ordre de grandeur, au tarif enregistré pour `claude-sonnet-5` (migration 010 : 2 $ par million de tokens en entrée, 10 $ en sortie) — **estimations**, le smoke test donne le chiffre réel :

- **coût réel mesuré** (smoke tests du 4 novembre, document de 8 400 caractères) : environ **0,05 $ par appel** (≈ 5 400 tokens en entrée, jusqu'à 4 096 en sortie : 0,011 $ + 0,041 $), donc **jusqu'à environ 0,10 $ avec le nouvel essai** ;
- borne haute d'un appel sur un document de 50 000 caractères : ~15 000 tokens d'entrée + 4 096 en sortie ≈ 0,03 $ + 0,041 $ ≈ 0,07 $, soit ~0,14 $ avec le nouvel essai.

## Smoke test réel (opérateur)

Un appel réel à `structureIcp`, sans rien écrire dans `icp_imports`, dans un profil ni dans le registre des coûts. Même liste opérateur que les autres exécutions (`SELF_OUTREACH_ORG_IDS`, docs/SELF_OUTREACH.md §8) : l'organisation passée doit y figurer. La clé de la plateforme paie (pas de BYOK). Il affiche : le type et la taille du document lu, la durée, le nombre d'appels, les tokens d'entrée et de sortie, chaque valeur avec sa confiance et sa source, les valeurs écartées faute de source, les questions manquantes, le profil complet et le coût. Code de sortie 2 en cas d'échec de structuration, avec l'usage facturé.

### Sans ordinateur : GitHub Actions

Workflow `.github/workflows/icp-import-smoke.yml`, déclenché **uniquement à la main** (`workflow_dispatch`).

Une fois, dans le dépôt (Settings) :
1. **Environments → New environment** `icp-smoke`. Aucun relecteur obligatoire n'est nécessaire (le workflow n'en dépend pas).
2. Dans cet environnement, **un seul secret** : `AI_API_KEY` (la clé IA de la plateforme). Aucun secret Supabase, aucun export de l'environnement de production.
3. **Variables** du dépôt (Secrets and variables → Actions → Variables) : `SELF_OUTREACH_ORG_IDS` (l'uuid de l'organisation ProspectOS, même valeur que la variable Vercel de ce nom) ; facultatives : `AI_PROVIDER` (défaut `anthropic`), `AI_MODEL` (défaut `claude-sonnet-5`), `ICP_SMOKE_PRICE_INPUT_PER_MTOK` / `ICP_SMOKE_PRICE_OUTPUT_PER_MTOK` (défaut 2 et 10 $ par million de tokens, le tarif de la migration 010).

Le bouton « Run workflow » n'apparaît qu'une fois le fichier du workflow sur `main`. Ensuite : **Actions → ICP import smoke test → Run workflow**, choisir la branche **`feat/icp-import`** dans « Use workflow from » (sur une branche sans le script, le workflow s'arrête aussitôt sur « Script absent »), puis remplir :

- **`document_path`** — à privilégier pour un document entier : le chemin d'un fichier **du dépôt, sur la branche choisie**, directement dans `tests/fixtures/icp/` (par exemple `tests/fixtures/icp/detec-incendie.source.txt` ou `tests/fixtures/icp/protection-incendie.source.txt`). Le fichier est lu **tel quel**, retours à la ligne conservés. Quand il est renseigné, il **prend le dessus** sur le champ texte. Tout autre dossier, un sous-dossier, `..`, un chemin absolu, un lien symbolique ou un fichier absent est refusé avec « Document refusé ». Pour tester un nouveau document : l'ajouter d'abord sous `tests/fixtures/icp/` par un commit.
- **`document_text`** — pour un texte court seulement : le formulaire de GitHub est une seule ligne, les retours à la ligne d'un texte collé y sont perdus.
- **`organization_id`** — l'uuid de l'organisation, qui doit figurer dans `SELF_OUTREACH_ORG_IDS`.

Lancer, puis ouvrir le journal de l'étape « Run the smoke test ». Les entrées arrivent dans le shell par des variables d'environnement (jamais interpolées dans le script) ; un texte du formulaire est écrit dans un fichier temporaire du runner puis supprimé ; aucun artefact n'est publié ; la clé est masquée dans les journaux. Le coût affiché est calculé au tarif fourni (pas de base de données).

Fixtures de documents disponibles : `protection-incendie.source.txt` (fictif, référence des tests) et `detec-incendie.source.txt` (texte public copié depuis le site detec-incendie.com, enregistré tel quel, utilisé uniquement pour le test d'extraction — sa section 11 contient des consignes adressées à une IA : elles sont du contenu du document, que l'extraction doit traiter comme une donnée, jamais suivre).

### En local

```bash
export AI_PROVIDER=anthropic AI_MODEL=claude-sonnet-5 SELF_OUTREACH_ORG_IDS=<uuid-organisation-ProspectOS>
read -rs AI_API_KEY && export AI_API_KEY          # la clé, saisie sans écho
export ICP_SMOKE_PRICE_INPUT_PER_MTOK=2 ICP_SMOKE_PRICE_OUTPUT_PER_MTOK=10
node --experimental-strip-types scripts/icp-import-smoke.ts --org <uuid-organisation-ProspectOS> tests/fixtures/icp/protection-incendie.source.txt
```

Un PDF ou un DOCX passe aussi (`… --org <uuid> plaquette.pdf`). Avec `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` définis, le coût est lu dans la table de prix plutôt que calculé au tarif fourni.

À vérifier sur la sortie : chaque `source` est bien un passage du document ; aucune valeur n'apparaît sans source ; les zones et sites correspondent au document ; le coût reste dans l'ordre de grandeur ci-dessus.

## Smoke test réel du 4 novembre 2026 (Détec Incendie)

Workflow GitHub Actions, `tests/fixtures/icp/detec-incendie.source.txt` (8 397 caractères), `claude-sonnet-5` : succès en 49,5 s, 2 appels (le premier refusé par la validation), 10 528 tokens en entrée, 7 140 en sortie, 0,0925 $ au tarif de la migration 010. Identité, siège, 5 agences, 12 services, 3 engagements, 6 différences extraits avec leur source ; la section 11 du document (consignes adressées à une IA : NAF, score, interlocuteurs) n'a pas été suivie ; interlocuteurs et taille des clients sont restés vides et sont devenus les questions manquantes.

Constats et correctifs appliqués ensuite :
- 5 sources sur 46 n'étaient pas des passages exacts (une citation tronquée par « ... », quatre puces recollées) → **vérification de chaque source dans le document** (ci-dessus) ; rejouée sur cette réponse, elle écarte exactement ces 5 valeurs et garde les 41 autres ;
- le premier refus ne laissait qu'un nombre dans le journal → les **chemins des champs refusés** sont journalisés (jamais une valeur) ;
- plafonds du prompt trop bas (12 éléments, 5 segments) : 3 services manquaient, 14 types de clients étaient fusionnés en 5 → un type de client par segment (les plafonds élargis à 20 / 10 ont ensuite été annulés, voir le smoke test #3) ;
- « France entière » perdu → champ facultatif **`company.coverage`** (`NATIONAL`, `REGIONAL`, `LOCAL`), sourcé ; une entreprise nationale n'est plus interrogée sur ses départements ;
- logos de clients classés en preuves → le prompt les exclut des preuves (des noms affichés sans détail sur la relation ne prouvent rien) ;
- 49,5 s sur 55 → sources plus courtes et valeurs courtes (moins de sortie), nouvel essai seulement s'il reste 20 s ; un appel reste borné par le budget de la route.

À relancer : le même smoke test, pour mesurer la durée et le taux de refus du premier appel avec ces réglages.

## Smoke test #3 (sur 1ac780d) : sortie coupée, puis budget de sortie

Même document (`detec-incendie.source.txt`, 8 397 caractères) : **échec `AI_TRUNCATED_RESULT`** (`TRUNCATED_MAX_TOKENS`), 1 appel facturé, 9 519 tokens (≈ 5 423 en entrée, 4 096 en sortie : la sortie a touché le plafond), 0,0518 $. Aucun profil enregistré, aucune valeur inventée : la garde a fonctionné. Cause : les plafonds élargis (20 éléments par liste, 10 segments) produisent une réponse plus longue que `max_tokens` (4 096).

`max_tokens` **n'est pas relevé** : 4 096 tokens ont pris environ 29 s ; 8 000 frôleraient les 60 s de la route et rendraient le nouvel essai impossible. À la place, **budget de sortie** (`src/domain/icp/budget.ts`) :

- **Estimation** : tokens ≈ caractères du JSON compact ÷ 2,4. Calibration : le profil valide du smoke test #1 fait 7 064 caractères en JSON compact ; le tokenizer public `@anthropic-ai/tokenizer` (vocabulaire Claude plus ancien) y compte 2 035 tokens, soit 3,47 caractères par token ; sur l'entrée réelle du smoke test #3, ce même tokenizer compte 3 891 tokens là où l'API en a facturé ≈ 5 423, soit ×1,39 ; 3,47 ÷ 1,39 ≈ 2,5, arrondi à 2,4 (vers plus de tokens). Contrôle : ce même profil indenté fait 9 181 caractères ≈ 4 050 tokens, cohérent avec les 7 140 tokens de sortie des deux réponses du smoke test #1 — le modèle écrivait du JSON indenté ; le prompt exige désormais du JSON compact sur une seule ligne.
- **Pire cas** : `largestProfile()` remplit **toutes** les listes à leur plafond, **tous** les textes et **toutes** les sources à leur longueur maximale. Ce qui coûte, c'est le nombre de valeurs : chacune porte `{"value","source","confidence"}` (≈ 41 caractères de structure) plus sa source.
  - plafonds précédents (12 éléments par liste, 5 segments, sources de 200 caractères) : ≈ 81 000 caractères, **≈ 34 000 tokens** au pire — ils ne tenaient que parce que les documents réels ne les remplissent pas (profil réel du smoke test #1 : ≈ 2 950 tokens en JSON compact) ;
  - plafonds retenus : **≈ 2 955 tokens** au pire, pour un **budget de 3 000** (≤ 75 % de `max_tokens` : ≥ 1 096 tokens de marge).
- **Plafonds retenus au smoke test #3** (`ICP_LIMITS`, schéma + prompt ; **depuis 9ba2190 : 9 services**, la place des codes APE retirés — voir smoke test #4) : sources 40 caractères ; nom 60, activité 100 ; 6 sites (ville 40), 4 zones ; 8 services (40), 3 engagements (50), 3 différences (50), 1 preuve (50) ; 3 segments (libellé 40, 1 code APE, 2 tranches, cycle 20) ; 1 persona (fonction 40, 1 difficulté 50, angle 50) ; 2 signaux (2 segments) ; 1 exclusion (40 / 40). Le prompt demande, s'il y en a plus, de garder les plus importants.
- **Garde** : `tests/icp-budget.test.ts` vérifie que le plus grand profil accepté par le schéma tient sous le budget, que relever d'un élément une liste à valeurs textuelles le dépasse, et épingle ensemble plafonds, budget et estimation : relever un plafond sans refaire le calcul fait échouer le test.
- **Journal** : chaque échec donne les tokens d'**entrée** et de **sortie** séparément, avec la sortie du dernier appel à côté de `max_tokens` (une sortie au plafond se voit directement) ; le script de smoke test les affiche aussi.

**Conséquence assumée** : le profil extrait est plus court (Détec annonce 15 familles de services et 14 types de clients ; 8 et 3 tiennent). La personne complète à la revue. Pour retrouver de la richesse sans relever `max_tokens`, proposition non implémentée : **deux appels en parallèle** (entreprise et offre / cible), chacun avec son propre budget de 3 000 tokens — même durée qu'un appel, deux fois la sortie, ≈ +0,01 $ d'entrée.

## Smoke test #4 (sur b4b2166) : normalisation au lieu du rejet global

Même document : **la troncature est réglée** (dernier appel 2 038 tokens en sortie pour un plafond de 4 096, 45 s, 0,0649 $ pour 2 appels), mais **les deux appels échouent en `VALIDATION_FAILED`**, 20 erreurs chacun. Appel 1 : `company.sites.0` à `4` en échec sur `value`, `source` et `confidence` (la liste de sites n'avait pas l'enveloppe `{value, source, confidence}` sur chaque élément) et `company.activity.source`. Appel 2 : presque uniquement des `source` trop longues (activity, sites 1, 2, 5, coverage, services 0, 2, 3, 4, 6, proofs, personas), plus `differentiators.0.value`, `proofs.0.value`, `personas.0.painPoints.0.value`, `messageAngle.source`, et `apeCodes` des segments 0, 1 et 2 — la section 11 du document demande des codes NAF, le modèle en a produit, la table du dépôt les refuse. Aucun profil stocké, rien d'inventé : la garde a fonctionné, mais une seule valeur fautive rejetait toute la réponse.

Correctifs :
- **`apeCodes` retiré de la sortie demandée** (prompt et forme attendue) : les codes APE viendront uniquement de la table de correspondance de l'étape 4. S'il en renvoie quand même, ils sont ignorés (`APE_CODES_IGNORED`), sans rejet.
- **Squelette JSON compact dans le prompt**, montrant l'enveloppe sur une feuille et sur **chaque** élément d'une liste (exemple avec deux sites).
- **Relance** : seulement pour une structure cassée ; le modèle reçoit les chemins en échec et un code de raison (`too_long`, `invalid_value`, `wrong_shape`, `unknown_field`), jamais de contenu.
- **Journal** : chaque chemin avec son code de raison (et son code de correction), jamais une valeur ; un nom de champ inconnu n'apparaît que s'il a la forme d'un identifiant, sinon `*`.
- **Comptage réel** : dans le journal du smoke test #4, `issues` valait exactement 20 aux deux appels — c'était le plafond d'affichage de `parseIcpProfile`, pas le nombre d'erreurs. Chaque refus journalise désormais `issues_total` (le nombre réel), `issues_shown` et les 20 premiers chemins, et chaque appel (refus ou réponse normalisée) un décompte par catégorie : `source_too_long`, `source_not_in_document`, `value_too_long`, `ape_codes_ignored`, `list_item_wrong_shape`, `other`. Le script de smoke test affiche le même décompte et, en premier, le modèle utilisé (`AI_MODEL`), rappelé aussi dans le message d'échec.
- **Script de smoke test** : option `--show-raw` (et entrée `show_raw` du workflow, honorée seulement avec un `document_path` de `tests/fixtures/icp/`) qui affiche la réponse brute du modèle en cas d'échec. Jamais dans l'application (`structureIcp` ne transmet la réponse brute qu'au rappel `onRaw`, que seul ce script fournit).
- **Budget recalculé** sans `apeCodes` : le pire cas tombait à 2 845 tokens ; la place libérée rend un service (9 au lieu de 8) et le budget est resserré à **2 900 tokens** (pire cas : 2 897), pour que relever d'un élément n'importe quelle liste à valeurs textuelles le dépasse. Entrée : le prompt système, squelette compris, coûte ≈ 1 930 tokens estimés par appel (≈ 6 000 tokens d'entrée avec ce document, contre ≈ 5 400 avant), soit ≈ 0,001 $ de plus par appel.

### Normalisation de la réponse (assouplissement volontaire)

`src/domain/icp/normalize.ts`, avant toute validation. **C'est un assouplissement volontaire** de la règle « réponse acceptée en entier ou refusée » : chaque valeur et chaque élément de liste sont vérifiés seuls, contre les mêmes schémas que le profil, et ce qui échoue est **retiré, jamais réécrit** — chaque correction est un avertissement stocké avec son chemin (`icp_imports.warnings`, une entrée par code : `SOURCE_TRUNCATED:company.activity,offer.services.0`) :

| Cas | Traitement | Avertissement |
|---|---|---|
| source plus longue que `ICP_LIMITS.source` | réduite à la fenêtre de mots entiers (40 caractères au plus) qui contient le plus de mots de la value (sans accents ni majuscules ; à égalité, la plus proche du début) ; un morceau contigu d'un passage exact reste un passage exact, la vérification dans le document s'applique après | `SOURCE_TRUNCATED` |
| valeur trop longue | vidée (`null`, donc question manquante), jamais raccourcie | `VALUE_DROPPED_TOO_LONG` |
| valeur invalide (code, enum, type, confiance hors 0–1, enveloppe incorrecte) | vidée | `VALUE_DROPPED_INVALID` |
| élément de liste mal enveloppé ou invalide | retiré | `ITEM_DROPPED_INVALID` / `ITEM_DROPPED_TOO_LONG` |
| liste au-delà de son plafond | premiers éléments gardés | `ITEM_DROPPED_OVER_LIMIT` |
| champ inconnu sous la racine | retiré, jamais stocké | `FIELD_DROPPED_UNKNOWN` |
| champ attendu absent | rempli vide | `FIELD_MISSING` |
| codes APE renvoyés | ignorés | `APE_CODES_IGNORED` |
| signal pointant un segment retiré ou inconnu | référence retirée | `SEGMENT_REF_DROPPED` |
| clé de segment invalide ou en double | recalculée depuis le libellé (minuscules, sans accents, `_`, 20 caractères, suffixe `_2`… si doublon) ; les signaux qui pointaient l'ancienne clé la suivent ; un libellé invalide écarte toujours le segment | `KEY_REGENERATED` |
| élément de liste vide (libellé absent ou vide ; engagement dont `text`, `value` et `unit` sont tous `null`) | retiré sans avertissement | — |
| preuve (`offer.proofs`) contenant un nom propre (mot à majuscule initiale) absent de sa source | nom retiré de la value avec son séparateur, où qu'il soit (premier mot compris) ; jamais un mot courant de début de phrase (`SENTENCE_WORDS` : Plus, Notre, Nos, Depuis, Clients…) ; preuve retirée s'il ne reste que de tels mots | `VALUE_TRIMMED` (chemin seul) |

**Ce qui reste strict** :
- **rejet global** (un nouvel essai, puis échec) : JSON illisible, plus d'un objet ou du texte autour, clé racine manquante ou inconnue (`admin`, …), `version` différente de 1, bloc racine du mauvais type ;
- **zéro invention** : une valeur sans source, ou dont la source n'est pas un passage du document (après la coupe), est vidée ; rien n'est jamais complété, deviné ou reformulé par le serveur ;
- **validation finale entière** par `parseIcpProfile` (objets stricts, codes de département et tranches connus, clés de segment uniques) : si elle échoue encore, c'est un rejet ;
- **brouillon** : rien n'est appliqué sans validation humaine ; les avertissements et les questions manquantes sont montrés à la revue.

## Smoke test #5 (sur b38783a) et journal des éléments écartés

1 appel, 1 903 tokens de sortie, 0,031 $, sécurité OK. Trois points :

- **`offer.services` à 9 éléments** : ce n'est pas un dépassement. Le plafond est **9** depuis 9ba2190 (smoke test #4 : la place libérée par les codes APE a rendu un service ; budget 2 900, pire cas 2 897) — c'est la doc du smoke test #3 qui disait encore 8. La normalisation **coupe bien** toute liste à son plafond (premiers éléments gardés, avertissement `ITEM_DROPPED_OVER_LIMIT`, qui nomme désormais les éléments retirés) ; aucun nouveau code n'est nécessaire. Le test de budget épingle déjà `services:9`.
- **Journal des éléments écartés** : chaque `ITEM_DROPPED_*` donne son chemin, la règle précise du schéma qui l'a refusé (« role : valeur non admise (attendu HQ|AGENCY|PARTNER) », « trop long (40 max) », « enveloppe {value, source, confidence} attendue », « persona sans fonction (role vide) », « 9 éléments max (11 reçus) »…) et sa **longueur** en caractères. **Les 60 premiers caractères** de la valeur ne s'affichent que dans la **console du script de smoke test** ; le journal serveur (production comprise) n'en contient jamais — ajustement après le run #6, un test échoue si un extrait y apparaît.
- **Prompt** : un différenciateur ne doit répéter ni `coverage` (couverture nationale…) ni un engagement de `promises` (délai…). Prompt système ≈ 1 970 tokens estimés (garde de 2 000).

## Après le run #6 (sur 82de82f)

Run #6 validé (1 appel, 6 080 tokens en entrée, 1 855 en sortie, 13,3 s, 0,0307 $ ; le doublon « Couverture géographique nationale » a disparu des différenciateurs). Ajustements, plafonds, `max_tokens` et 041 inchangés :
- **extraits** d'éléments écartés : console du script de smoke test seulement ; journal serveur = chemin + règle + longueur ;
- **prompt** : `value` est une reformulation courte (longueurs `ICP_LIMITS`), `source` la phrase exacte du document (40 caractères) ; une value trop longue doit être raccourcie, jamais l'élément supprimé ; pas de persona si la fonction n'est pas écrite dans le document ; un engagement chiffré garde son chiffre dans `text` (« Devis gratuit sous 24 h ») et le reporte dans `value` / `unit` ;
- **écran de revue** : chaque engagement affiche toujours `value` + `unit` à côté de son libellé (ou « sans chiffre »).

## Après le run #7 (sur cb8ed4b)

Run #7 validé. Ajustements de code, sans toucher au prompt, aux autres plafonds, à `max_tokens` ni à la 041 :
- **différenciateurs : 60 caractères** au lieu de 50 (« Un seul interlocuteur pour 15 familles d'équipements » en faisait 52). Budget recalculé : le pire cas passe de 2 897 à **2 909 tokens** (≤ 3 000) ; le budget est fixé à **2 920**, pour qu'ajouter un élément à n'importe quelle liste textuelle le dépasse encore (le plus petit ajout, une zone, donne 2 945) ;
- **élément de liste au libellé vide** (persona sans fonction, exclusion sans libellé, signal sans type, segment sans libellé) : retiré **sans** entrée dans les corrections de normalisation — ce n'est pas une erreur du modèle, juste une case vide ; les questions manquantes sont calculées comme avant. Un libellé présent mais refusé (trop long, invalide) reste signalé ;
- **projection** : `PARTNER` et `AGENCY` sont traités de la même façon (le rôle d'un site n'entre ni dans l'offre ni dans `target_fit` ; leurs villes et départements deviennent des lieux ciblés) — test à l'appui ;
- **écran de revue** : une source de 40 caractères (donc coupée par la normalisation) se termine par « … ».

Nouvelle fixture `tests/fixtures/icp/detec-incendie.site-only.txt` : le même texte que `detec-incendie.source.txt`, sans la section 11 (consignes adressées à une IA), pour mesurer l'extraction sur le seul contenu du site.

## Après les runs #8 et #9 (Détec site seul, Protec Minéral)

Run #9 (Protec Minéral) : les deux segments étaient écartés pour une **clé** trop longue (`professionnels_batiment_tp`, `collectivites_amenagement_urbain`), un identifiant technique et non une donnée. Corrections de code, prompt et plafonds inchangés :
- clé de segment invalide **recalculée depuis le libellé** (`KEY_REGENERATED`, chemin seul) ;
- engagement entièrement vide retiré sans avertissement ; un engagement avec un texte mais une valeur invalide reste signalé ;
- coupe des sources : **fenêtre de 40 caractères** la plus riche en mots de la value, au lieu du début de la phrase (« PROTEC SOL est une solution de… » → « de protection hydrofuge et oléofuge ») ;
- résumé du script : « Valeurs écartées faute de source » ne liste que les valeurs sans source ; les autres vont dans « Valeurs écartées (autre raison) », avec la règle.

## Après les runs #10 et #11 (Protec Minéral, Détec site seul)

- **Un seul `KEY_REGENERATED` au run #10 : aucune correction perdue.** Le journal est cohérent : `fixes_total` = 7 = 6 `source_too_long` + 1 `other`, et la liste `fixes` compte 7 lignes. Une seule clé était invalide (`segments.0`, recalculée en `professionnels_du_ba`). La clé du second segment, `villes_collectivites`, est celle du modèle : elle est valide (20 caractères, minuscules, `_`), donc gardée — une clé recalculée depuis « Villes et aménagements urbains » aurait donné `villes_et_amenagemen`. Le rapport du run disait à tort « deux clés recalculées ». Test ajouté : deux clés invalides et une valide donnent exactement deux `KEY_REGENERATED` dans le journal serveur, avec `fixes_total` = somme des catégories = lignes listées.
- **Badge « source partielle »** (`isPartialSource`, `normalize.ts`) : une valeur texte dont moins de 50 % des mots de 4 lettres ou plus (sans accents, sans majuscules) figurent dans sa source est marquée à l'écran de revue (et dans la console du script de smoke test). Elle n'est **pas** supprimée. Une valeur saisie par la personne, une valeur sans mot de 4 lettres, une valeur non textuelle ne sont jamais marquées.
- **Preuves (`offer.proofs` seulement)** : un nom propre absent de la source est retiré de la value (`VALUE_TRIMMED`, chemin seul, sans texte). Un nom propre absent de la source est retiré où qu'il soit, premier mot compris : « Bouygues, SNCF » avec la source « SNCF » donne « SNCF ». Les mots courants capitalisés en début de phrase (`SENTENCE_WORDS` : Plus, Notre, Nos, Depuis, Avec, Clients…) ne sont jamais pris pour des noms propres : « Plus de 500 clients » avec la source « 500 clients » reste intact ; « Clients: Foncia, SNCF » avec la source « Foncia. » donne « Clients: Foncia » (« Clients » est dans la liste). Une preuve dont il ne reste que des mots de la liste (« Clients: Bouygues » → « Clients ») est retirée et devient une question manquante.
- **Interrupteur `ICP_IMPORT_ENABLED`** (voir ci-dessous).

## Interrupteur `ICP_IMPORT_ENABLED`

Variable serveur, **désactivée par défaut** (absente, vide ou autre chose que `true` / `1`). Désactivé :
- toutes les routes `/api/v1/icp-imports…` répondent **404** `{code: "ICP_IMPORT_DISABLED"}` **avant** de lire quoi que ce soit : ni corps de requête, ni base, ni droit d'accès, ni quota, ni appel au fournisseur IA ;
- l'écran « Importer mon entreprise » ne s'affiche pas : il ne rend rien avant la première réponse du serveur, et rien quand celle-ci est `ICP_IMPORT_DISABLED`. Aucune variable publique (`NEXT_PUBLIC_…`) : seul le serveur décide. `app/page.tsx` n'est pas modifié (sa partie historique reste identique à main) ;
- l'export RGPD lit `icp_imports` avec `selectOptional` : table absente → liste vide, l'export marche.

**À n'activer que là où la migration 041 est appliquée.** Sans la 041, fusionner la branche ne change rien en production tant que la variable n'est pas posée.

## Essai de bout en bout

Runbook pas à pas (téléphone) : [`docs/ICP_IMPORT_E2E.md`](ICP_IMPORT_E2E.md) — 041 sur le staging, interrupteur sur le Preview de la branche seulement, checklist à deux comptes, retour arrière (`db/rollbacks/041_icp_import.down.sql`, vérifié par `npm run test:icp-rollback-db`).

## Migration 041 gelée

La migration `041_icp_import.sql` est **gelée** depuis le commit « correctifs avant l'étape 3 » : plus aucune modification. Tout changement futur du schéma de l'import (table, fonctions, déclencheurs, droits) passe par une nouvelle migration **042** (puis suivantes), avec ses propres tests et son rollback. Un test (`tests/icp-import-review.test.ts`) vérifie l'empreinte SHA-256 du fichier et échoue à la moindre modification. La 041 n'est appliquée ni en staging ni en production à ce jour.

## Tests

- `tests/icp-schema.test.ts` : le schéma (fixture de référence protection incendie, zéro invention, objets stricts).
- `tests/icp-import.test.ts` (étape 2A, fournisseur IA simulé au niveau HTTP) : octets de tête (faux `.pdf`), bombe zip DOCX et nombre d'entrées, PDF de plus de 30 pages, PDF scanné, limite réelle 4 Mio / 4 Mio + 1, injection HTML et PDF, faux JSON avec un champ inconnu, valeur sans source → question manquante, un seul nouvel essai et `token_usage` cumulé, réponse tronquée ou refusée sans nouvel essai, BYOK (clé payeuse, échec fermé), fixture de référence (chaque source est un passage du document).
- `tests/icp-import-db.mjs` : la migration 041 (états, transitions, gardes, quotas, rétention, effacement à chaque statut, suppression de projet et de compte, verrou de 2 minutes, parcours complet sur la fixture jusqu'aux critères stockés, brouillon corrompu), échoue sans elle (`WITHOUT_041=1`).
- `tests/icp-import-review.test.ts` (étape 2B) : parcours complet sur la fixture (revue, correction, validation, critères projetés à 100), garder l'offre / les critères, règle modifiée à la main gardée, rejet et relance, reprise après rechargement et coupure réseau, `PENDING` périmé, brouillon illisible, éditions et questions, signaux non surveillés, validation par clic seulement, dictionnaire local, mobile (cibles 44 px, barre en bas).
- `tests/icp-import.test.ts` vérifie aussi le workflow de smoke test (déclenchement manuel seul, un seul secret, aucune interpolation, rien de publié).
