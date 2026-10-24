# Registres publics d'une fiche

Bouton « Registres publics » dans le bloc des observations d'une fiche. Il interroge deux sources ouvertes, toutes deux sous Licence Ouverte 2.0 :

| Source | Accès | Ce qui en sort |
|---|---|---|
| Registre des entreprises : INSEE Sirene / RNE | `recherche-entreprises.api.gouv.fr`, page de preuve `annuaire-entreprises.data.gouv.fr/entreprise/<SIREN>` | identité, siège, tranche d'effectif, dirigeants |
| Données essentielles de la commande publique (DECP consolidées) | `tabular-api.data.gouv.fr`, jeu `608c055b35eb4e6ee20eb325`, ressource `decp.csv` | marchés publics attribués au SIRET du siège (5 dernières années) |

Code :
- `src/discovery/public-records.ts` : logique pure (identification, lecture, observations) ;
- `src/discovery/public-records-api.ts` : route `POST /api/v1/prospects/:id/registry` ;
- `src/components/PublicRecordsControl.tsx` : interface.

## Règles

- **Identité, jamais devinée.** Le SIREN vient, dans cet ordre :
  1. du corps de la requête, c'est-à-dire du choix d'une personne parmi les candidats, ou d'une saisie (le SIREN figure dans les mentions légales du site) ;
  2. d'une identification précédente de la même fiche, lue dans l'URL source de l'observation `REGISTRY_IDENTITY` (si deux SIREN différents ont été enregistrés, la question est reposée) ;
  3. d'une correspondance de nom **exacte**, hors forme juridique (SA, SAS, SOC…), **unique**, et dans la ville de la fiche quand elle est connue.

  Dans tous les autres cas, la route répond `{identity_required: true, candidates}` : rien n'est consommé ni enregistré.
- **Preuves, jamais validées automatiquement.** Chaque fait devient une observation `OBSERVED`, de type de source `public_directory`. Sa preuve est `NOT_VERIFIED` et ne compte au score qu'après confirmation humaine.
- **Rattachement aux critères** par les intentions existantes (`icp-intents.ts`) :
  - `HEADCOUNT` : la tranche INSEE est comparée **en entier** à la fourchette du critère. Entièrement dedans : critère rempli. Entièrement dehors : non rempli. À cheval : simple contexte.
  - `PUBLIC_PROCUREMENT` : les 3 derniers marchés.
  - `PUBLIC_REFERENCE` : le dernier marché de chacun des 3 derniers acheteurs distincts.
  - `DECISION_MAKER` : les fonctions de direction (président, gérant, directeur général…), jamais un administrateur ni un commissaire aux comptes.

  Un fait qui ne correspond à aucun critère reste en contexte : aucun critère n'est inventé.
- **Données personnelles.** Pour une entreprise non diffusible (`statut_diffusion` ≠ `O`), ni dirigeants ni adresse. La date de naissance d'un dirigeant n'est jamais lue.
- **Montants jamais cités.** Le montant DECP est celui du marché entier, souvent partagé entre plusieurs titulaires ou découpé en lots.
- **Marchés publics.** Les lignes d'un même contrat (`uid`) comptent une fois, et un même objet publié par deux entités d'un acheteur aussi. Seul le SIRET exact du siège est interrogé : c'est le seul filtre indexé, donc assez rapide. Les marchés tenus par un autre établissement ne remontent pas.
- **Robustesse.** Seuls des hôtes fixes sont appelés. Les redirections sont refusées. Une réponse est limitée à 2 Mo, avec un délai de 10 s (25 s pour les DECP). Une réponse sans sa liste attendue compte comme « indisponible », jamais comme « aucun résultat ». Si les DECP sont indisponibles, les faits du registre sont quand même enregistrés, et l'écran le signale.
- **Abonnement et quota**, comme « Analyser le site » : abonnement actif requis, une unité d'analyse réservée une fois l'entreprise identifiée, rendue si la lecture échoue ensuite.

Tests : `tests/public-records.test.ts` (logique, fausses API) et `tests/public-records-db.mjs` (PGlite, chaîne de migrations complète, `npm run test:public-records-db`).
