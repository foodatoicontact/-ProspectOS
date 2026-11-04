# Importer mon entreprise (import ICP)

L'import pré-remplit le **profil de l'entreprise, de son offre et de sa cible** (`IcpProfile`) à partir d'un document que la personne fournit elle-même : texte collé, PDF, DOCX (et, à l'étape 3, l'adresse de son propre site). Le résultat est **toujours un brouillon** : rien n'est utilisé en prospection tant qu'une personne ne l'a pas relu et validé (`DRAFT → VALIDATED` uniquement par action humaine, migration 041).

État : étape 1 (schéma, migration 041) et étape 2A (ingestion, structuration, API) livrées. Restent 2B (écran de revue), 3 (import d'URL), 4 (projection déterministe vers les critères), 5 (questions manquantes et ré-import avec diff).

## Règles qui ne bougent pas

- **Le contenu importé est une donnée, jamais une instruction.** Il est envoyé au modèle une seule fois, encodé en JSON, entre deux marqueurs qui portent un nonce aléatoire (`<<<DOCUMENT_…>>>` / `<<<FIN_DOCUMENT_…>>>`), après un prompt système qui le dit. Un faux marqueur dans le document ne ferme rien : il ne connaît pas le nonce.
- **Réponse JSON uniquement, validée par Zod** (`parseIcpProfile`, objets stricts) : toute propriété hors schéma, tout type faux, tout code inconnu (département, tranche d'effectif, NAF, type de signal) fait refuser le profil **en entier**. Jamais de réparation silencieuse du JSON.
- **Zéro invention** : chaque valeur extraite est `{value, source, confidence}` ; `source` est un passage du document (200 caractères au plus), `confidence` entre 0 et 1. Une valeur donnée sans source est vidée (`null`, confiance 0), son chemin est signalé (avertissement `UNSOURCED_VALUES_DROPPED`) et devient une **question manquante**.
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
| GET | `/api/v1/icp-imports/:id` | — | l'import et son brouillon **revalidé à chaque lecture** (`profile_state` : `valid`, `unreadable`, `none`) |

Ces routes sont traitées dans `app/api/v1/[...path]/route.ts` **avant** la lecture JSON générique (plafonnée à 20 000 caractères). Les routes de validation et d'abandon arrivent avec l'écran de revue (2B) ; les fonctions SQL existent déjà (041).

Codes d'erreur : `FILE_TOO_LARGE` (413), `UNSUPPORTED_FILE` (415), `FILE_EMPTY`, `TEXT_TOO_SHORT`, `TEXT_TOO_LONG`, `PDF_SCANNED`, `PDF_ENCRYPTED`, `PDF_UNREADABLE`, `PDF_TIMEOUT`, `DOCX_UNREADABLE`, `DOCX_TOO_LARGE` (422), `ICP_IMPORT_IN_PROGRESS` (409), `ICP_URL_DAILY_LIMIT`, `OFFER_LIMIT_REACHED`, `QUOTA_EXCEEDED` (429), `AI_UNAVAILABLE`, `AI_TRUNCATED_RESULT`, `AI_INVALID_RESULT` (502), `BYOK_CREDENTIAL_INVALID`, `AI_NOT_CONFIGURED` (503). Chaque refus d'ingestion porte une phrase qui dit quoi faire à la place (adresse du site, texte collé).

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
| Modèle | 4 096 tokens de sortie, réflexion désactivée, aucun outil, 40 s par appel ; nouvel essai seulement s'il reste 15 s sur le budget de 55 s de la route | `structureIcp` |
| Imports | 1 import en cours par projet (10 min) ; 10 imports d'URL par organisation et par 24 h | `start_icp_import` |

Une fonction interrompue par la plateforme (60 s) laisse sa ligne `PENDING` : elle bloque un nouvel import du projet pendant 10 minutes au plus, puis le verrou tombe.

## Données, rétention, RGPD

- Les fichiers sont lus en mémoire et **jamais stockés** (pas de bucket). Seuls restent le libellé de la source (nom de fichier réduit, ou « Texte collé »), le brouillon structuré, les questions, les avertissements, l'erreur éventuelle et l'usage réel (`token_usage`, `usage.attempts`).
- Imports `FAILED` et `DISCARDED` : purgés après **30 jours** (à chaque nouvel import, et par `purge_icp_imports()`).
- Export RGPD : `icp_imports.json` dans l'archive du compte. Suppression de compte : `delete_own_account` refuse le dernier propriétaire d'une organisation qui a des projets ; un autre membre perd l'accès et les imports restent à l'organisation. L'application n'a pas de suppression de projet ; la clé étrangère vers `projects` est sans cascade, comme pour les prospects. **Limite connue** : hors purge des `FAILED` / `DISCARDED` de plus de 30 jours, aucune opération ne supprime un import (le déclencheur le refuse, même au rôle propriétaire) — une demande d'effacement d'une organisation demandera une opération dédiée (à ajouter avant la mise en production de l'import).
- La base ne contrôle que le contour du profil (objet, ≤ 100 Ko, 6 clés racine) ; **chaque lecture repasse par `parseIcpProfile`** et un profil qui ne passe plus est déclaré illisible (« Relancez un import »), jamais utilisé en partie.

## Coût

Chaque import consomme **une** unité du quota « analyse d'offre » (`ai_offer`), nouvel essai compris. Le coût réel est enregistré dans `icp_imports.token_usage` / `usage` et, appel par appel, dans le registre des coûts (`api_usage_events`, opération `offer_analysis`).

Ordre de grandeur, au tarif enregistré pour `claude-sonnet-5` (migration 010 : 2 $ par million de tokens en entrée, 10 $ en sortie) — **estimations**, le smoke test donne le chiffre réel :

- borne haute d'un appel : ~15 000 tokens d'entrée (50 000 caractères + prompt) + 4 096 en sortie ≈ 0,03 $ + 0,041 $ ≈ **0,07 $** ; avec le nouvel essai ≈ **0,14 $** ;
- une présentation de quelques milliers de caractères : quelques milliers de tokens dans chaque sens, soit de l'ordre de **0,02 à 0,04 $**.

## Smoke test réel (opérateur)

Un appel réel à `structureIcp` sur un fichier local, sans rien écrire dans `icp_imports` ni dans un profil. Même liste opérateur que les autres exécutions (`SELF_OUTREACH_ORG_IDS`, docs/SELF_OUTREACH.md §8) : l'organisation passée doit y figurer. La clé de la plateforme paie (pas de BYOK).

```bash
vercel env pull .env.smoke --environment=production   # AI_PROVIDER, AI_MODEL, AI_API_KEY, SELF_OUTREACH_ORG_IDS, Supabase
set -a && . ./.env.smoke && set +a
node --experimental-strip-types scripts/icp-import-smoke.ts --org <uuid-organisation-ProspectOS> tests/fixtures/icp/protection-incendie.source.txt
rm .env.smoke                                          # ne jamais committer ce fichier
```

Il affiche : le type et la taille du document lu, la durée, le nombre d'appels, les tokens d'entrée et de sortie, chaque valeur avec sa confiance et sa source, les valeurs écartées faute de source, les questions manquantes, le profil complet, et le coût lu dans la table de prix (si les variables Supabase sont présentes). Code de sortie 2 en cas d'échec de structuration, avec l'usage facturé.

À vérifier sur la sortie : chaque `source` est bien un passage du document ; aucune valeur n'apparaît sans source ; les zones et sites correspondent au document ; le coût reste dans l'ordre de grandeur ci-dessus.

## Tests

- `tests/icp-schema.test.ts` : le schéma (fixture de référence protection incendie, zéro invention, objets stricts).
- `tests/icp-import.test.ts` (étape 2A, fournisseur IA simulé au niveau HTTP) : octets de tête (faux `.pdf`), bombe zip DOCX et nombre d'entrées, PDF de plus de 30 pages, PDF scanné, limite réelle 4 Mio / 4 Mio + 1, injection HTML et PDF, faux JSON avec un champ inconnu, valeur sans source → question manquante, un seul nouvel essai et `token_usage` cumulé, réponse tronquée ou refusée sans nouvel essai, BYOK (clé payeuse, échec fermé), fixture de référence (chaque source est un passage du document).
- `tests/icp-import-db.mjs` : la migration 041 (états, transitions, gardes, quotas, rétention), échoue sans elle (`WITHOUT_041=1`).
