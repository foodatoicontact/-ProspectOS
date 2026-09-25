# Analyse de site : autorisation dynamique sûre

« Analyser le site » télécharge au plus 3 pages publiques d'un site. La **destination** est toujours
décidée par le serveur ; le corps de la requête n'est jamais lu.

## Trois décisions indépendantes

| Niveau | Question | Qui décide |
|---|---|---|
| FETCHABLE | Le serveur peut-il télécharger ce site ? | cette autorisation + `safe-fetch.ts` |
| RELEVANT | L'organisation correspond-elle à l'ICP ? | l'utilisateur |
| VERIFIED | Une preuve est-elle confirmée ? | l'utilisateur, preuve par preuve |

Une autorisation réseau ne crée ni pertinence, ni preuve, ni score : les observations restent
`NOT_VERIFIED` / `INFERRED_UNCONFIRMED`, le score reste 0 sans validation humaine.

## Sources d'autorité (`src/discovery/analysis-authorization.ts`)

1. **`dynamic_discovery`** — seulement si `DISCOVERY_DYNAMIC_ANALYSIS_ENABLED` vaut exactement `true`
   (toute autre valeur : désactivé). Le prospect doit être lié à un `discovery_results` qui est, à la fois :
   `status='accepted'` pour ce prospect, `provider='brave'`, `source_class='COMPANY_CANDIDATE'`,
   `raw_payload.company_domain_method='own_site'`, avec un `website` et un `source_url` du même domaine
   enregistrable. Ces lignes sont écrites uniquement par le serveur (migration 014) et lues sous RLS.
   - **Source de vérité de l'hôte : `discovery_results.website`**, jamais `prospects.website` ni l'URL
     d'une requête. La destination téléchargée est l'origine de `discovery_results.website`.
   - `prospects.website` (modifiable par les membres) doit toujours désigner le **même hôte** : égalité
     exacte après minuscules, point final retiré et **un seul `www.` initial retiré**
     (`bebureau.com` = `www.bebureau.com` ; `shop.bebureau.com`, `evilbebureau.com` : autres hôtes).
     Site modifié après acceptation → `WEBSITE_MISMATCH`.
   - Politique de téléchargement : chaque URL (page, redirections, robots.txt et ses redirections) doit
     appartenir au même **domaine enregistrable** (Public Suffix List via `tldts`, section privée incluse :
     `a.github.io` ≠ `b.github.io`) ; aucun passage de HTTPS à HTTP.
2. **`static_allowlist`** — `DISCOVERY_ALLOWED_HOSTS`, surcharge opérateur inchangée (prospects manuels,
   sources revues, usage interne) : l'hôte du prospect ou un sous-domaine d'une entrée.

Sinon, refus avant tout quota et tout réseau :

| Code | Cas |
|---|---|
| `OFFICIAL_WEBSITE_REQUIRED` | prospect sans site |
| `DYNAMIC_ANALYSIS_DISABLED` | capacité valide mais interrupteur coupé |
| `WEBSITE_MISMATCH` | résultat éligible, mais le site du prospect est un autre hôte |
| `DISCOVERY_CAPABILITY_INVALID` | résultat accepté non éligible (cité par un tiers, non first-party, fixture…) |
| `SOURCE_POLICY_REQUIRED` | aucun résultat accepté (prospect manuel) et hors liste opérateur |

Après autorisation : `QUOTA_EXCEEDED`, `ROBOTS_DENIED` (robots.txt refuse le site), `ANALYSIS_FAILED`
(réseau, SSRF, redirection, taille, type, délai — sans aucun détail d'adresse).

## Protections inchangées (`src/discovery/safe-fetch.ts`)

HTTP(S), ports 80/443, pas d'identifiants, localhost / IP non publiques (privées, loopback, link-local,
multicast, réservées, CGNAT, IPv4-mapped, NAT64, 6to4) refusés, toutes les réponses DNS vérifiées et
l'adresse validée épinglée à la connexion, contrôles repassés à chaque requête, 3 redirections, 500 Ko,
12 s par téléchargement, HTML uniquement, pas de décompression, pas de cookie, pas de JavaScript.

## robots.txt

Vérifié avant chaque requête HTML ; refus par défaut si robots.txt est inaccessible (5xx, réseau, type
non `text/plain`). Un robots.txt atteint par redirection est appliqué dans le contexte de l'autorité
initiale (RFC 9309 §2.3.1.2), ce qui rend analysables les sites redirigeant `bebureau.com/robots.txt` vers
`www.`. Groupe de règles : `ProspectOS`. User-Agent :
`ProspectOS/1.0 (+<SITE_URL>/mentions-legales)` (page publique de l'éditeur, avec ses coordonnées).

**Conformité robots.txt ≠ permission contractuelle ≠ sécurité SSRF.** La décision d'activer l'autorisation
dynamique au regard des conditions d'utilisation des sites appartient à l'opérateur.

## Périmètre

Page d'accueil autorisée + au plus 2 liens de la **même origine**, profondeur 1 (3 pages, inchangé).
Liens retenus : contact, about/à-propos/qui-sommes-nous, produits/products, services, solutions,
catalogue — et les mots historiques menu, carte, commande, order, livraison.

## Quotas (migration 015)

Une analyse doit trouver de la place dans **les deux** quotas : 20/heure par organisation (inchangé) et
20/heure par utilisateur (`analyses_per_user_per_hour`) — créer des organisations ne multiplie plus le
quota. Vérification + réservation dans une transaction, sous deux verrous consultatifs pris dans un ordre
fixe (utilisateur puis organisation). La réservation précède tout téléchargement et reste consommée en
cas d'échec.

## Journal (`public.website_analysis_audit`, migration 015)

Une ligne par tentative sur un site réel (autorisée ou refusée) : `organization_id`, `prospect_id`,
`user_id`, `host` canonique, `authorization_mode`, `outcome`, `pages_analyzed`, `failed_pages`,
`created_at`, `completed_at`. Jamais de contenu, de chemin, d'adresse IP, d'en-tête, de cookie ou de clé.

- Écriture : uniquement par le serveur (`record_website_analysis` / `complete_website_analysis`,
  exécutables par `service_role` seul, qui revérifient l'appartenance de l'utilisateur à l'organisation
  du prospect).
- Lecture : les membres de l'organisation (RLS). Aucune modification ni suppression via l'API.
- Une tentative autorisée est d'abord enregistrée `STARTED` : si ce journal ne peut pas être écrit, rien
  n'est téléchargé. La clôture et l'enregistrement des refus sont au mieux (journalisés en cas d'échec).

## Activation (après merge, décision opérateur)

`DISCOVERY_DYNAMIC_ANALYSIS_ENABLED=true` dans l'environnement serveur, après application de la migration
015. Sans cette variable, seule la liste opérateur fonctionne.
