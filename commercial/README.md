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

## TVA

Dans `vendeur.local.json`, `tva.regime` vaut `franchise` (mention « TVA non applicable, art. 293 B du CGI ») ou
`assujetti`, avec `tva.numero` et `tva.taux` (20 par défaut).

Les calculs sont faits en centimes. Les tests sont dans `tests/devis.test.ts`.
