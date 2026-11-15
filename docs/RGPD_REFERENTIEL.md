# Registre des traitements — référentiel des entreprises et des listes

Fiche du registre (article 30 du RGPD) pour la collecte nationale (migration 045) et le référentiel des listes (migration 046).

| Rubrique | Contenu |
|---|---|
| Responsable du traitement | Kevin Cardia EI (ProspectOS), SIREN 106 540 453, contact@prospectos.fr |
| Finalité | Constituer un référentiel d'**entreprises** et d'événements publics datés et sourcés, pour produire les listes de la veille dédiée et éviter de livrer deux fois la même entreprise à un même client. |
| Personnes concernées | Aucune personne physique. Le référentiel ne contient que des **personnes morales**. |
| Données traitées | SIREN, dénomination, code d'activité (NAF), forme juridique, tranche d'effectif, état (active ou fermée), département et commune du siège, événements publiés (type, date, lien vers la publication officielle), listes produites (titre, objet, zone, date, entreprises dans l'ordre). |
| Données exclues | Dirigeants (nom, qualité), adresses personnelles, dates de naissance, nationalité, entrepreneurs individuels, entreprises opposées à la prospection commerciale. Une annonce qui concerne une personne physique n'est jamais enregistrée : elle est seulement comptée. |
| Sources | BODACC (DILA), base des installations classées (Géorisques), API Recherche d'entreprises (INSEE / INPI, DINUM). Toutes sont des données publiques officielles sous Licence Ouverte. |
| Base légale | Intérêt légitime : prospection entre entreprises, sur des données publiques de personnes morales. |
| Destinataires | Le seul administrateur de ProspectOS. Aucun rôle navigateur n'accède aux tables : seuls le serveur et les fonctions réservées à l'administrateur y ont accès. Un client ne reçoit que la liste qui lui est livrée. |
| Durées de conservation | Annonces : purge au-delà de la date choisie, avec au moins 30 jours de recul (`purge_public_events`). Fiches entreprises : rafraîchies au bout de 30 jours, supprimées 90 jours après leur expiration. Listes : 3 ans après leur production (`purge_prospect_lists`). |
| Sécurité | RLS activée sans politique d'accès pour les navigateurs. Fonctions `security definer` à `search_path` vide. Écritures réservées à `service_role`. Lecture des listes réservée au droit `INTERNAL` actif. |
| Transferts hors UE | Hébergement Supabase et Vercel, comme le reste de ProspectOS (voir la politique de confidentialité). |

## Ce qui reste dans la liste livrée, et seulement là

Une liste livrée à un client peut contenir le nom et la qualité d'un dirigeant, s'il l'a demandé, tirés des registres publics. Ces informations restent dans **cette** liste, sous la responsabilité de ce client, et ne sont jamais reprises dans le référentiel commun.

## Vérifications automatiques

- `tests/public-events-db.mjs` : aucun accès navigateur ; aucun nom d'entrepreneur individuel conservé ; purge.
- `tests/prospect-lists-db.mjs` : les entrepreneurs individuels et les entreprises opposées à la prospection sont écartés et comptés, sans rien stocker à leur sujet ; seul l'administrateur lit les listes ; suppression au bout de 3 ans.
