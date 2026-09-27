# ProspectOS — Executive Overview

## En une phrase

ProspectOS est un moteur de prospection B2B evidence-first : il découvre des entreprises, garde la mémoire
de ce que l'équipe connaît déjà, collecte des signaux publics sourcés et ne compte dans le score que ce
qu'un humain a vérifié.

## Problème métier

Les équipes commerciales passent un temps important à constituer et qualifier des listes de comptes :

- les mêmes entreprises reviennent d'une recherche à l'autre ;
- une partie des résultats n'est pas exploitable (annuaires, articles, pages sans rapport) ;
- la qualification repose sur des recherches manuelles peu traçables ;
- les scores fournis par les outils sont rarement explicables ;
- une recommandation arrive rarement avec la preuve qui la justifie.

Le résultat : du temps commercial consommé avant le premier échange, et une confiance limitée dans les
listes produites.

## Ce que fait ProspectOS

1. **Cadre le besoin** : offre, profil client idéal (ICP) sous forme de critères pondérés.
2. **Découvre des acteurs** dans une zone et un secteur donnés, en écartant les sources non exploitables.
3. **Se souvient** des acteurs déjà vus, déjà ajoutés ou écartés dans le projet.
4. **Collecte des signaux publics** sur les sites des entreprises retenues, avec la source de chaque
   extrait.
5. **Propose** un rattachement de ces signaux aux critères de l'ICP, sans jamais les valider lui-même.
6. **Calcule un score explicable**, critère par critère, sur les seules preuves confirmées par un humain.
7. **Prépare l'activation** : message factuel fondé sur les preuves vérifiées, envoyé par l'utilisateur.

## Ce qui le différencie

- **Evidence-first** : chaque signal est relié à une URL, un extrait et une date. Une absence
  d'information reste « inconnue ».
- **Mémoire** : chaque recherche est comparée à tout l'historique du projet ; un acteur déjà ajouté n'est
  jamais recréé.
- **Nouveauté** : chaque résultat est classé nouveau, déjà vu, déjà ajouté ou ignoré ; une recherche
  approfondie peut explorer d'autres variantes dans un budget borné et dit pourquoi elle s'arrête.
- **Explicabilité** : le score se décompose par critère, avec la preuve qui l'étaye ou la mention
  « à confirmer ».
- **Human-in-the-loop** : aucune preuve n'est validée automatiquement ; aucun message n'est envoyé
  automatiquement.

## Cas d'usage

- Cartographie d'un marché local : qui est actif, où, avec quels signaux.
- Prospection géographique : acteurs d'un secteur dans une ville ou une zone.
- Prospection verticale : un type d'établissement ou de société sur un territoire.
- Sourcing d'entreprises : partenaires, distributeurs, prestataires.
- Qualification de comptes : documenter, critère par critère, pourquoi un compte correspond.
- Préparation commerciale : base de comptes qualifiés, sources à l'appui, prête pour le premier contact.

## Exemple générique

Une équipe veut identifier les acteurs actifs d'un secteur dans une zone donnée.

1. Elle décrit sa cible et ses critères (activité réelle, capacité, canal de contact, par exemple).
2. ProspectOS remonte les entreprises trouvées, distingue celles déjà connues du projet de celles jamais
   vues, et écarte les annuaires et articles.
3. L'équipe ajoute les entreprises pertinentes ; ProspectOS analyse leurs pages publiques et propose des
   signaux rattachés aux critères, avec l'extrait exact.
4. Un membre de l'équipe confirme ou contredit chaque signal utile ; le score se construit sur ces seules
   confirmations.
5. Quelques semaines plus tard, une nouvelle recherche sur le même marché fait ressortir en priorité les
   acteurs que l'équipe n'a pas encore vus.

## Gouvernance

**Sources publiques + preuves + validation humaine + auditabilité.**

- Uniquement des sources publiques, via une API de recherche officielle et l'analyse bornée de sites
  autorisés par le serveur.
- Chaque preuve garde sa source, son extrait, sa date et l'identité de la personne qui l'a confirmée.
- Données isolées par organisation au niveau de la base de données.
- Historique des recherches, des décisions et des analyses conservé et consultable.
- Aucune automatisation LinkedIn, aucun envoi automatique.

Détail technique : [Architecture, sécurité et gouvernance](DSI-SECURITY-ARCHITECTURE.md).

## Maturité

**Bêta**, accès contrôlé. Le produit est déployé et utilisé sur des cas réels de prospection ; ses
fonctionnalités sont couvertes par des tests automatisés, y compris l'isolation des données sur un vrai
moteur PostgreSQL. Il ne dispose pas à ce jour de certification de sécurité ni d'engagement de niveau de
service contractuel.

## Indicateurs mesurés

Les tests sur cas réels suivent :

- **couverture** : les acteurs attendus ressortent-ils ?
- **précision** : quelle part des résultats est réellement exploitable ?
- **taux de nouveauté** : quelle part d'acteurs jamais vus par le projet ?
- **complétude** : activité, localisation, moyen de contact documentés ?
- **actionabilité** : combien de comptes peuvent raisonnablement être contactés, preuves à l'appui ?

Ces indicateurs servent à piloter le produit. Aucun chiffre de ROI ou de conversion n'est communiqué à ce
stade.
