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
- **Correspondance des mots-clés** (`src/tenders/match.ts`, corrigé le 13 nov. 2026) : la recherche du BOAMP découpe une
  expression en mots et compare des débuts de mots (« techniques de vente » ressortait « installations techniques…
  ventilation »). Elle ne sert plus qu'à récupérer des candidats (100 au plus, tous les mots utiles de chaque mot-clé) ;
  ProspectOS garde un avis seulement si une expression entière se retrouve dans son objet :
  - mots entiers, dans le même ordre, sans tenir compte des majuscules ni des accents ; un pluriel en -s ou -x vaut le singulier ;
  - les petits mots de liaison (au, de, du, des, la, le…) peuvent varier ou manquer entre deux mots : « formation
    management » trouve « Formation au management » ;
  - un mot-clé fait seulement de petits mots est refusé (`KEYWORD_TOO_GENERIC`) ;
  - « Saint Pierre » / « Saint-Pierre » forme un seul nom : « pierre » seul ne le trouve pas ; les autres tirets séparent
    les mots (« graffitis » trouve « anti-graffitis »).
  Chaque avis indique le mot-clé qui l'a fait ressortir (`matched`). `total` compte les avis retenus parmi les candidats
  lus ; `truncated` signale que le BOAMP avait plus de candidats qu'une requête n'en lit.
- **Limite connue** : un mot entier reste un mot entier : « pierre » trouve « Pierre-Bénite » ou « Pierre Paul Rubens ».

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
