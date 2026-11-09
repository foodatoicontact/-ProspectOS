# Appels d'offres ouverts (BOAMP)

ProspectOS liste les **marchés publics auxquels on peut encore répondre**, publiés au BOAMP (Bulletin officiel des
annonces des marchés publics, DILA, données ouvertes). C'est une liste d'opportunités en lecture seule : chaque ligne
renvoie à l'avis officiel ; rien n'est enregistré, envoyé ni répondu à la place de la personne.

## Ce que fait la fonction

- **Recherche** : des mots-clés (cherchés dans l'objet de l'avis, 5 au plus) et des départements (13 au plus).
- **Résultat** : les avis de nature `APPEL_OFFRE` dont la date limite de réponse est à venir, triés par date limite,
  50 au plus, avec l'acheteur public, l'objet, les départements, le type de marché, les descripteurs, la procédure et
  le lien vers l'avis officiel (`https://www.boamp.fr/pages/avis/?q=idweb:…`).
- **Écran** : bloc « Appels d'offres ouverts » en haut de « Recherche » (interface v2, compte réel, projet ouvert). La
  dernière recherche d'un projet est retenue dans le navigateur seulement.
- **Limite connue** : un mot-clé est cherché dans l'objet ; « pierre » trouve aussi « Saint-Pierre ». L'écran le dit.

## Sécurité et données

- Hôte fixe (`boamp-datadila.opendatasoft.com`), taille de réponse (2 Mo) et durée (15 s) bornées, redirections refusées.
- Mots-clés et codes de département validés avant d'entrer dans la requête : guillemets, parenthèses et opérateurs sont
  refusés, rien de ce qui est saisi ne peut changer la structure de la requête.
- Seuls les champs publics de l'avis sont demandés : jamais les blocs `donnees` / `gestion` (qui peuvent contenir un
  contact nominatif de l'acheteur) ni `titulaire`.
- Le journal serveur garde des nombres (mots-clés, départements, résultats), jamais les mots saisis.

## Activation

Interrupteur serveur `TENDERS_ENABLED` (absent = désactivé). Désactivé : `GET /api/v1/tenders` répond 404
`TENDERS_DISABLED` avant toute lecture, et le bloc ne s'affiche pas (il interroge d'abord la route sans paramètre ;
cette sonde ne contacte jamais le BOAMP). Activé : un droit d'accès actif est requis ; **aucun quota consommé** (pas
d'IA, source gratuite). Aucune migration, aucune écriture en base.

Ordre conseillé : Preview d'une branche d'essai (variable limitée à cette branche), puis production.

## Tests

`tests/tenders.test.ts` (requête, refus d'injection, lecture d'une vraie réponse du BOAMP — 6 avis de Gironde, champs
publics, 9 novembre 2026 —, sources indisponibles, interrupteur, route, écran).
