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

## Desktop (P0-b desktop hardening)

Le desktop n'est pas un mobile élargi : **un seul DOM**, deux mises en page. Aucune logique métier
dupliquée ni modifiée (score, statuts, preuves, API inchangés) ; seule la taille de page des résultats
dépend de la largeur (6 sur téléphone, 20 dès 1024 px).

| Largeur | Discovery | Historique | Fiche prospect |
|---|---|---|---|
| < 1024 px | cartes compactes (inchangé) | cartes, 5 puis +10 | une colonne ; ordre CSS : en-tête, synthèse, couverture, coordonnées, ICP, preuves |
| 1024–1599 px | tableau dense : Acteur · Zone · Statut · (Résolution ≥ 1280) · Source/score · Action | tableau d'une ligne par run (date, requête, zone, statut, résultats, action) ; sans run ouvert il passe avant le formulaire | 2 colonnes dès que la fiche fait 700 px (container query) |
| ≥ 1600 px | tableau dense | colonne latérale de 320 px | idem |

- Fiche : colonne principale = en-tête, synthèse, ICP, preuves, message ; colonne secondaire (250 px) =
  couverture, statut/décision, coordonnées, historique. Sticky **uniquement** si sa hauteur tient dans la
  fenêtre (`ResizeObserver`).
- Preuves : un en-tête d'une ligne (critère, nombre de preuves, état), l'extrait, la source ; sur un
  conteneur ≥ 460 px les actions passent à droite de la preuve. Preuves supplémentaires repliées.
- « Voir le détail » d'un résultat reste sous le nom ; ouvert, le détail prend toute la largeur.
- Clavier : anneau `:focus-visible` sur tout élément interactif ; rien d'essentiel au survol seul.
- Wrappers `display:contents` sous les points de rupture : l'ordre mobile est conservé sans dupliquer le DOM.

Mesures (mode live simulé, 20 runs / 20 résultats, fixtures réelles Pilates / Mouvement) :

| | 1440×900 avant (6bd64c9) | 1440×900 après | 1366×768 après | 1920×1080 après |
|---|---|---|---|---|
| Lignes d'historique visibles sans scroll | 0 | 5 / 5 affichées | 5 / 5 | 5 / 5 |
| Résultats visibles sans scroll | 0 | 7 | 4 | 10 |
| Fiche : nom, statut, synthèse, score, couverture, coordonnées | partiel (statut 0) | tous | tous | tous |
| Fiche : critères ICP visibles sans scroll | 0 | 5 | 2 | 5 |
| Débordement horizontal | 0 | 0 | 0 | 0 |
