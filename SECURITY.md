# Sécurité du Discovery Engine

`NO_UNAUTHORIZED_LINKEDIN_AUTOMATION = true`. Aucun navigateur furtif, accès privé, CAPTCHA bypass, connexion, invitation ou DM LinkedIn automatisé. Les liens LinkedIn ne sont pas récupérés par le collecteur.

## Sources et confiance

Le provider `fixture` produit exclusivement des exemples synthétiques identifiés TEST. Le provider Brave utilise son API officielle, sous réserve d'une clé et des conditions de votre abonnement. Un résultat de recherche n'est pas déclaré site officiel. L'utilisateur confirme le site avant analyse.

Le téléchargement d'un site réel requiert une autorisation décidée par le serveur (`docs/DYNAMIC_SAFE_ANALYSIS.md`) : soit une capacité **dynamique** — le prospect provient d'un résultat Discovery Brave accepté par l'utilisateur, classé `COMPANY_CANDIDATE`, dont le domaine est le site propre de la page (`own_site`), et le site du prospect est toujours ce même hôte ; activable seulement par `DISCOVERY_DYNAMIC_ANALYSIS_ENABLED=true` —, soit la liste opérateur `DISCOVERY_ALLOWED_HOSTS` (prospects manuels, sources revues). Le navigateur ne fournit jamais la destination. L'administrateur reste responsable de la décision contractuelle : robots.txt ne constitue pas à lui seul une autorisation contractuelle, et une autorisation réseau n'est ni une validation ICP ni une preuve. Pas d'exécution JavaScript. Au maximum trois pages du même site sont analysées. Chaque tentative sur un site réel est journalisée (`website_analysis_audit`, métadonnées seulement).

Chaque page conserve URL exacte, titre, extrait, date et hash. Une absence de signal reste UNKNOWN ; elle ne prouve pas l'absence de click & collect. Les métriques sociales ne sont pas inventées. L'extraction est déterministe ; aucun LLM ne transforme les sources en données vérifiées.

Les propositions sont NOT_VERIFIED ou INFERRED_UNCONFIRMED. Une confirmation humaine explicite est nécessaire pour VERIFIED. La contradiction met à jour la même preuve et retire ses points. Le moteur V0 demeure inchangé : seules les preuves vérifiées, sourcées, fraîches et attribuées à un vérificateur comptent. Le message préparé utilise ce même filtre.

## SSRF et ressources

HTTP/HTTPS seulement, ports standards, pas d'identifiants dans l'URL. Rejet des IP non publiques, localhost, plages privées/réservées, adresses IPv4 mappées et metadata cloud. Toutes les réponses DNS sont contrôlées et l'adresse validée est fixée à la connexion. Chaque redirection repasse les contrôles et la politique d'hôtes ; sous une autorisation dynamique, elle doit rester dans le même domaine enregistrable (Public Suffix List, section privée incluse) et ne peut pas passer de HTTPS à HTTP. Le transport natif évite une seconde résolution DNS.

Chaque téléchargement est borné par des limites serveur : longueur d'URL, taille maximale de réponse, délai d'expiration et nombre de redirections ; le corps est détruit en cas de refus ou de dépassement. Le collecteur vérifie également robots.txt. Le nombre d'observations enregistrées par analyse est plafonné.

## Isolation et quotas

Le client serveur réutilise le JWT de l'utilisateur pour toutes les lectures et écritures applicatives courantes. RLS organisation et FK composites empêchent les associations entre tenants. Les mutations privilégiées utilisent des RPC avec contrôle d'appartenance, search_path vide et droits explicites ; les RPC ne sont pas accessibles au rôle anon.

La clé Supabase service role est utilisée exclusivement côté serveur, pour un nombre limité d'opérations privilégiées qui doivent volontairement contourner la RLS parce qu'aucun rôle client ne doit pouvoir les exécuter : écriture contrôlée des résultats Discovery, registre des coûts fournisseur, déchiffrement côté serveur d'une clé API client (BYOK) et anonymisation du compte lors de sa suppression. Chacune intervient après une étape réalisée sous l'identité de l'utilisateur (lecture sous RLS ou RPC contrôlée). La clé est une variable d'environnement serveur : elle n'est jamais exposée au navigateur, jamais préfixée `NEXT_PUBLIC_` et jamais journalisée. Les quotas sont persistants, par organisation, réservés avant l'appel externe et protégés par verrou transactionnel. Les échecs consomment leur réservation.

Les réglages sont administratifs dans `prospectos_private.discovery_quota_settings` ; les quotas couvrent les recherches et le nombre de résultats par recherche (par organisation) et les analyses de sites (par organisation **et** par utilisateur, migration 015) ; leurs valeurs sont techniques, configurables, sans engagement commercial.

## Journalisation et limites

Journaux : provider, durée, résultats, pages, propositions et erreurs génériques ; tokens/coût IA égaux à zéro pour l'extraction déterministe. Aucune clé API ni jeton Auth journalisé. Les payloads de recherche restent soumis à RLS ; définir une politique de rétention avant usage commercial.

Les tests exécutent PostgreSQL via PGlite avec deux identités. Cela ne remplace pas une recette sur Supabase Auth/PostgREST réel. La concurrence des quotas n'a pas été exercée avec plusieurs connexions. La navigation interactive et les conditions des sites ajoutés par l'administrateur restent à vérifier avant production.
