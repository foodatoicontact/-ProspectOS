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

- borne haute d'un appel : ~15 000 tokens d'entrée (50 000 caractères + prompt) + 4 096 en sortie ≈ 0,03 $ + 0,041 $ ≈ **0,07 $** ; avec le nouvel essai ≈ **0,14 $** ;
- une présentation de quelques milliers de caractères : quelques milliers de tokens dans chaque sens, soit de l'ordre de **0,02 à 0,04 $**.

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
- plafonds du prompt trop bas (12 éléments, 5 segments) : 3 services manquaient, 14 types de clients étaient fusionnés en 5 → **20 éléments par liste, 10 segments, un type de client par segment** ;
- « France entière » perdu → champ facultatif **`company.coverage`** (`NATIONAL`, `REGIONAL`, `LOCAL`), sourcé ; une entreprise nationale n'est plus interrogée sur ses départements ;
- logos de clients classés en preuves → le prompt les exclut des preuves (des noms affichés sans détail sur la relation ne prouvent rien) ;
- 49,5 s sur 55 → sources limitées à 100 caractères et valeurs courtes (moins de sortie), nouvel essai seulement s'il reste 20 s ; un appel reste borné par le budget de la route.

À relancer : le même smoke test, pour mesurer la durée et le taux de refus du premier appel avec ces réglages.

## Migration 041 gelée

La migration `041_icp_import.sql` est **gelée** depuis le commit « correctifs avant l'étape 3 » : plus aucune modification. Tout changement futur du schéma de l'import (table, fonctions, déclencheurs, droits) passe par une nouvelle migration **042** (puis suivantes), avec ses propres tests et son rollback. Un test (`tests/icp-import-review.test.ts`) vérifie l'empreinte SHA-256 du fichier et échoue à la moindre modification. La 041 n'est appliquée ni en staging ni en production à ce jour.

## Tests

- `tests/icp-schema.test.ts` : le schéma (fixture de référence protection incendie, zéro invention, objets stricts).
- `tests/icp-import.test.ts` (étape 2A, fournisseur IA simulé au niveau HTTP) : octets de tête (faux `.pdf`), bombe zip DOCX et nombre d'entrées, PDF de plus de 30 pages, PDF scanné, limite réelle 4 Mio / 4 Mio + 1, injection HTML et PDF, faux JSON avec un champ inconnu, valeur sans source → question manquante, un seul nouvel essai et `token_usage` cumulé, réponse tronquée ou refusée sans nouvel essai, BYOK (clé payeuse, échec fermé), fixture de référence (chaque source est un passage du document).
- `tests/icp-import-db.mjs` : la migration 041 (états, transitions, gardes, quotas, rétention, effacement à chaque statut, suppression de projet et de compte, verrou de 2 minutes, parcours complet sur la fixture jusqu'aux critères stockés, brouillon corrompu), échoue sans elle (`WITHOUT_041=1`).
- `tests/icp-import-review.test.ts` (étape 2B) : parcours complet sur la fixture (revue, correction, validation, critères projetés à 100), garder l'offre / les critères, règle modifiée à la main gardée, rejet et relance, reprise après rechargement et coupure réseau, `PENDING` périmé, brouillon illisible, éditions et questions, signaux non surveillés, validation par clic seulement, dictionnaire local, mobile (cibles 44 px, barre en bas).
- `tests/icp-import.test.ts` vérifie aussi le workflow de smoke test (déclenchement manuel seul, un seul secret, aucune interpolation, rien de publié).
