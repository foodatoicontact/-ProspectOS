# UX compacte (V2 P0-b)

Principe : **résumé d'abord, détail à la demande.** Aucune information n'est supprimée — tout ce qui est
replié reste accessible en un geste. UX uniquement : aucun changement de scoring, de mapping ICP, de
workflow de revue, de schéma ou de migration.

## Discovery
- **Historique** : 5 runs les plus récents, puis « Afficher 10 de plus » (au plus 50). L'API
  `GET /projects/:id/discovery` accepte `?limit=` (1–50) et `?offset=` ; sans paramètre, la réponse
  historique (50 runs) est inchangée. Carte compacte : date, statut, requête (2 lignes max), zone (1 ligne),
  compteurs, « Voir les résultats » / « Rejouer ». Les catégories restent visibles dans le run ouvert.
- **Dernière recherche** : requête et zone limitées à 2 lignes, date, compteurs, « Reprendre les résultats ».
- **Résultats** : ligne de synthèse (résultats · ajoutés · ignorés · non résolus ou écartés), 6 cartes
  compactes puis « Afficher 6 de plus ». Carte : nom (ou « entité non résolue »), résolution, ville, source,
  score du prospect s'il existe, état (candidat / ajouté / ignoré / non résolu), actions pertinentes
  seulement ; le reste dans « Voir le détail ».
- **Retour depuis un prospect** : même run, même nombre de résultats affichés, même position.

## Fiche prospect
Ordre : en-tête → **Synthèse** (critères avec signaux, vérifiés, à confirmer, manquants — dérivée de
l'état existant, sans nouveau score) → score / couverture → coordonnées → ICP (une ligne par critère ;
un tap ouvre ses preuves) → preuves à confirmer → autres informations → détails techniques.

- Par critère : la **meilleure preuve** (à confirmer d'abord, puis la plus sûre ; en cas de quasi-doublon,
  la version la plus complète), puis « Voir les autres preuves (N) » replié.
- « Autres informations trouvées (N) » repliée, puis 3 à la fois.
- Détails techniques toujours repliés ; l'extrait exact lu y reste disponible mot pour mot.
- **Contacts** : un téléphone ou un e-mail collé au texte voisin (« 06.26.16.24.94Du Lundi au Samedi »)
  est affiché séparé et lisible (« Téléphone : 06 26 16 24 94 ») ; le stockage n'est pas modifié.
- **Analyse impossible** : une carte compacte (échec, raison générique, « Réessayer »), sans bloc de critères
  vide et sans signal inventé.

## Mobile (390 px)
Aucun débordement horizontal, cibles tactiles ≥ 44 px sur les nouveaux contrôles, textes longs coupés ou
limités, marge basse `safe-area` pour la barre Safari.
