# Tri des annonces BODACC « Ventes et cessions »

Règle unique : `src/domain/bodacc-purchase.ts`, utilisée par la recherche de repreneurs, la veille (signaux), la collecte
nationale et les chiffres publics. Décisions du propriétaire du 25 nov. 2026.

## Ce que la règle lit

| Donnée | Lue | Conservée |
|---|---|---|
| Catégorie de la vente (`acte.vente.categorieVente`) | oui | non (sauf la catégorie affichée sur une fiche de la recherche) |
| Origine du fonds (`origineFonds`) | oui | non |
| Texte de l'acte (`acte.descriptif`) | oui, en mémoire, par motifs fixes | **jamais** : ni en base, ni dans les journaux, ni dans une erreur |
| Résultat | — | une catégorie et l'identifiant de la règle qui a décidé |

Aucun appel à une IA par annonce. Aucun nom extrait. Un test vérifie qu'aucune sortie de la règle ne contient de texte de
l'acte, que le module n'écrit aucun journal et ne lève aucune erreur.

## Catégories

| Catégorie | Règles |
|---|---|
| `PURCHASE` — rachat | `category_purchase`, `start_after_purchase`, `origin_purchase`, `text_sale` |
| `CONTRIBUTION` — apport, donation, attribution | `origin_contribution`, `category_contribution`, `text_contribution` |
| `MERGER` — fusion, scission, transformation transfrontalière | `origin_merger`, `text_merger` |
| `FORCED_SALE` — cession ordonnée en procédure collective | `origin_forced`, `text_forced` |
| `UNDETERMINED` — indéterminé | `text_head_office_move`, `no_rule` |

## Mesure (avant merge)

Échantillon : les 4 893 annonces initiales « Ventes et cessions » parues du 26 oct. au 24 nov. 2026, France entière.
Référence : un tri par script, puis **relecture à la main de chaque annonce où une règle et la référence divergent**. Cette
relecture a corrigé la référence sur 15 annonces :

- 7 « projets de transformation transfrontalière » (transfert de siège à l'étranger) comptées à tort comme des ventes ;
- 1 vente de pharmacie comptée à tort comme judiciaire (ses « livres d'ordonnances ») ;
- 3 transferts de siège classés « Achat d'un établissement » par le greffe ;
- 4 vraies ventes que le script avait manquées (formule « ancien propriétaire / nouveau propriétaire », oppositions de
  l'article L.141-12).

Positif = rachat.

| Règle | Vrais positifs | Faux positifs | Faux négatifs | Précision | Rappel | Ventes judiciaires repérées |
|---|---|---|---|---|---|---|
| PR #105 (catégorie + origine) | 2 433 | 22 | 11 | 99,10 % | 99,55 % | 22 / 34 |
| Avec le texte de l'acte | 2 444 | 7 | 0 | 99,71 % | 100 % | 34 / 34 |

- Aucun nouveau faux positif : les 7 restants l'étaient déjà avec la PR #105. Ce sont des annonces « Achat d'un
  établissement principal » sans origine du fonds et sans aucun texte : la catégorie officielle est la seule information,
  elles ne sont pas vérifiables.
- Les 26 cas visés au départ (13 rachats manqués, 13 ventes judiciaires non vues) : 7 rachats récupérés, 12 ventes
  judiciaires repérées ; les 7 autres étaient des erreurs de la référence (6 transformations, la pharmacie), désormais bien
  classées. 4 rachats de plus, que la référence avait aussi manqués, sont récupérés.

Répartition de l'échantillon : 2 451 rachats, 2 255 fusions et restructurations, 136 apports, 34 ventes judiciaires,
17 indéterminées.

## Doublons

Une même société n'est comptée qu'une fois sur 30 jours (`DUPLICATE_WINDOW_DAYS`) : l'annonce « Achat… » et la
« Mise en activité… » de la société créée pour le rachat, ou la même annonce déposée par deux greffes. Une annonce sans
numéro RCS n'est jamais fusionnée. La base nationale (`public_events`) garde une ligne par annonce ; la liste de leads
regroupe déjà par SIREN.

## Contrôle hebdomadaire

Chaque collecte enregistre combien d'annonces chaque règle a décidé (migration 054, identifiants et nombres uniquement).
Le lundi, `/api/cron/bodacc-quality` compare la semaine aux 4 précédentes et alerte si :

- moins de 50 annonces ont été collectées dans la semaine ;
- une règle inconnue apparaît ;
- plus de 3 % des annonces sont indéterminées ;
- la part d'une catégorie bouge de plus de 10 points.

L'alerte est écrite dans les journaux Vercel (niveau warning) et envoyée par e-mail à `OPS_ALERT_EMAIL` si cette variable
et la configuration SMTP sont présentes.

## Annulations et rectificatifs

- La collecte lit les avis d'annulation et de rectificatif de toutes les familles
  (ventes, créations, modifications y compris les transferts de siège), pas
  seulement ceux qui reprennent le libellé de la famille.
- Une annulation passe l'annonce visée au statut « Annulée » (lien vers l'avis
  qui l'annule) ; un rectificatif la passe à « Rectifiée ». Rien n'est supprimé.
- La recherche de repreneurs et le chiffre public des rachats ignorent un rachat
  annulé par un avis présent dans la même lecture.
- Rattrapage du 26 nov. 2026 : 1 620 annulations et rectificatifs publiés depuis
  mai relus ; 24 visaient une annonce en base, 6 statuts corrigés
  (lot `5a1e0002-0055-4000-8000-0000000000a1`). Les 831 rachats antérieurs à la
  règle partagée ont reçu leur règle de tri (lot `5a1e0003-…-0000000000a1`),
  réversibles avec `revert_public_event_batch`.
