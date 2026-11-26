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

## Cédants (décision du propriétaire du 26 nov. 2026, migration 058)

Pour chaque vente, ProspectOS identifie aussi l'entreprise qui vend. Cas d'usage : les recruteurs de franchise qui cherchent
des restaurateurs ayant récemment cédé leur affaire. La règle partagée est `src/domain/bodacc-seller.ts`.

**Lecture, en mémoire seulement.** L'annonce est lue en mémoire, rien n'est stocké ni journalisé :
- d'abord la liste structurée des précédents propriétaires (`listeprecedentproprietaire`) : seulement le type de personne et, pour
  une société, son numéro d'immatriculation, avec une clé SIREN valide ;
- à défaut, le texte de l'acte, avec la même règle que la PR #105. Un SIREN n'est retenu que s'il suit « précédent / ancien
  propriétaire », « vendeur » ou « cédant » ET que le texte intermédiaire nomme une forme de société.

**Ce qui est conservé.** Uniquement :
- le SIREN du cédant société (`seller_siren`) ;
- sinon `PP` (personne physique : rien d'autre, la fiche dit « cédant : personne physique, non affiché ») ou `UNKNOWN`.

Le lien BODACC est celui de la vente.

**Enrichissement.** Le cédant est enrichi comme toute entreprise (`sirens_to_enrich`, dans tous les départements) : dénomination,
NAF, département. Une « société » que le registre connaît comme entrepreneur individuel n'est jamais affichée.

**Recherche « Entreprises ayant cédé un fonds ».** Source « Reprises de commerces (BODACC) », option « Qui chercher ». Les filtres
se combinent :
- secteur NAF du cédant (56 = restauration) ;
- zone ;
- période (30, 90, 180 ou 365 jours).

Seules les ventes ACTIVE de type VENTE_FONDS sont lues (règles de la migration 055) : fusions, apports, ventes judiciaires,
indéterminées et annonces annulées sont exclues. Jamais une société opposée à la prospection.

**Historique.** La tâche `/api/cron/sales-backfill/1` et `/2` relit chaque nuit quelques jours ouvrés de ventes, sur les 180 derniers
jours, jusqu'à les avoir tous lus. Une vente déjà stockée ne gagne que son cédant.

**Mesures**
- Échantillon de 50 annonces annotées (`tests/fixtures/bodacc-sellers-sample50.json`, personnes et dénominations masquées) :
  **50/50** SIREN cédants corrects, aucune personne physique exposée.
- Sur 90 jours d'achats en Île-de-France et en Auvergne-Rhône-Alpes : 96 % des annonces ont la liste structurée. Quand elle
  manque, le texte ne donne que l'adresse de l'ancien propriétaire, jamais un SIREN (cette adresse n'est jamais lue ni gardée).
