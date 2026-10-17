# Modèle géographique générique (France et international)

`src/geo/` — additif et rétrocompatible : aucune migration, aucune colonne modifiée. Discovery France (`geo-fr.ts`,
registre SIRENE / NAF, BODACC) n'est pas touché.

## Audit (2026-10-17)

| Donnée | Stockage actuel |
|---|---|
| Pays | aucune colonne ; `optional_filters.country` (ISO, marché Brave) et `market.ts` |
| Région / département / ville / code postal | aucune colonne générique ; `geo-fr.ts` (code) ; `registry/zone.ts` (SIRENE) |
| Localisation ICP | `icps.criteria` → `target_fit.locations: string[]` (texte saisi) |
| Localisation prospect | `prospects.city` (texte) |
| Localisation signal | `signals.raw_metadata.location` = `{text, departments[], regions[]}` (Signal-first, France) |
| Candidats Signal-first | `location_departments[]`, `location_regions[]` (030) |
| Filtres Discovery | `location` (texte) + `country` ISO optionnel |

Conclusion : une abstraction générique s'ajoute sans migration ; les données France existantes sont lues par un
adaptateur.

## Modèle

```
GeoPlace = { country (ISO 3166-1 alpha-2), admin_area_level_1?, admin_area_level_2?, locality?, postal_code?, label? }
```

- Les niveaux administratifs sont des **codes opaques** (ISO 3166-2 quand il existe) : `FR-OCC` / `FR-31`, `BE-BRU`,
  `ES-CT` / `ES-B`, `MA-06`. Aucune règle métier ne connaît « région » ou « département ».
- **Appartenance** niveau par niveau depuis le pays : un lieu du périmètre contient un lieu si chaque niveau qu'il définit
  est égal ; un niveau requis mais inconnu donne « inconnu ». Jamais de recherche de texte (la localité est comparée par
  égalité de nom normalisé, sous des parents égaux).
- **SIGNAL_GEO_RELEVANCE** : MATCH (tous les lieux du signal dans le périmètre) ; MISMATCH (lieux connus, tous hors du
  périmètre : aucun TIMING pour cet ICP) ; UNKNOWN (pas de périmètre, pas de lieu structuré, précision insuffisante, ou
  lieux contradictoires) — jamais transformé en MATCH.

| Exemple | Lieu |
|---|---|
| France > Occitanie > Haute-Garonne > Toulouse | `FR / FR-OCC / FR-31 / toulouse` |
| Belgique > Bruxelles-Capitale > Bruxelles | `BE / BE-BRU / — / bruxelles` |
| Espagne > Catalogne > Barcelone | `ES / ES-CT / ES-B / barcelona` |
| Maroc > Casablanca-Settat > Casablanca | `MA / MA-06 / — / casablanca` |

## Sources des lieux

- **ICP** : `target_fit.locations` résolues par `gazetteer.ts` — noms exacts uniquement ; un chemin
  (« France / Occitanie / Toulouse », « Espagne > Catalogne ») garde le lieu le plus précis ; un homonyme sur deux lieux
  distincts n'est pas résolu. Couverture : pays (liste ISO), toute la France via l'adaptateur (régions, départements,
  préfectures), un petit amorçage étranger (BE, ES, MA). Une commune française plus petite saisie dans l'ICP n'est pas
  résolue (pas de zone, signaux UNKNOWN).
- **Signal** : `raw_metadata.geo` (générique, un lieu ou une liste — format cible pour tout futur provider) ; sinon,
  pour Signal-first France, `raw_metadata.location` traduit par `fr.ts` (département → `FR-xx`, ville seulement si elle
  est la préfecture). Un texte seul n'est jamais comparé.

## Futur modèle de providers Discovery (documenté, rien d'activé)

```
COUNTRY = FR  → providers France existants (SIRENE / NAF, BODACC, sites officiels) + web
COUNTRY ≠ FR  → web / sources publiques
               + adaptateur registre propre au pays quand il existe (aucun n'est ajouté ici)
```

- Une entreprise n'a pas forcément SIREN, SIRET, NAF ni département : ce sont des **attributs du provider France**
  (identifiants propres à un pays), jamais des prérequis universels. Un futur adaptateur pays fournit ses propres
  identifiants (ex. numéro BCE en Belgique) et son propre `GeoPlace`.
- Chaque adaptateur pays ajoute ses noms au gazetteer et traduit sa localisation vers `GeoPlace`, comme `fr.ts`.
- Rien de tout cela n'est activé : pas de nouveau pays, pas de provider payant, pas de recherche internationale, pas de
  changement de quota.
