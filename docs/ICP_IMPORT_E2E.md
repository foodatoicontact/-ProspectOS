# Import ICP — essai de bout en bout sur le staging

Runbook à suivre depuis un téléphone. Il ne touche **jamais** la production. Durée : environ 45 min. Coût IA : environ 0,03 $ par import, soit 0,15 $ à 0,20 $ pour tout l'essai, payé par la clé Anthropic du compte A.

Ce qui sépare le staging de la production, vérifié le 4 novembre 2026 :

| | Staging | Production |
|---|---|---|
| Supabase | `-ProspectOS-staging` · `ggilyurgopsjrpnvxovl` | `vptqxhlxwiljfbkybqej` |
| Environnement Vercel qui y pointe | **Preview** (`NEXT_PUBLIC_SUPABASE_URL` = `https://ggilyurgopsjrpnvxovl.supabase.co/`) | **Production** (prospectos.fr) |
| 041 appliquée | non (dernière migration : 040) | non |
| `ICP_IMPORT_ENABLED` | absente | absente |

Règle d'or : on ne coche **jamais** « Production » dans Vercel, et on ne colle **jamais** le ref `vptqxhlxwiljfbkybqej` nulle part.

---

## A. Appliquer la 041 sur le staging

Outil : le workflow GitHub **Staging migrations** (`.github/workflows/staging-migrations.yml`). Il se lance seulement à la main, vise seulement le staging, et refuse toute URL de base qui mentionne la production.

1. Récupère le SHA à appliquer.
   - GitHub → PR #66 → onglet **Commits** → dernier commit → copie le SHA **complet** (40 caractères).
   - Ne pousse plus rien sur la branche avant l'étape 5.
2. GitHub → dépôt `-ProspectOS` → **Actions** → **Staging migrations** → **Run workflow**.
3. Remplis le formulaire **exactement** comme ci-dessous.
   - **Use workflow from** : `main`. Le code qui applique les migrations vient de main ; une branche ne peut pas apporter le sien.
   - **ref** :
     ```
     feat/icp-import
     ```
   - **expected_sha** : le SHA copié à l'étape 1.
   - **confirm_project_ref** :
     ```
     ggilyurgopsjrpnvxovl
     ```
4. Lance le workflow, puis approuve-le.
   - Le job attend l'approbation de l'environnement `prospectos-staging` : notification GitHub ou bandeau **Review deployments** → coche `prospectos-staging` → **Approve and deploy**.
5. Résultat attendu : job vert, et une seule migration appliquée dans le journal (`041_icp_import`).
   - Un refus (`STAGING-MIGRATE REFUSED: …`) n'applique rien : lis le motif et arrête-toi là.
6. Contrôle (Supabase → projet **-ProspectOS-staging** → SQL Editor, lecture seule) :
   ```sql
   select name, created_by from supabase_migrations.schema_migrations order by version desc limit 2;
   select to_regclass('public.icp_imports') as table_import;
   ```
   Attendu : `041_icp_import` créé par `prospectos-staging-migrate`, puis `040_morning_digest` ; `table_import` = `icp_imports`.

---

## B. Allumer l'import sur le Preview de la branche seulement

Les variables sont **limitées à la branche** `feat/icp-import`, comme celles des essais précédents (`feat/next-best-action`, `feat/ui-v2-shell`…). Aucun autre déploiement ne les reçoit.

1. Vercel → projet **prospectos-v0** → **Settings** → **Environment Variables** → **Add New**.
2. Pour **chacune** des quatre variables ci-dessous :
   - **Environments** : coche **Preview** seulement. Décoche **Production** et **Development**.
   - **Branch** : choisis « une branche précise » (custom Preview branch) et tape
     ```
     feat/icp-import
     ```

   | Key | Value | Pourquoi |
   |---|---|---|
   | `ICP_IMPORT_ENABLED` | `true` | l'interrupteur de l'import |
   | `UI_V2_ENABLED` | `true` | l'écran d'import vit dans l'interface v2, active en production mais pas sur le Preview par défaut |
   | `AI_PROVIDER` | `anthropic` | sur le Preview, la variable n'existe que pour une autre branche |
   | `AI_MODEL` | `claude-sonnet-5` | le modèle des smoke tests |

3. Vérifie la liste : chaque ligne doit afficher **Preview** et **feat/icp-import**, rien d'autre. Si une ligne affiche « Production » ou « All Preview branches », supprime-la et recommence.
4. Redéploie le Preview, car les variables ne s'appliquent qu'aux nouveaux déploiements.
   - **Deployments** → filtre **Branch** = `feat/icp-import` → le plus récent → **⋯** → **Redeploy**.
   - Ne redéploie **jamais** un déploiement marqué **Production**.
5. Ouvre l'URL du déploiement Preview, de la forme `prospectos-v0-git-feat-icp-import-….vercel.app` : copie-la depuis la page du déploiement. Si Vercel demande une connexion, connecte-toi avec ton compte Vercel.

Il n'y a pas de clé IA de plateforme : aucune variable `AI_API_KEY` n'existe dans Vercel. Le compte A utilise sa propre clé Anthropic (BYOK). Elle est chiffrée dans la base de staging avec `BYOK_MASTER_KEY`, déjà présente sur le Preview.

---

## C. Checklist avec deux comptes A et B

Prépare :
- deux adresses e-mail à toi, par exemple `toi+a@…` et `toi+b@…` ;
- deux navigateurs, ou un onglet normal et un onglet privé ;
- sur le téléphone, un PDF texte et un DOCX tirés du texte de test (étape 14), et un PDF scanné (étape 16).

Le texte de test : GitHub → `tests/fixtures/icp/detec-incendie.site-only.txt` (branche `feat/icp-import`) → **Raw** → tout sélectionner → copier.

Requêtes de contrôle : Supabase staging → SQL Editor, lecture seule. Remplace `<projet A>` par l'identifiant du projet de A (requête 0).

```sql
-- 0. les projets et leurs organisations
select p.id, p.name, p.organization_id, o.name org from public.projects p join public.organizations o on o.id=p.organization_id order by p.created_at desc limit 5;
-- 1. les imports
select id, organization_id, status, source_type, token_usage, error, created_at from public.icp_imports order by created_at desc limit 10;
-- 2. l'offre et les critères du projet de A
select p.offer, i.criteria, i.profile_validated_at, i.profile_import_id from public.projects p left join public.icps i on i.project_id=p.id where p.id='<projet A>';
-- 3. la consommation IA
select operation, provider, model, billing_source, input_tokens, output_tokens, created_at from public.api_usage_events order by created_at desc limit 5;
```

### Mise en place

- [ ] **1.** Compte **A** : inscription sur l'URL Preview, puis démarre l'essai gratuit et crée un projet « Essai import ».
- [ ] **2.** A → **Compte** → **Clé API Anthropic** : colle ta clé et enregistre.
- [ ] **3.** A → **Compte** : note le compteur **Analyses d'offre IA** (`n / limite`).
- [ ] **4.** A → **Offre et cible** : note l'offre et les critères actuels (fais une capture).
- [ ] **5.** Compte **B**, dans l'autre navigateur : inscription, essai gratuit, un projet « Projet B ».

### Import collé, revue, validation (A)

- [ ] **6.** A → **Offre et cible** → bloc **Importer mon entreprise** → **Coller un texte** → colle le texte de test → **Analyser**.
  - Attendu : les étapes défilent, puis « Relisez votre profil » en moins d'une minute.
  - Bonus : quitte la page pendant l'analyse et reviens ; le résultat doit t'attendre.
- [ ] **7.** Revue :
  - nom « Détec Incendie », services, engagements avec leur chiffre (« 24 heures »), segments ;
  - touche **Source** sur deux valeurs : chaque source est un passage du texte ;
  - les sources coupées finissent par « … » ;
  - repère un éventuel badge « source partielle ».
- [ ] **8.** Modifie un champ, par exemple **Activité** → « Installation et maintenance incendie ».
  - Attendu : sa source devient « Saisi par vous », et le bouton **Valider ce profil** reste actif.
  - Recharge la page : la modification est restaurée (« Vos modifications non validées ont été restaurées »).
- [ ] **9.** Laisse **décochés** « Garder mon offre actuelle » et « Garder mes critères actuels » → **Valider ce profil**.
  - Attendu : « Profil validé ».
- [ ] **10.** Contrôle de la réécriture.
  - **Offre et cible** : l'offre et les critères ne sont plus ceux de l'étape 4.
  - Requête 2 : `offer` contient le texte issu du profil, `criteria` est rempli, `profile_validated_at` est daté.
  - Requête 1 : l'import est `VALIDATED`.
- [ ] **11.** Quota.
  - **Compte** : **Analyses d'offre IA** = valeur de l'étape 3 **+ 1**.
  - Requête 3 : une ligne `offer_analysis` / `anthropic` / `BYOK`, avec ses tokens.

### Isolation (B)

- [ ] **12.** B → **Offre et cible** : aucun import, et ni l'offre ni le profil de A.
  - Requête 1 : les imports de A portent l'`organization_id` de A, et B n'en a aucun.
  - Facultatif : B colle l'URL d'un écran de A ; il ne doit rien voir.

### Rejet et relance (A)

- [ ] **13.** A → **Nouvel import** → colle le même texte → **Analyser** → **Rejeter**.
  - Attendu : « Brouillon rejeté — Rien n'a été modifié dans votre projet ».
  - Requête 2 : l'offre et les critères sont toujours ceux de l'étape 10.
  - Le compteur prend + 1 : l'IA a été appelée.
- [ ] **13 bis — relance après échec.**
  1. A → **Compte** → remplace la clé Anthropic par une clé fausse, par exemple `sk-ant-fausse`.
  2. **Nouvel import** → colle le texte → **Analyser**. Attendu : « L'import n'a pas abouti ».
  3. Remets la vraie clé → reviens → **Relancer** → recolle le texte, car le document n'est jamais conservé. Attendu : un nouveau brouillon.
  4. Note le compteur : il prend + 1 pour chaque import où Anthropic a été appelé (la clé fausse est refusée par Anthropic, donc appelée).
  5. **Rejeter** ce brouillon.

### Fichiers réels (A)

- [ ] **14.** Prépare les fichiers : colle le texte de test dans Google Docs ou Pages, puis exporte-le en **PDF** et en **Word (.docx)**.
- [ ] **15.** **Nouvel import** → **Fichier PDF ou Word** → le PDF → **Analyser** → brouillon, puis **Rejeter**. Recommence avec le DOCX.
  - Requête 1 : `source_type` vaut `PDF`, puis `DOCX`.
  - Aucun fichier n'est stocké : il n'y a pas de colonne de fichier, seulement le brouillon extrait.
- [ ] **16.** Scan : avec l'app Fichiers ou Notes (Numériser des documents) ou Google Drive (Scanner), photographie une page imprimée et enregistre-la en PDF → importe-la.
  - Attendu : refus immédiat « Ce PDF ne contient pas de texte lisible (document scanné ou image)… ».
  - Le compteur **ne bouge pas**, et la requête 1 ne montre **aucune** nouvelle ligne : le refus a lieu avant toute écriture et tout quota.

### Suppression RGPD (A)

- [ ] **17.** Sur l'import validé de l'étape 9 → **Supprimer cet import** → confirme.
  - Attendu : « Import supprimé ».
  - Requête 1 : la ligne a disparu.
  - Requête 2 : l'offre et les critères validés **restent** (c'est le profil de l'organisation).
- [ ] **18.** Supprime aussi les imports rejetés restants : la requête 1 ne doit plus rien montrer pour A.
- [ ] **19.** Facultatif : A → **Compte** → **Données et confidentialité** → export → le zip contient `icp_imports.json`.

Résultat : coche chaque ligne et note les écarts (capture + heure) dans la PR #66.

---

## D. Retour arrière

### D1. Couper l'import (toujours suffisant pour l'application)

1. Vercel → **Settings** → **Environment Variables** → supprime les quatre variables de la section B, celles marquées **Preview · feat/icp-import**.
2. **Deployments** → le Preview `feat/icp-import` le plus récent → **⋯** → **Redeploy**.
3. Attendu : l'écran d'import disparaît et `/api/v1/icp-imports` répond 404 `ICP_IMPORT_DISABLED`. Les données de staging restent en place.

### D2. Défaire la 041 sur le staging (seulement si nécessaire)

À faire **après** D1. C'est **destructif** : les imports et les profils validés du staging (`icps.profile`…) sont effacés. L'offre et les critères déjà écrits dans les projets restent.

1. Supabase → projet **-ProspectOS-staging**. Vérifie le ref dans l'URL : `ggilyurgopsjrpnvxovl`, **jamais** `vptqxhlxwiljfbkybqej`.
2. SQL Editor → colle le contenu de `db/rollbacks/041_icp_import.down.sql` (GitHub, branche `feat/icp-import`, **Raw**) → **Run**.
   - Ce script retire tout ce que la 041 a créé, puis la ligne `041_icp_import` de l'historique du staging : le workflow verra donc la 041 comme non appliquée.
   - Il est vérifié par `tests/icp-import-rollback-db.mjs` : après la 041 puis ce script, le schéma est identique à celui d'avant la 041, et la 041 peut être réappliquée.
3. Contrôle :
   ```sql
   select to_regclass('public.icp_imports') as table_import;
   select name from supabase_migrations.schema_migrations order by version desc limit 1;
   ```
   Attendu : `table_import` vide (null), dernière migration `040_morning_digest`.

Ce script n'est pas une migration : aucun workflow ne lit `db/rollbacks/`. Il ne s'exécute qu'à la main, dans le SQL Editor du staging.
