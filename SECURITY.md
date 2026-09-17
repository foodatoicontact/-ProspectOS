# Sécurité du Discovery Engine

`NO_UNAUTHORIZED_LINKEDIN_AUTOMATION = true`. Aucun navigateur furtif, accès privé, CAPTCHA bypass, connexion, invitation ou DM LinkedIn automatisé. Les liens LinkedIn ne sont pas récupérés par le collecteur.

## Sources et confiance

Le provider `fixture` produit exclusivement des exemples synthétiques identifiés TEST. Le provider Brave utilise son API officielle, sous réserve d'une clé et des conditions de votre abonnement ; il n'a pas été appelé avec une clé réelle pendant cette livraison. Un résultat de recherche n'est pas déclaré site officiel. L'utilisateur confirme le site avant analyse.

Le téléchargement de sites requiert une liste d'hôtes explicitement autorisés (`DISCOVERY_ALLOWED_HOSTS`) et respecte robots.txt. L'administrateur doit vérifier les conditions d'accès de chaque hôte avant de l'ajouter : robots.txt ne constitue pas à lui seul une autorisation contractuelle. Pas d'exécution JavaScript. Au maximum trois pages pertinentes du même site sont analysées.

Chaque page conserve URL exacte, titre, extrait, date et hash. Une absence de signal reste UNKNOWN ; elle ne prouve pas l'absence de click & collect. Les métriques sociales ne sont pas inventées. L'extraction est déterministe ; aucun LLM ne transforme les sources en données vérifiées.

Les propositions sont NOT_VERIFIED ou INFERRED_UNCONFIRMED. Une confirmation humaine explicite est nécessaire pour VERIFIED. La contradiction met à jour la même preuve et retire ses points. Le moteur V0 demeure inchangé : seules les preuves vérifiées, sourcées, fraîches et attribuées à un vérificateur comptent. Le message préparé utilise ce même filtre.

## SSRF et ressources

HTTP/HTTPS seulement, ports standards, pas d'identifiants dans l'URL. Rejet des IP non publiques, localhost, plages privées/réservées, adresses IPv4 mappées et metadata cloud. Toutes les réponses DNS sont contrôlées et l'adresse validée est fixée à la connexion. Chaque redirection repasse les contrôles et la politique d'hôtes. Le transport natif évite une seconde résolution DNS.

Limites par téléchargement : URL 2 048 caractères, réponse 500 Ko, échéance 12 secondes, trois redirections ; le corps est détruit en cas de refus ou dépassement. Le collecteur vérifie également robots.txt. Les analyses sont limitées à 40 observations enregistrées.

## Isolation et quotas

Le client serveur réutilise le JWT de l'utilisateur ; aucune service_role dans l'application. RLS organisation et FK composites empêchent les associations entre tenants. Les mutations privilégiées utilisent des RPC avec contrôle d'appartenance, search_path vide et droits explicites ; les RPC ne sont pas accessibles au rôle anon. Les quotas sont persistants, par organisation, réservés avant l'appel externe et protégés par verrou transactionnel. Les échecs consomment leur réservation.

Les réglages sont administratifs dans `prospectos_private.discovery_quota_settings` ; les valeurs initiales (10 recherches/heure, 20 résultats/recherche, 20 analyses/heure) sont techniques, configurables, sans engagement commercial.

## Journalisation et limites

Journaux : provider, durée, résultats, pages, propositions et erreurs génériques ; tokens/coût IA égaux à zéro pour l'extraction déterministe. Aucune clé API ni jeton Auth journalisé. Les payloads de recherche restent soumis à RLS ; définir une politique de rétention avant usage commercial.

Les tests exécutent PostgreSQL via PGlite avec deux identités. Cela ne remplace pas une recette sur Supabase Auth/PostgREST réel. La concurrence des quotas n'a pas été exercée avec plusieurs connexions. La navigation interactive et les conditions des sites ajoutés par l'administrateur restent à vérifier avant production.
