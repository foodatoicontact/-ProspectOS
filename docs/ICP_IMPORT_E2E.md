# Import ICP — essai de bout en bout sur le staging

Runbook à suivre depuis un téléphone, **après la fusion de la PR #66** (main = `881274e`). Il ne touche **jamais** la production. Durée : environ 45 min. Coût IA : environ 0,03 $ par import, soit 0,15 $ à 0,20 $ pour tout l'essai, payé par la clé Anthropic du compte A.

Ce qui sépare le staging de la production, vérifié le 4 novembre 2026 :

| | Staging | Production |
|---|---|---|
| Supabase | `-ProspectOS-staging` · `ggilyurgopsjrpnvxovl` | `vptqxhlxwiljfbkybqej` |
| Environnement Vercel qui y pointe | **Preview** (`NEXT_PUBLIC_SUPABASE_URL` = `https://ggilyurgopsjrpnvxovl.supabase.co/`) | **Production** (prospectos.fr) |
| 041 appliquée | non (dernière migration : 040) | non |
| `ICP_IMPORT_ENABLED` | absente | absente |

Règle d'or :
- dans Vercel, on ne choisit **jamais** « Production » ni « All Preview branches » ;
- on ne colle **jamais** le ref de production `vptqxhlxwiljfbkybqej` nulle part ;
- tout ce que l'essai crée (branche `test/icp-e2e`, variables limitées à cette branche) est supprimé à la fin (section E).

---

## A. Appliquer la 041 sur le staging

Outil : le workflow GitHub **Staging migrations** (`.github/workflows/staging-migrations.yml`). Il se lance seulement à la main, vise seulement le staging, et refuse toute URL de base qui mentionne la production.

1. GitHub → dépôt `-ProspectOS` → **Actions** → **Staging migrations** → **Run workflow**.
2. Remplis le formulaire **exactement** comme ci-dessous.
   - **Use workflow from** : `main`. Le code qui applique les migrations vient de main ; une branche ne peut pas apporter le sien.
   - **ref** :
     ```
     main
     ```
   - **expected_sha** (le commit de fusion de la PR #66) :
     ```
     881274eca8a5a3e33605d0cf76081b69a2771016
     ```
   - **confirm_project_ref** :
     ```
     ggilyurgopsjrpnvxovl
     ```
   - Si main a reçu un autre commit depuis, le workflow refuse : le SHA ne correspond plus. Rien n'est appliqué. Arrête-toi et demande le nouveau SHA à appliquer.
3. Lance le workflow, puis approuve-le.
   - Le job attend l'approbation de l'environnement `prospectos-staging` : notification GitHub ou bandeau **Review deployments** → coche `prospectos-staging` → **Approve and deploy**.
4. Résultat attendu : job vert, et une seule migration appliquée dans le journal (`041_icp_import`).
   - Un refus (`STAGING-MIGRATE REFUSED: …`) n'applique rien : lis le motif et arrête-toi là.
5. Contrôle (Supabase → projet **-ProspectOS-staging** → SQL Editor, lecture seule) :
   ```sql
   select name, created_by from supabase_migrations.schema_migrations order by version desc limit 2;
   select to_regclass('public.icp_imports') as table_import;
   ```
   Attendu : `041_icp_import` créé par `prospectos-staging-migrate`, puis `040_morning_digest` ; `table_import` = `icp_imports`.

---

## B. Allumer l'import sur le Preview d'une branche d'essai seulement

On crée une branche d'essai `test/icp-e2e` depuis main, sans aucun changement de code. Les variables sont **limitées à cette branche**. Aucun autre déploiement ne les reçoit, ni la production, ni les autres Preview.

1. **Créer la branche d'essai.**
   - GitHub → dépôt `-ProspectOS` → **Branches** (ou le sélecteur de branche) → **New branch**.
   - **Name** :
     ```
     test/icp-e2e
     ```
   - **Source** : `main`.
   - Vercel crée tout seul un déploiement **Preview** de cette branche. Ce premier déploiement n'a pas encore les variables : on le redéploiera à l'étape 4.
2. **Poser les variables.** Vercel → projet **prospectos-v0** → **Settings** → **Environment Variables** → **Add New**, une fois pour **chacune** des quatre variables du tableau. À **chaque** ajout :
   - **Environments** : coche **Preview** seulement, et décoche **Development**.
   - ⚠️ Ne choisis **jamais** « **Production** ». Ne choisis **jamais** « **All Preview branches** ».
   - **Branch** : choisis « une branche précise » (custom Preview branch) et tape exactement
     ```
     test/icp-e2e
     ```

   | Key | Value | Pourquoi |
   |---|---|---|
   | `ICP_IMPORT_ENABLED` | `true` | l'interrupteur de l'import |
   | `UI_V2_ENABLED` | `true` | l'écran d'import vit dans l'interface v2, active en production mais pas sur le Preview par défaut |
   | `AI_PROVIDER` | `anthropic` | sur le Preview, la variable n'existe que pour une autre branche |
   | `AI_MODEL` | `claude-sonnet-5` | le modèle des smoke tests |

   Rappel pour les quatre lignes : **Preview** + branche `test/icp-e2e`, **jamais** « Production », **jamais** « All Preview branches ».
3. **Vérifier la liste.**
   - Chaque nouvelle ligne doit afficher **Preview** et **test/icp-e2e**, rien d'autre.
   - Si une ligne affiche « Production », « All Preview branches » ou une autre branche, supprime-la tout de suite et recommence l'ajout.
   - Recherche `ICP_IMPORT_ENABLED` dans la liste : une seule ligne, celle de `test/icp-e2e`.
4. **Redéployer le Preview de la branche d'essai.** Les variables ne s'appliquent qu'aux nouveaux déploiements.
   - **Deployments** → filtre **Branch** = `test/icp-e2e` → le plus récent → **⋯** → **Redeploy**.
   - Ne redéploie **jamais** un déploiement marqué **Production**.
5. Ouvre l'URL de ce déploiement Preview, de la forme `prospectos-v0-git-test-icp-e2e-….vercel.app` : copie-la depuis la page du déploiement. Si Vercel demande une connexion, connecte-toi avec ton compte Vercel.

Il n'y a pas de clé IA de plateforme : aucune variable `AI_API_KEY` n'existe dans Vercel. Le compte A utilise sa propre clé Anthropic (BYOK). Elle est chiffrée dans la base de staging avec `BYOK_MASTER_KEY`, déjà présente sur le Preview.

---

## C. Checklist avec deux comptes A et B

Prépare :
- deux adresses e-mail à toi, par exemple `toi+a@…` et `toi+b@…` ;
- deux navigateurs, ou un onglet normal et un onglet privé ;
- sur le téléphone, un PDF texte et un DOCX tirés du texte de test (étape 14), et un PDF scanné (étape 16).

Le texte de test : GitHub → `tests/fixtures/icp/detec-incendie.site-only.txt` (branche `main`) → **Raw** → tout sélectionner → copier.

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

1. Vercel → **Settings** → **Environment Variables** → supprime les quatre variables de la section B, celles marquées **Preview · test/icp-e2e**. Ne touche à aucune autre ligne, surtout pas aux lignes **Production**.
2. **Deployments** → le Preview `test/icp-e2e` le plus récent → **⋯** → **Redeploy**.
3. Attendu : l'écran d'import disparaît et `/api/v1/icp-imports` répond 404 `ICP_IMPORT_DISABLED`. Les données de staging restent en place.

### D2. Défaire la 041 sur le staging (seulement si nécessaire)

À faire **après** D1. C'est **destructif** : les imports et les profils validés du staging (`icps.profile`…) sont effacés. L'offre et les critères déjà écrits dans les projets restent.

1. Supabase → projet **-ProspectOS-staging**. Vérifie le ref dans l'URL : `ggilyurgopsjrpnvxovl`, **jamais** `vptqxhlxwiljfbkybqej`.
2. SQL Editor → colle le contenu de `db/rollbacks/041_icp_import.down.sql` (GitHub, branche `main`, **Raw**) → **Run**.
   - Ce script retire tout ce que la 041 a créé, puis la ligne `041_icp_import` de l'historique du staging : le workflow verra donc la 041 comme non appliquée.
   - Il est vérifié par `tests/icp-import-rollback-db.mjs` : après la 041 puis ce script, le schéma est identique à celui d'avant la 041, et la 041 peut être réappliquée.
3. Contrôle :
   ```sql
   select to_regclass('public.icp_imports') as table_import;
   select name from supabase_migrations.schema_migrations order by version desc limit 1;
   ```
   Attendu : `table_import` vide (null), dernière migration `040_morning_digest`.

Ce script n'est pas une migration : aucun workflow ne lit `db/rollbacks/`. Il ne s'exécute qu'à la main, dans le SQL Editor du staging.

---

## E. Contrôle final (à faire à la fin de l'essai, même s'il s'est bien passé)

Rien de l'essai ne doit rester, et la production ne doit pas avoir bougé.

- [ ] **E1. Variables supprimées.**
  - Vercel → **Settings** → **Environment Variables** → supprime les quatre lignes **Preview · test/icp-e2e**, si ce n'est pas déjà fait en D1.
  - Recherche `ICP_IMPORT_ENABLED` : **aucune** ligne.
  - Recherche `test/icp-e2e` : **aucune** ligne.
- [ ] **E2. Production sans l'interrupteur.**
  - Toujours dans Vercel, aucune variable `ICP_IMPORT_ENABLED` n'existe en **Production**. C'est déjà couvert par E1, mais vérifie en filtrant sur l'environnement **Production**.
  - Aucun déploiement **Production** n'a été lancé pendant l'essai : la liste **Deployments** filtrée sur **Production** montre le même dernier déploiement qu'avant.
- [ ] **E3. La 041 est absente de la production.**
  - Supabase → projet de **production** (`vptqxhlxwiljfbkybqej`) → SQL Editor → requêtes en **lecture seule** :
    ```sql
    select count(*) as migration_041 from supabase_migrations.schema_migrations where name='041_icp_import';
    select to_regclass('public.icp_imports') as table_import;
    ```
  - Attendu : `migration_041` = **0**, et `table_import` vide (null).
  - N'exécute **rien d'autre** sur ce projet.
- [ ] **E4. Branche d'essai supprimée.**
  - GitHub → **Branches** → `test/icp-e2e` → **Delete** (icône corbeille).
  - Elle ne porte aucun commit à garder : elle a été créée depuis main sans changement.
- [ ] **E5. Staging.**
  - Décide de garder ou non la 041 sur le staging.
  - La garder ne gêne rien : sans variable, l'import reste inerte.
  - Sinon, applique D2.

