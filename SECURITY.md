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

## Import de l'entreprise (profil ICP)

Détail : `docs/ICP_IMPORT.md`. La personne importe **sa propre** présentation (texte collé, PDF, DOCX) ; le résultat est un brouillon que seule une validation humaine (`validate_icp_import`) transforme en profil. Rien n'est utilisé en prospection avant, rien n'est envoyé.

Fichiers : corps brut lu par morceaux et arrêté au premier octet au-delà de 4 Mio (jamais de base64, `Content-Length` non cru), type décidé par les octets de tête (`%PDF-`, `PK\x03\x04` + `word/document.xml`), jamais par l'extension ni le Content-Type. Lus en mémoire, jamais stockés ni exécutés : PDF par PDF.js (`unpdf`, version figée) sans police, sans XFA, 30 pages et 15 s au plus, scan refusé (pas d'OCR) ; DOCX par JSZip, 1 000 entrées au plus, `word/document.xml` décompressé compté pendant l'inflation et arrêté à 10 Mio (bombe zip), aucune macro, aucun objet ni lien externe lu. Un fichier refusé ne touche ni la base ni le quota.

Injection : le document est une donnée, envoyée une fois, encodée en JSON entre deux marqueurs à nonce aléatoire, après un prompt système qui l'énonce ; aucun outil, réflexion désactivée, sortie bornée. La réponse doit être un unique objet JSON validé par un schéma Zod strict : une propriété inconnue, un type ou un code faux fait refuser le profil entier (un nouvel essai au plus, avec nos seuls messages de validation, jamais le document) ; jamais de réparation. Une valeur sans source, ou dont la source n'est pas un passage du document, est vidée et devient une question. Une réponse tronquée ou refusée arrête l'import. Le brouillon est revalidé à chaque lecture.

Isolation : `start_icp_import` (membre, verrou, 1 import en cours par projet, quota d'analyse d'offre, 10 imports d'URL par organisation et par jour) ; `complete_icp_import` au seul rôle service ; aucune écriture directe sur `icp_imports` (déclencheur et droits) ; effacement par un membre à tout statut sauf un import en cours (`delete_icp_import`), en cascade avec le projet, et des imports non validés d'une personne qui quitte l'organisation (ses imports validés restent, détachés d'elle) ; un import `PENDING` de plus de 2 minutes est lu `FAILED` ; le smoke test réel ne s'exécute qu'à la main (`workflow_dispatch`) avec la seule clé IA ; BYOK illisible = échec fermé. Journaux serveur : codes, chemins, règles, longueurs et compteurs — **jamais de texte du document**, même pour un élément écarté par la normalisation (un test échoue si un extrait y apparaît). Les 60 premiers caractères d'un élément écarté et la réponse brute du modèle (`--show-raw`) ne s'affichent que dans la console du script opérateur de smoke test, sur un document de test public. L'import d'URL (étape 3) reprendra `safe-fetch` et sera documenté ici.

## Journalisation et limites

Journaux : provider, durée, résultats, pages, propositions et erreurs génériques ; tokens/coût IA égaux à zéro pour l'extraction déterministe. Aucune clé API ni jeton Auth journalisé. Les payloads de recherche restent soumis à RLS ; définir une politique de rétention avant usage commercial.

Les tests exécutent PostgreSQL via PGlite avec deux identités. Cela ne remplace pas une recette sur Supabase Auth/PostgREST réel. La concurrence des quotas n'a pas été exercée avec plusieurs connexions. La navigation interactive et les conditions des sites ajoutés par l'administrateur restent à vérifier avant production.
