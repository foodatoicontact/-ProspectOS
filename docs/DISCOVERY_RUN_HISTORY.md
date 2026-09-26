# Historique des recherches Discovery

Chaque recherche est un `discovery_runs` distinct avec ses `discovery_results` : rien n'est écrasé quand
une nouvelle recherche est lancée (ex. « Avignon strict » puis « zone élargie » restent comparables).
Aucune migration : les tables existantes portent tout (requête, zone, catégories, fournisseur,
`filters_json.max_results`, statut, dates, nombre de résultats, statut de chaque candidat, `prospect_id`).

## API (lecture seule, RLS `is_member`)

| Route | Rôle |
|---|---|
| `GET /api/v1/projects/:id/discovery` (nouvelle) | runs du projet, du plus récent au plus ancien (50 max), + nombre de candidats ajoutés / ignorés |
| `GET /api/v1/discovery-runs/:id/results` (existante) | résultats d'un run, dans leur état actuel |

Aucun appel fournisseur, aucune consommation, aucune écriture. La réponse ne renvoie pas l'offre/l'ICP
enregistrés avec le run.

## Écran Discovery

- **Dernière recherche** → [Reprendre les résultats] (ouvre le dernier run, sans rien relancer).
- **Historique des recherches** : cartes compactes (date, requête · zone, catégories, statut, source,
  résultats, ajoutés/ignorés) → [Voir les résultats] (GET uniquement) · [Rejouer la recherche]
  (préremplit requête, zone, catégories, nombre max, source si encore disponible — **rien n'est lancé**
  tant que « Lancer la recherche » n'est pas cliqué).
- Statuts : Terminée · Échec de la recherche · En cours · Interrompue (run resté « running » plus de 15 min,
  affichage seulement).
- Candidat déjà ajouté : « Ajouté au projet » + [Voir le prospect] (pas de bouton d'ajout) et le score
  actuel du prospect (moteur existant, preuves vérifiées uniquement).

## Navigation

Le run ouvert est mémorisé par projet (état de la page) : ouvrir un prospect depuis Discovery puis revenir
(bouton « ← Retour à la recherche », geste retour iOS / bouton retour du navigateur grâce à une entrée
d'historique, ou menu) réaffiche le même run, avec la position de défilement. Mode démo : historique conservé
dans ce navigateur (`localStorage`), jamais sur un serveur.
