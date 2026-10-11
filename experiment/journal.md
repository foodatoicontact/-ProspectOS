# Journal 1€→100€

## Cycle 1 — 2026-10-11
Budget restant : ~0,65 € (estim.) | CA confirmé : 0 € | CA potentiel : 99–297 €
Hypothèse : un pack de prospects qualifiés avec preuves, livré par ProspectOS (coût IA ~0), se vend 99 € à des TPE/agences du réseau existant. Aucun build requis.
Options : S1 pack prospects (EV ≈ 297€×0,35 ≈ 104€) · S2 Foodatoi resto (EV ≈ 150€×0,15 ≈ 22€, cycle long) · S3 nouveau micro-SaaS (EV faible, build) .
Action : offre + message rédigés (offer.md). Contact = validation humaine.
Coût estimé : ~0,35 € (inventaire + mise en place).
Résultat : en attente d'envoi.
Décision suivante : stop jusqu'à réponse d'un prospect (aucune exploration supplémentaire).

## Cycle 2 — 2026-10-11
Budget restant : ~0,40 € (estim.) | CA confirmé : 0 € | CA potentiel : inchangé
Action : identification de 5 agences web/consultants B2B en Occitanie (WebSearch OK).
Résultat : sites des entreprises inaccessibles (proxy 403/DNS) → aucun email publié vérifiable → 0 envoi (pas d'email deviné, règle respectée).
Décision : STOP. Débloquer le réseau sortant, sinon pivoter vers un canal ne nécessitant pas de lecture web.

## Cycle 3 — 2026-10-11
Réseau OK. Vérification directe : 2 candidats retenus sur 5 (Beeween, Clickzou) ; Studio Gazoline (domaine à vendre), Jalis (hors zone, grande structure) et Ato Web (site injoignable) écartés. +3 agences vérifiées (Agence FL, LMWEB, Gard Web Création).
5 emails envoyés à des adresses publiées sur les sites. Offre : 5 prospects gratuits puis 99 € HT.
Coût estimé : ~0,15 €. STOP.

## Correction — 2026-10-11 (contrainte expéditeur)
Les 5 messages du batch 1 sont partis depuis une adresse liée à Velòu France, une identité qui ne doit pas servir à cette activité. Ils restent comptabilisés : pas de suppression, pas de renvoi, pas de correctif.
Règle à partir de maintenant : tout envoi lié à ProspectOS ou au pack de prospects part uniquement de prospectos.contact@gmail.com, signé Kevin Cardia. Aucune autre identité sans autorisation explicite.
Le connecteur Gmail actuel n'est pas prospectos.contact@gmail.com : aucun envoi possible par ce connecteur.
Les réponses du batch 1 arriveront sur la boîte Velòu France.
Statut : batch terminé, aucun nouvel envoi, attente des réponses.

Connecteur Gmail vérifié : prospectos.contact@gmail.com (sans envoi). Les réponses du batch 1 restent sur la boîte Velòu France : l'utilisateur les transmet.

## Cycle 4 — Batch 2 — 2026-10-11
Budget avant : ~0,25 € (estim.) | CA confirmé : 0 €
Méthode : registre officiel (recherche-entreprises, comme le provider registry de ProspectOS) puis vérification déterministe du site par le SIREN dans les mentions légales. Registre instable (connexions coupées) : 2 recherches web en appoint.
Envoyés depuis prospectos.contact@gmail.com, signés Kevin Cardia : Agence Web Norbert (Narbonne, gérant seul, adresse nominative), Abtel (Bouillargues), Digital-i (Albi).
Batch réduit à 3 pour tenir le budget total de 1 €. Aucune relance.
Coût estimé : ~0,20 €. Total estimé : ~0,95 €. STOP.

## Cycle 5 — Batch 3 — 2026-10-11 (demande explicite : 10 prospects)
Source : annuaire public FranceNum (gouv.fr), 355 prestataires numériques en Occitanie. Pipeline déterministe : fiches (JSON-LD : ville, responsable, mots-clés, site), filtre création de site + Occitanie, puis extraction des emails sur accueil, contact et mentions légales.
Piège détecté : le premier lien d'une fiche est souvent le site d'un client du portfolio. Seuls les domaines correspondant au nom de l'agence ou du responsable ont été retenus.
10 envois depuis prospectos.contact@gmail.com, signés Kevin Cardia : BiOui, Studio Conseil, Audrey Daneyrolle, ALBDEV, Native Web, La Lucarne, BunnyTech, ElevateCo, COME, Jixart.
Écartés : Labanana (ICP marques e-commerce), Unigma et Tamline (communication/print), Azdine Mansour (site non vérifiable).
Coût estimé : ~0,40 €. Total estimé : ~1,35 €, plafond de 1 € dépassé sur demande explicite. STOP.

## Cycle 6 — Batch 4 (option B) — 2026-10-11
Plafond : 1 € abandonné, nouveau plafond absolu de 5 € cumulés.
Méthode déterministe : 349 fiches FranceNum Occitanie relues ; site officiel pris dans le champ JSON-LD `url` de la fiche (et non plus le premier lien, souvent un client du portfolio) ; exploration de l'accueil, du contact et des mentions légales ; emails retenus seulement sur le domaine de l'agence ; adresses recrutement, support, DPO et facturation exclues ; contrôle registre quand c'est possible (entreprises radiées exclues).
Rejets : 150 hors cible (pas de création de site), 49 sans email publié, 14 sites injoignables, 12 déjà contactés, 4 sans site, 3 avec seulement des adresses inappropriées, puis 82 écartés à la revue (cible ou métier inadapté, 10 salariés ou plus, entreprises radiées, sites ambigus, réserve).
35 envois personnalisés depuis prospectos.contact@gmail.com (freelances et très petites agences web qui servent les TPE locales).
Environ 30 cibles qualifiées gardées en réserve, volontairement non envoyées : protéger la délivrabilité d'un Gmail neuf et mesurer le taux de réponse d'abord.
Coût estimé : ~1,25 €. Total estimé : ~2,6 € sur 5 €. Réponses : 0. CA : 0 €. STOP.
