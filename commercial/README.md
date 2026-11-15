# Propositions et devis — Veille dédiée

Générateur de documents pour la **Veille dédiée** : une liste préparée pour un client et livrée à la fréquence convenue.
Les CGV du site ne couvrent que les abonnements en libre-service. Chaque document joint donc ses propres
**conditions particulières** (`conditions-veille.md`). Elles sont **à faire relire par un juriste avant la première signature**.

## Fichiers

| Fichier | Versionné | Contenu |
|---|---|---|
| `vendeur.json` | oui | Identité du vendeur, **valeurs vides** : aucun identifiant n'est inventé. |
| `vendeur.local.json` | **non** (`.gitignore`) | Les valeurs réelles, une fois l'immatriculation finalisée, et l'IBAN. Elles complètent `vendeur.json` champ par champ. |
| `clients/exemple.json` | oui | Client **fictif**, modèle à copier. |
| `clients/<slug>.json` | **non** | Un fichier par client (alexandre, sajil, greg…). |
| `sortie/` | **non** | Les PDF produits. |
| `.compteur-devis.json` | **non** | Le dernier numéro de devis attribué, par année. |

## Commandes

```bash
cp commercial/clients/exemple.json commercial/clients/alexandre.json   # puis compléter
npm run devis -- --client alexandre                    # proposition commerciale (par défaut)
npm run devis -- --client alexandre --mode devis       # devis numéroté DEV-AAAA-NNNN
npm run devis -- --client alexandre --date 2026-11-20  # date du document (aujourd'hui par défaut)
```

- **Proposition** : utilisable sans SIREN. Elle porte la mention « Société en cours d'immatriculation », sans numéro
  ni zone de signature, avec en pied de page : « Document non contractuel. Un devis vous sera adressé dès
  l'immatriculation finalisée. »
- **Devis** : refusé, avec la liste des champs manquants, tant que la dénomination, le SIREN, le RCS, la forme
  juridique, l'adresse ou le régime de TVA du vendeur sont vides. Il faut aussi le capital pour une société et le
  numéro de TVA si le vendeur est assujetti. Le numéro n'est consommé qu'une fois le PDF produit.

## Fiche client

`regions` donne une ligne par région. `prix_ht_par_region_par_mois` est en euros. `mois_offerts` crée une ligne de
remise (« Premier mois offert »). `engagement` vaut `mensuel` (le devis chiffre `nombre_mois` mois, 1 par défaut) ou
`annuel` (12 mois, dont 2 offerts). `frequence` est un texte libre, par exemple « chaque lundi ».

## Formule mixte (minimum garanti + commission)

`"formule": "mixte"` remplace le prix par région par `minimum_garanti_ht_par_mois` et `commission_ht_par_client`.
Elle est mensuelle uniquement. Facultatifs : `fenetre_attribution_mois` (6 par défaut) et `delai_clients_connus_jours`
(15 par défaut). Chaque mois, le montant facturé est le plus élevé des deux : le minimum, ou la somme des commissions
dues. Le document ajoute une section « Rémunération au résultat et suivi » et joint la clause `conditions-apport.md`,
elle aussi à faire relire par un juriste.

## Entrepreneur individuel

Si `forme_juridique` indique un entrepreneur individuel, la dénomination doit contenir « EI » ou « entrepreneur
individuel », par exemple « Kevin Cardia EI ». C'est une mention obligatoire sur tout document. Sinon, le devis est refusé.
Une proposition émise avec un SIREN ne porte pas la mention « en cours d'immatriculation ».

## TVA

Dans `vendeur.local.json`, `tva.regime` vaut `franchise` (mention « TVA non applicable, art. 293 B du CGI ») ou
`assujetti`, avec `tva.numero` et `tva.taux` (20 par défaut).

Les calculs sont faits en centimes. Les tests sont dans `tests/devis.test.ts`.

## Listes livrées (veille dédiée)

Les listes envoyées au client gardent le gabarit des PDF déjà livrés : couverture, « L'essentiel en une page », une section par signal, des cartes sur deux colonnes, « Méthode & sources ». Le même gabarit sert à l'espace de suivi de ProspectOS.

```bash
npm run livraison -- --livraison <nom>
```

La commande lit `commercial/livraisons/<nom>.json`. Ce dossier est ignoré par git, sauf `exemple.json`, qui est fictif. Elle écrit dans `commercial/sortie/` :

- `<nom>.pdf` : le PDF à envoyer au client ;
- `<nom>.import.json` : le fichier d'import de l'espace de suivi.

Dans ProspectOS, ouvrir « Veille dédiée — clients » → « Nouvelle livraison » et joindre ces deux fichiers.

- **Numérotation** : la fiche n de l'outil est la n-ième carte du PDF, dans l'ordre du document (référence `L<livraison>-F<n>`).
- **Fiches** : chaque fiche reprend les mêmes champs, dans le même ordre et avec les mêmes intitulés que la carte du PDF. Le statut et le journal s'ajoutent en bas de la carte.
- **Export PDF depuis l'outil** : il rend le PDF envoyé, à l'identique, avec seulement un filigrane et le numéro de livraison en plus. C'est une mise à jour incrémentale : les octets d'origine restent le début exact du fichier.
- **Style** : il est défini une seule fois, dans `src/dedicated/livraison-style.ts`. Le générateur l'écrit tel quel ; l'application l'applique dans son propre bloc.
- **SIREN déjà livré** : une entreprise déjà livrée à ce client est refusée, pour que les numéros restent ceux du document. Il faut la retirer du fichier et régénérer le PDF.
