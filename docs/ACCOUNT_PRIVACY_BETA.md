# Compte, export, suppression, accès bêta

Référence technique du bloc `feat/account-privacy-beta` (migration `008_account_privacy_beta.sql`).

## Accorder manuellement un accès bêta de 7 jours

Il n'existe volontairement aucun tableau de bord admin. L'activation est une action serveur
documentée, exécutée directement en SQL par un opérateur (SQL Editor Supabase, ou toute connexion
avec des droits suffisants sur la base) — `grant_beta_access` n'est accordée à aucun rôle client
(`public`, `anon`, `authenticated`), un utilisateur connecté ne peut jamais l'appeler lui-même.

```sql
select public.grant_beta_access('email-du-beta-testeur@exemple.com');
```

Effets :
- Si l'utilisateur n'a jamais eu d'accès bêta : consomme une place sur les 10 disponibles
  (`prospectos_private.beta_program.capacity`, configurable par `update
  prospectos_private.beta_program set capacity = N;`), sinon échoue avec `BETA_CAPACITY_REACHED`.
- Pose `starts_at = now()`, `expires_at = now() + 7 jours`, `status = 'ACTIVE'`.
- Réactiver un utilisateur déjà connu (ré-invitation) ne consomme pas de nouvelle place.
- Échoue avec `User not found for that email` si l'adresse ne correspond à aucun `auth.users`.

Vérifier l'état d'un compte :
```sql
select * from public.account_entitlements where user_id = (select id from auth.users where email = '...');
```

## Suppression de compte — ce qui se passe réellement

« Supprimer mon compte » ne fait **jamais** un `DELETE FROM auth.users` littéral : les FK
`organizations.owner_id`, `evidence.verified_by`, `events.actor_id` référencent toutes
`auth.users(id)` sans `ON DELETE`, et `evidence.verified_by`/`events` ne peuvent être touchées sans
affaiblir respectivement l'evidence-first (CHECK constraint) et l'append-only (`event_immutable`).

À la place :
1. `delete_own_account()` (RPC, `SECURITY DEFINER`) retire les lignes `memberships` de l'utilisateur,
   après un contrôle « dernier owner » atomique et bloquant (voir CAS A-D ci-dessous).
2. Si l'étape 1 réussit, le serveur (jamais le navigateur) appelle l'API admin Supabase avec
   `SUPABASE_SERVICE_ROLE_KEY` pour anonymiser la ligne `auth.users` : email remplacé par
   `deleted+<uuid>@deleted.invalid`, mot de passe remplacé par une valeur aléatoire jamais révélée,
   compte banni (~100 ans), `user_metadata.deleted = true`.

La ligne `auth.users` continue donc d'exister (toutes les FK restent valides), mais devient
définitivement inutilisable et ne porte plus d'email réel.

### CAS traités

| Cas | Situation | Comportement |
|---|---|---|
| A | Membre simple | Membership retiré, organisation intacte |
| B | Owner, un autre owner existe | Membership retiré, organisation intacte |
| C | Dernier owner, organisation encore active (autres membres ou données) | **Bloqué** — `LAST_OWNER_BLOCKED` (HTTP 409), rien n'est supprimé |
| D | Seul membre d'une organisation qui n'a ni autre membre ni donnée | Reporté à un futur bloc — voir ci-dessous |

**CAS D explicitement reporté** : supprimer l'organisation elle-même impliquerait de supprimer ses
propres lignes `events`, ce que le trigger append-only `event_immutable` interdit sans exception
aujourd'hui. Plutôt que de modifier ce mécanisme d'intégrité sans validation explicite, ce bloc laisse
CAS D se comporter comme CAS C (bloqué) tant qu'une décision n'est pas prise sur la suppression
d'organisation. `transfer_organization_ownership(org_id, new_owner_user_id)` existe déjà pour une
résolution CAS C propre, mais n'a pas d'UI (V0 n'a pas de système d'invitation multi-membres).

## Export de données

`POST /api/v1/account/export` (authentifié) génère un ZIP contenant `account.json`,
`organizations.json`, `projects.json`, `icps.json`, `prospects.json`, `evidence.json`,
`channels.json`, `outreach.json`, `history.json` et un `README.txt` explicatif — exclusivement via le
client authentifié de l'appelant (RLS s'applique, jamais de contournement tenant). Aucun secret
(mot de passe, jeton, clé Supabase) n'est jamais interrogé pour cet export.

## Enforcement serveur de l'accès bêta

Routes protégées (401/402 avant toute action) :
- `POST /api/v1/outreach` (génération de message)
- `POST /api/v1/analyze-company` (analyse IA de l'offre)
- Discovery : lancement d'une recherche (`POST /projects/:id/discovery`) et analyse d'un site
  (`POST /prospects/:id/analyze`)

Jamais protégées : connexion, `GET /account`, export, suppression de compte, déconnexion, lecture des
prospects/projets/résultats déjà obtenus, revue d'observation.

Code d'erreur stable : `BETA_ACCESS_EXPIRED`, HTTP 402.
