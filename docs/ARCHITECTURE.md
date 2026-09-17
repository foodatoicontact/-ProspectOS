# ProspectOS — architecture V0

Positionnement : « Prospection autonome, action humaine. »

## Décision
Monolithe modulaire Next.js / TypeScript, PostgreSQL et Supabase Auth ; cible de déploiement Vercel. Une architecture microservices ajouterait coordination et coûts sans servir cette verticale. Un prototype uniquement local ne validerait pas le multi-tenant : le mode démo est donc séparé explicitement du backend authentifié.

## Flux
Navigateur → API REST /api/v1 → services métier → client Supabase avec JWT utilisateur → PostgreSQL/RLS.
Les moteurs de scoring et de rédaction factuelle sont des fonctions pures réutilisables par un futur transport MCP. Aucun outil d’envoi ou de navigation automatisée LinkedIn n’existe.
L’IA est une dépendance serveur interchangeable OpenAI/Anthropic, configurée par variables privées. Sans clé, la rédaction utilise des modèles factuels identifiés comme tels. Les textes importés sont des données non fiables, jamais des instructions.

## Données
| Table | Rôle | Relations et contraintes |
|---|---|---|
| organizations | espace client | propriétaire auth.users |
| memberships | accès | organisation + utilisateur uniques ; lecture personnelle |
| projects | offre et campagne | organization_id ; paire id/organization_id unique |
| icps | critères pondérés | projet + organisation ; poids positifs total 100 dans le moteur |
| prospects | établissement et statut | projet + organisation ; URL source ; aucune coordonnée inventée |
| evidence | observations | prospect + organisation ; critère, booléen, extrait, URL, observed_at, état et validateur |
| channels | coordonnées professionnelles | prospect + organisation ; type, valeur, URL, validation |
| outreach | brouillons | prospect + organisation ; contenu et références ; jamais envoyé par le système |
| events | historique append-only | organisation, prospect, acteur, événement |

Les FK composites (parent_id, organization_id) interdisent les associations cross-tenant. Les politiques SELECT/INSERT/UPDATE/DELETE utilisent une adhésion réelle et WITH CHECK. L’adhésion n’est jamais tirée de user_metadata. Les fonctions privilégiées ont un search_path fermé ; aucune clé service_role côté navigateur.

## Confiance
Evidence : NOT_VERIFIED / VERIFIED / CONTRADICTED / INFERRED_UNCONFIRMED. Une source URL seule ne valide pas une affirmation. Un humain vérifie l’extrait. Un signal inconnu ou expiré vaut zéro point mais apparaît « À confirmer ». Des observations vérifiées opposées donnent « Contradiction », zéro point et demandent une revue. Les preuves expirent après 90 jours par défaut.
Le score de priorité est la somme des poids des critères vérifiés satisfaits sur 100 ; la couverture représente les critères dont la valeur est connue. Ce n’est ni une probabilité de vente, ni une mesure de légalité. Les poids sont ceux de l’ICP actif. Modifier l’ICP recalcule le score. V0 : une ligne ICP mutable par projet, sans versionnement historique. Les brouillons enregistrent leur contenu et leurs références de preuves, pas un snapshot intégral. L’interface efface le brouillon après une modification de preuve ou d’ICP pour imposer sa régénération.

## ICP Foodatoi initial
Secteur alimentaire 15 ; Toulouse/Occitanie 15 ; commandes téléphone 20 ; commandes sociales explicites 10 ; Uber Eats/Deliveroo 15 ; click & collect absent/faible explicitement établi 15 ; audience sociale forte documentée 5 ; livraison interne documentée 5. Avoir un compte Instagram n’établit ni audience forte ni prise de commande. Livraison « directe » ne prouve pas des livreurs salariés.

## Collecte
V0 : ajout manuel et import de texte public avec URL ; analyse produit IA facultative ; candidats d’observations doivent être validés. Recherche via API de recherche autorisée à brancher, pas via scraping des résultats de moteurs. Démo : trois établissements réellement consultés, avec date de consultation et limites.
Le fetch arbitraire de sites est exclu du premier incrément tant qu’un fetcher avec résolution DNS, blocage des IP privées, redirects vérifiés, limites de taille/durée et politique des sources n’est pas testé. L’import URL + texte constitue le chemin sûr disponible.

## Sécurité opérationnelle
NO_UNAUTHORIZED_LINKEDIN_AUTOMATION = true, immuable dans le domaine. Actions permises : préparer, copier, ouvrir manuellement, marquer contacté. Aucun cookie LinkedIn, mot de passe, CAPTCHA, extension de navigation ou file d’envoi. Une disponibilité de canal ne constitue pas une autorisation de démarcher. Liste d’opposition, rétention configurable et formalités de protection des données sont des gates avant commercialisation élargie ; la V0 n’est pas une certification juridique.

## Déploiement
Aucune base existante n’est modifiée sans identification de la cible. Variables : NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, AI_PROVIDER, AI_API_KEY, AI_MODEL. Démo séparée sans compte ; production refuse les accès non authentifiés. Les secrets ne figurent jamais dans le ZIP.
