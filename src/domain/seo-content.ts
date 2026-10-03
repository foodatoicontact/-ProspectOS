import type {SeoPage} from './seo.ts';

// Editorial content of the public SEO pages. Plain typed data, no CMS.
// Inline links use the `[anchor](/path)` form and must point to an existing public route (checked by
// tests/seo-content.test.ts). Every statement about ProspectOS must describe the product as it actually
// works (src/domain/core.ts scoring, human review of evidence, factual outreach template, no sending):
// no client, testimonial, statistic, result or integration may be invented here.
// `updated` = date of the last real edit of the page content (ISO, YYYY-MM-DD). Change it by hand when
// the content changes; never derive it from the build date.

export const seoPages:SeoPage[]=[
  {
    slug:'prospection-b2b',
    navLabel:'Prospection B2B : la méthode',
    updated:'2026-10-03',
    keywords:{primary:'prospection B2B',secondary:['méthode de prospection B2B','qualification commerciale','ICP B2B']},
    title:'Prospection B2B : qualifier avant de contacter | ProspectOS',
    description:'Méthode de prospection B2B en sept étapes : ICP, découverte, signaux, preuves, qualification, priorisation et approche commerciale préparée à partir de faits.',
    eyebrow:'PROSPECTION B2B · MÉTHODE',
    h1:'Prospection B2B : qualifier avant de contacter',
    intro:'La plupart des difficultés de prospection B2B ne viennent pas du message, mais de la liste. Contacter une entreprise sans savoir pourquoi elle correspond à votre offre produit des relances sans réponse et une image de marque abîmée. Cette page décrit une méthode simple : décider qui mérite d’être contacté, pour quelle raison, et sur la base de quelles preuves, avant d’écrire la moindre ligne.',
    sections:[
      {h2:'Pourquoi la prospection B2B commence avant le premier message',blocks:[
        {type:'p',text:'Une liste de prospects est souvent construite par filtres : secteur, taille, zone. Ces filtres décrivent une population, pas des opportunités. Deux entreprises du même secteur et de la même ville peuvent avoir des besoins opposés, et rien dans une ligne de tableur ne permet de les distinguer.'},
        {type:'p',text:'Qualifier avant de contacter, c’est remplacer « cette entreprise ressemble à ma cible » par « voici ce que j’ai observé chez elle, où je l’ai observé, et pourquoi cela compte pour mon offre ». La différence se voit ensuite dans l’approche : un message construit sur un fait vérifiable est plus court, plus précis et plus facile à assumer.'},
      ]},
      {h2:'Les sept étapes d’une prospection B2B fondée sur des preuves',blocks:[
        {type:'h3',text:'1. Définir l’ICP en critères mesurables'},
        {type:'p',text:'Le profil de client idéal (ICP) ne doit pas rester une phrase. Il se traduit en critères observables, chacun avec un poids : correspondance avec la cible, besoin lié à l’offre, signal commercial, canal de contact professionnel. Dans ProspectOS, les poids d’un ICP totalisent 100, ce qui oblige à arbitrer ce qui compte vraiment.'},
        {type:'h3',text:'2. Découvrir des candidats, pas des leads'},
        {type:'p',text:'La découverte consiste à trouver des entreprises qui pourraient correspondre, à partir de sources publiques : moteur de recherche, site officiel, pages de contact. À ce stade, ce sont des candidats. Rien n’est encore établi.'},
        {type:'h3',text:'3. Observer des signaux'},
        {type:'p',text:'Un signal est un élément public qui suggère une adéquation : une activité précise, une zone d’intervention, un mode de commande, une mention de recrutement. Les [signaux commerciaux](/qualifier-un-prospect-b2b) sont utiles, mais un signal n’est pas encore une preuve.'},
        {type:'h3',text:'4. Transformer un signal en preuve'},
        {type:'p',text:'Une preuve, c’est un signal accompagné de sa source (une URL), de l’extrait exact et de sa date d’observation, puis confirmé par une personne. Tant que personne ne l’a vérifié, il reste une observation à confirmer.'},
        {type:'h3',text:'5. Qualifier'},
        {type:'p',text:'Chaque critère prend alors un statut : étayé, non satisfait, à confirmer ou contradictoire. La méthode détaillée pour [qualifier un prospect B2B](/qualifier-un-prospect-b2b) décrit comment lire ces statuts et quelle décision en tirer.'},
        {type:'h3',text:'6. Prioriser'},
        {type:'p',text:'Le score n’a de valeur que s’il s’explique critère par critère. Un [lead scoring explicable](/lead-scoring) sert à ordonner le travail, pas à prédire une vente. Pour l’ordre de contact, voir comment [prioriser une liste de prospects](/prioriser-liste-prospects).'},
        {type:'h3',text:'7. Préparer l’approche'},
        {type:'p',text:'Le message part du fait le plus important qui a été vérifié, cité tel quel, puis présente l’offre. Il est relu et envoyé par une personne, depuis son propre outil. ProspectOS prépare ; il n’envoie rien.'},
      ]},
      {h2:'Ce qu’une liste de prospection B2B n’est pas',blocks:[
        {type:'ul',items:[
          'Un volume à épuiser : mille contacts mal qualifiés coûtent plus de temps que cinquante bien documentés.',
          'Un fichier figé : une observation a une date, et une information ancienne doit être revérifiée.',
          'Une suite de suppositions : « ils ont sûrement besoin de… » n’est pas un critère satisfait.',
          'Une décision automatique : le choix de contacter, et le moment, restent humains.',
        ]},
      ]},
      {h2:'Où intervient ProspectOS',blocks:[
        {type:'callout',title:'Prospection autonome, action humaine',text:'ProspectOS aide à découvrir des candidats, à rattacher chaque observation à sa source et à calculer un score lisible à partir des seules preuves vérifiées. La vérification des preuves, la décision de contacter et l’envoi restent des actions humaines. Pour la place exacte de l’IA dans ce processus, voir la page [prospection B2B assistée par IA](/prospection-ia).'},
      ]},
    ],
    faq:[
      {q:'Faut-il beaucoup de critères pour qualifier un prospect ?',a:'Non. Quatre à six critères bien choisis suffisent souvent. L’important est que chacun soit observable dans une source publique et que son poids reflète son importance réelle pour votre offre.'},
      {q:'Peut-on prospecter sans preuve ?',a:'On peut contacter sans preuve, mais on ne peut alors pas expliquer pourquoi ce prospect plutôt qu’un autre. La méthode décrite ici vise justement à pouvoir répondre à cette question.'},
    ],
    cta:{title:'Voir la méthode appliquée',text:'La démonstration publique montre des prospects, leurs sources et un score expliqué, sans créer de compte.'},
    related:['qualifier-un-prospect-b2b','prioriser-liste-prospects','lead-scoring','prospection-ia'],
  },
  {
    slug:'prospection-ia',
    navLabel:'Prospection B2B assistée par IA',
    updated:'2026-10-03',
    keywords:{primary:'prospection IA',secondary:['IA prospection B2B','IA sans hallucination','validation humaine']},
    title:'Prospection IA : l’IA sans supposition présentée comme fait | ProspectOS',
    description:'Prospection B2B et IA : ce que l’IA peut préparer, ce qu’elle ne doit pas prétendre savoir, et pourquoi chaque information doit être observée, sourcée et validée.',
    eyebrow:'PROSPECTION & IA',
    h1:'Prospection IA : utiliser l’IA sans transformer une supposition en fait',
    intro:'L’IA rend facile la personnalisation de milliers de messages. Elle ne dit pas, en revanche, pourquoi ces prospects méritent d’être contactés. Le risque principal n’est pas un message mal écrit, mais un message bien écrit qui affirme quelque chose de faux. Cette page explique où l’IA aide réellement en prospection B2B, où elle doit s’arrêter, et comment garder une validation humaine sur ce qui compte.',
    sections:[
      {h2:'Ce que l’IA peut préparer en prospection',blocks:[
        {type:'ul',items:[
          'Reformuler et structurer votre propre offre : à qui elle s’adresse, quel problème elle résout, quelles questions poser.',
          'Résumer un contenu long pour en faciliter la lecture.',
          'Suggérer des critères ou des questions à vérifier.',
          'Gagner du temps sur la mise en forme d’un texte dont les faits ont déjà été vérifiés.',
        ]},
        {type:'p',text:'Dans tous ces cas, la sortie de l’IA est une proposition. Elle se relit et se corrige.'},
      ]},
      {h2:'Ce que l’IA ne doit pas prétendre savoir',blocks:[
        {type:'p',text:'Un modèle de langage produit un texte plausible. Il ne sait pas si une entreprise recrute, si elle utilise tel outil ou si elle a un besoin précis, sauf si cette information figure dans une source qu’on peut montrer. Les dérives typiques :'},
        {type:'ul',items:[
          '« J’ai vu que vous développiez votre activité à l’international » : aucune source.',
          '« Comme beaucoup d’entreprises de votre secteur, vous rencontrez sûrement… » : une supposition présentée comme un constat.',
          'Une personnalisation fondée sur un nom ou un secteur, sans rien d’observé.',
        ]},
      ]},
      {h2:'Observé, supposé, vérifié : trois statuts différents',blocks:[
        {type:'p',text:'La règle centrale est de ne jamais mélanger ces trois niveaux :'},
        {type:'ul',items:[
          'Observé : un extrait public a été trouvé, avec son URL et sa date. Il reste à confirmer.',
          'Supposé : une déduction sans extrait. Elle ne compte pour rien dans la qualification.',
          'Vérifié : une personne a lu l’extrait dans sa source et l’a confirmé, ou au contraire l’a contredit.',
        ]},
        {type:'callout',title:'Exemple (entreprise TEST)',text:'Sur la page de « Restaurant TEST — Toulouse », l’extrait « Restaurant de burgers à Toulouse. » est observé, avec son URL. Tant que personne ne l’a confirmé, il est affiché comme à vérifier et ne rapporte aucun point. Une fois confirmé, il devient une preuve et peut compter dans le [lead scoring explicable](/lead-scoring). L’affirmation « ce restaurant cherche une solution de commande » n’a, elle, aucun extrait : elle n’est jamais transformée en fait.'},
      ]},
      {h2:'Où ProspectOS utilise l’IA, et où il ne l’utilise pas',blocks:[
        {type:'p',text:'ProspectOS utilise un modèle d’IA pour une tâche précise : l’analyse de votre propre offre commerciale (résumé, cible, questions suggérées), présentée comme une proposition à valider. Vous pouvez utiliser votre propre clé d’accès à un fournisseur d’IA.'},
        {type:'p',text:'La découverte de candidats et l’extraction des observations s’appuient sur des sources publiques et des règles explicites, et chaque observation garde son extrait et son URL. Le message d’approche est préparé à partir d’un modèle factuel qui cite l’extrait vérifié, sans modèle d’IA. Enfin, ProspectOS n’envoie aucun message : l’envoi reste une action humaine.'},
      ]},
      {h2:'La validation humaine, concrètement',blocks:[
        {type:'ol',items:[
          'Lire l’extrait proposé dans son contexte, en ouvrant la source.',
          'Confirmer, contredire ou laisser non vérifié.',
          'Constater l’effet sur le score : seule une preuve confirmée fait monter un critère.',
          'Décider de contacter ou non, puis relire le message préparé avant de l’envoyer soi-même.',
        ]},
        {type:'p',text:'Cette étape prend quelques secondes par preuve. C’est elle qui permet de [qualifier un prospect B2B](/qualifier-un-prospect-b2b) sans dépendre d’une déduction automatique.'},
      ]},
    ],
    faq:[
      {q:'L’IA peut-elle trouver des prospects toute seule ?',a:'Elle peut aider à chercher et à trier, mais trouver une entreprise ne dit pas pourquoi la contacter. Sans source vérifiable, le choix reste une supposition.'},
      {q:'Une personnalisation par IA est-elle forcément mauvaise ?',a:'Non, si elle part de faits vérifiés. Le problème vient de la personnalisation qui invente un contexte que personne n’a observé.'},
    ],
    cta:{title:'Voir des observations et leurs sources',text:'La démonstration publique montre la différence entre une observation à confirmer et une preuve vérifiée.'},
    related:['prospection-b2b','lead-scoring','qualifier-un-prospect-b2b'],
  },
  {
    slug:'lead-scoring',
    navLabel:'Lead scoring explicable',
    updated:'2026-10-03',
    keywords:{primary:'lead scoring explicable',secondary:['lead scoring B2B','scoring prospects avec preuves','score de priorité']},
    title:'Lead scoring explicable : un score de priorité sourcé | ProspectOS',
    description:'Lead scoring explicable : critères pondérés, preuves vérifiées, couverture, informations inconnues et contradictions. Un score de priorité, pas une probabilité de vente.',
    eyebrow:'LEAD SCORING EXPLICABLE',
    h1:'Lead scoring explicable : un score de priorité, pas une probabilité de vente',
    intro:'Un score de prospect n’est utile que si l’on peut dire d’où vient chaque point. Un chiffre opaque, même précis en apparence, ne permet ni de décider ni de corriger. Cette page décrit un lead scoring explicable : des critères pondérés, des points accordés uniquement sur preuve vérifiée, et une distinction nette entre ce qui est faux et ce qui est simplement inconnu.',
    sections:[
      {h2:'Ce que mesure un lead scoring explicable',blocks:[
        {type:'p',text:'Le score mesure à quel point un prospect correspond à votre ICP d’après ce qui a été vérifié. Il ne mesure pas l’intention d’achat, ni une probabilité de signer. Deux usages en découlent : ordonner le travail commercial, et repérer ce qui manque pour décider.'},
      ]},
      {h2:'Des critères pondérés sur 100',blocks:[
        {type:'p',text:'Chaque projet définit ses critères et leurs poids, dont la somme vaut 100. Les critères proposés par défaut dans ProspectOS sont :'},
        {type:'ul',items:[
          'Correspond à la cible définie : 25 points.',
          'Besoin correspondant à l’offre : 30 points.',
          'Signal commercial observable : 25 points.',
          'Canal de contact professionnel documenté : 20 points.',
        ]},
        {type:'p',text:'Ces critères et ces poids se modifient librement. Ils expriment votre stratégie, pas une vérité universelle.'},
      ]},
      {h2:'Une preuve vérifiée, sinon zéro point',blocks:[
        {type:'p',text:'Un critère rapporte ses points uniquement s’il est étayé par une preuve qui réunit quatre conditions :'},
        {type:'ul',items:[
          'elle a été vérifiée par une personne ;',
          'elle contient un extrait du texte source ;',
          'elle pointe vers une source web consultable ;',
          'elle a été observée il y a moins de 90 jours.',
        ]},
        {type:'p',text:'Une observation non vérifiée, aussi probable soit-elle, ne rapporte rien.'},
      ]},
      {h2:'Inconnu, faux, contradictoire : trois cas distincts',blocks:[
        {type:'ul',items:[
          'Inconnu : aucune preuve vérifiée. Le critère est « à confirmer » et rapporte 0 point. Inconnu ne veut pas dire négatif.',
          'Non satisfait : une preuve vérifiée montre que le critère n’est pas rempli. 0 point, mais le critère est documenté.',
          'Contradiction : deux preuves vérifiées se contredisent. 0 point et une revue est demandée, au lieu de trancher en silence.',
        ]},
      ]},
      {h2:'Score et couverture : deux chiffres à lire ensemble',blocks:[
        {type:'p',text:'La couverture indique la part des poids documentés, que le critère soit satisfait ou non. Un score bas avec une couverture élevée signifie « bien connu et peu adapté ». Un score bas avec une couverture faible signifie « pas encore documenté ». Ce sont deux situations très différentes, et les confondre conduit à écarter de bons prospects.'},
        {type:'callout',title:'Exemple chiffré (entreprise TEST, critères par défaut)',text:'Cible : preuve vérifiée et satisfaite, +25. Besoin : observation trouvée mais pas encore vérifiée, 0 (à confirmer). Signal commercial : preuve vérifiée et satisfaite, +25. Canal de contact : vérifié, aucun canal professionnel trouvé, 0 (non satisfait). Résultat : score 50/100, couverture 70/100 (25 + 25 + 20). La prochaine action utile est claire : vérifier l’observation sur le besoin.'},
      ]},
      {h2:'Ce que le score ne dit pas',blocks:[
        {type:'p',text:'Il ne dit pas si le prospect achètera, ni quand. Il n’est pas comparable entre deux projets dont les critères diffèrent. Il n’intègre pas le contexte commercial que vous seul connaissez : un échange récent, une recommandation, une contrainte de calendrier. Pour combiner le score avec ces éléments, voir comment [prioriser une liste de prospects](/prioriser-liste-prospects) et comment [qualifier un prospect B2B](/qualifier-un-prospect-b2b) étape par étape.'},
      ]},
    ],
    faq:[
      {q:'Pourquoi ne pas compter une observation probable ?',a:'Parce qu’un score gonflé par des suppositions ordonne mal le travail et que personne ne peut l’expliquer. La vérification prend quelques secondes et rend chaque point défendable.'},
      {q:'Pourquoi une limite de 90 jours ?',a:'Une information publique change : horaires, offre, organisation. Au-delà de 90 jours, une observation doit être revérifiée avant de compter à nouveau.'},
    ],
    cta:{title:'Voir un score expliqué critère par critère',text:'Dans la démonstration publique, chaque point du score renvoie à sa preuve et à sa source.'},
    related:['prioriser-liste-prospects','qualifier-un-prospect-b2b','prospection-ia'],
  },
  {
    slug:'prospection-restaurants',
    navLabel:'Prospecter des restaurants',
    updated:'2026-10-03',
    keywords:{primary:'prospection restaurants',secondary:['prospecter des restaurants','fournisseur restauration B2B','qualifier des restaurants']},
    title:'Prospecter des restaurants : signaux publics et qualification | ProspectOS',
    description:'Fournisseurs B2B de la restauration : chercher des restaurants, observer leurs signaux publics, documenter leurs modes de commande et préparer une approche sourcée.',
    eyebrow:'CAS D’USAGE · RESTAURATION',
    h1:'Prospecter des restaurants à partir de signaux publics vérifiables',
    intro:'Pour un fournisseur B2B de la restauration (solution de commande, caisse, livraison, emballages, équipement), tous les établissements ne se valent pas. Un restaurant qui prend déjà ses commandes en ligne n’a pas le même besoin qu’un restaurant qui ne prend que des appels. La bonne nouvelle, c’est que beaucoup de ces informations sont publiques. Cette page décrit comment les observer, les documenter et s’en servir pour qualifier.',
    sections:[
      {h2:'1. Chercher des établissements dans une zone et une catégorie',blocks:[
        {type:'p',text:'La recherche part de votre cible : une catégorie (restaurant, pizzeria, boulangerie, snack…) et une zone (ville, département, région). Dans ProspectOS, ces éléments font partie des règles de cible de l’ICP, et la découverte s’appuie sur des sources publiques pour proposer des établissements candidats.'},
      ]},
      {h2:'2. Observer les signaux publics utiles',blocks:[
        {type:'p',text:'Selon votre offre, les signaux pertinents changent. Exemples de signaux qui peuvent être suivis comme critères distincts :'},
        {type:'ul',items:[
          'activité alimentaire et type d’établissement ;',
          'localisation dans la zone visée ;',
          'commande par téléphone mentionnée sur le site ;',
          'présence sur des plateformes de livraison ;',
          'commande via les réseaux sociaux ou une messagerie ;',
          'click & collect absent ou peu visible ;',
          'livraison assurée en interne.',
        ]},
      ]},
      {h2:'3. Documenter les modes de commande',blocks:[
        {type:'p',text:'Chaque signal doit être rattaché à une source consultable : le site officiel de l’établissement, sa page de commande ou une autre source publique. On conserve l’extrait exact (par exemple « Commandes par téléphone au … ») et la date d’observation. Sans extrait, il n’y a rien à vérifier.'},
        {type:'callout',title:'Exemple (entreprise TEST)',text:'« Restaurant TEST — Toulouse ». Activité alimentaire : « Restaurant de burgers à Toulouse. » (source : page de test). Après vérification humaine, le critère est étayé et ses points comptent dans le score. Les autres critères (plateformes de livraison, click & collect) restent « à confirmer » tant qu’aucune preuve n’a été vérifiée.'},
      ]},
      {h2:'4. Qualifier les établissements',blocks:[
        {type:'p',text:'Une fois les preuves vérifiées, chaque critère est étayé, non satisfait, à confirmer ou contradictoire. Le [lead scoring explicable](/lead-scoring) additionne uniquement les poids des critères étayés. Un établissement avec peu de signaux documentés n’est pas forcément un mauvais prospect : il est simplement moins connu. La méthode pour [qualifier un prospect B2B](/qualifier-un-prospect-b2b) s’applique telle quelle.'},
      ]},
      {h2:'5. Préparer une approche qui part d’un fait',blocks:[
        {type:'p',text:'Une approche efficace cite ce qui a été observé, sans l’interpréter : « J’ai remarqué que vous preniez les commandes par téléphone » est vérifiable ; « vous perdez sûrement des commandes » ne l’est pas. ProspectOS prépare un premier message à partir de la preuve vérifiée la plus importante, et vous le relisez avant de l’envoyer vous-même.'},
        {type:'p',text:'La prospection de professionnels reste soumise aux règles applicables, notamment en matière de données personnelles et de démarchage. Voir les [conditions d’utilisation](/cgu).'},
      ]},
      {h2:'À propos de la démonstration publique',blocks:[
        {type:'callout',title:'Démonstration, pas référence client',text:'La démonstration accessible depuis l’accueil utilise une verticale restauration pour illustrer la méthode. Les établissements qui y figurent sont des entreprises réelles dont les données publiques sont à vérifier : ce ne sont ni des clients, ni des partenaires de ProspectOS. Les exemples de cette page utilisent une entreprise TEST fictive.'},
      ]},
    ],
    faq:[
      {q:'Cette méthode ne fonctionne-t-elle que pour la restauration ?',a:'Non. Les critères sont propres à chaque projet. La restauration est un bon exemple car beaucoup de signaux utiles (modes de commande, livraison) sont visibles publiquement.'},
      {q:'Peut-on se fier à une information trouvée sur une plateforme ?',a:'Seulement après vérification et tant qu’elle est récente. Une observation de plus de 90 jours ne compte plus dans le score.'},
    ],
    cta:{title:'Explorer la démonstration restauration',text:'Des établissements, leurs sources publiques et un score expliqué, accessibles sans compte.'},
    related:['qualifier-un-prospect-b2b','lead-scoring','prospection-b2b'],
  },
  {
    slug:'qualifier-un-prospect-b2b',
    navLabel:'Qualifier un prospect B2B',
    updated:'2026-10-03',
    keywords:{primary:'comment qualifier un prospect B2B',secondary:['qualification prospects B2B','grille de qualification','critères de qualification']},
    title:'Comment qualifier un prospect B2B : la méthode étape par étape | ProspectOS',
    description:'Comment qualifier un prospect B2B : cible, critères pondérés, signaux, preuves, validation humaine, score et décision commerciale. Une méthode concrète et vérifiable.',
    eyebrow:'QUALIFICATION B2B',
    h1:'Comment qualifier un prospect B2B, étape par étape',
    intro:'Qualifier un prospect, c’est répondre à trois questions avant de le contacter : correspond-il à ma cible, a-t-il une raison d’être intéressé, et sur quoi je m’appuie pour l’affirmer ? La troisième question est la plus souvent oubliée. Voici une méthode en sept étapes, applicable avec ou sans outil, pour obtenir une qualification qu’on peut expliquer.',
    sections:[
      {h2:'Étape 1 : définir la cible',blocks:[
        {type:'p',text:'Décrivez votre cible en termes observables : type d’organisation, activité, zone géographique. « Les PME dynamiques » ne se vérifie pas ; « les cabinets comptables d’Occitanie » si.'},
      ]},
      {h2:'Étape 2 : choisir des critères et les pondérer',blocks:[
        {type:'p',text:'Listez ce qui doit être vrai pour que le prospect vaille la peine d’être contacté, puis donnez un poids à chaque critère (total 100). Un bon critère est observable dans une source publique et lié à votre offre. Exemples : correspondance avec la cible, besoin lié à l’offre, signal commercial, canal de contact professionnel.'},
      ]},
      {h2:'Étape 3 : relever les signaux',blocks:[
        {type:'p',text:'Pour chaque prospect, cherchez des signaux publics qui renseignent vos critères : description d’activité, adresse, mode de commande, offre d’emploi, page de contact. Notez l’URL et l’extrait exact. Un signal sans source ne sera pas vérifiable plus tard.'},
      ]},
      {h2:'Étape 4 : transformer les signaux en preuves',blocks:[
        {type:'p',text:'Un signal devient une preuve lorsqu’il est rattaché à un critère, accompagné de son extrait, de sa source et de sa date. Dans ProspectOS, les observations issues de la découverte arrivent avec ces trois éléments, au statut « non vérifiée ».'},
      ]},
      {h2:'Étape 5 : valider',blocks:[
        {type:'p',text:'Une personne lit l’extrait dans sa source et choisit : confirmer, contredire ou laisser non vérifié. C’est le cœur de la méthode : aucune information ne devient un fait sans cette action. Pour comprendre pourquoi l’IA ne remplace pas cette étape, voir [prospection B2B assistée par IA](/prospection-ia).'},
      ]},
      {h2:'Étape 6 : calculer un score explicable',blocks:[
        {type:'p',text:'Additionnez les poids des critères étayés par une preuve vérifiée. Les critères inconnus valent 0, les critères non satisfaits aussi, et une contradiction appelle une revue. Le détail de ce calcul est décrit dans [lead scoring explicable](/lead-scoring).'},
      ]},
      {h2:'Étape 7 : prendre une décision commerciale',blocks:[
        {type:'p',text:'La qualification débouche sur une décision, pas sur un chiffre. Trois issues possibles :'},
        {type:'ul',items:[
          'Contacter : les critères importants sont étayés et vous savez quelle preuve citer.',
          'Documenter : des critères importants restent à confirmer ; la prochaine action est une vérification, pas un message.',
          'Écarter ou revoir : un critère clé est vérifié non satisfait, ou une contradiction n’est pas résolue.',
        ]},
        {type:'callout',title:'Grille de qualification minimale',text:'Pour chaque critère : statut (étayé, non satisfait, à confirmer, contradictoire), source, extrait, date, personne ayant vérifié. Si une ligne n’a pas de source, elle ne compte pas.'},
      ]},
      {h2:'Les erreurs de qualification les plus fréquentes',blocks:[
        {type:'ul',items:[
          'Confondre une information absente avec une information négative.',
          'Compter une déduction comme un critère satisfait.',
          'Garder des observations trop anciennes sans les revérifier.',
          'Utiliser le score comme une probabilité de vente.',
          'Qualifier toute une liste avant d’avoir défini les critères.',
        ]},
        {type:'p',text:'Une fois la qualification faite, l’étape suivante est de [prioriser une liste de prospects](/prioriser-liste-prospects) pour décider qui contacter en premier. Cette méthode s’inscrit dans une démarche plus large de [prospection B2B](/prospection-b2b).'},
      ]},
    ],
    faq:[
      {q:'Quelle différence entre qualifier et scorer ?',a:'Qualifier, c’est établir le statut de chaque critère à partir de preuves. Le score résume ensuite cette qualification en un chiffre ; il n’a de sens que si la qualification est lisible.'},
      {q:'Combien de temps faut-il pour qualifier un prospect ?',a:'Cela dépend du nombre de critères et de la disponibilité des sources. L’essentiel du temps se passe à vérifier des extraits, ce qui est rapide quand chaque observation arrive avec sa source.'},
    ],
    cta:{title:'Voir une qualification complète',text:'La démonstration publique montre chaque critère avec son statut, sa preuve et sa source.'},
    related:['lead-scoring','prioriser-liste-prospects','prospection-b2b'],
  },
  {
    slug:'prioriser-liste-prospects',
    navLabel:'Prioriser une liste de prospects',
    updated:'2026-10-03',
    keywords:{primary:'prioriser une liste de prospects',secondary:['quels prospects contacter en premier','priorisation commerciale B2B','ordre de prospection']},
    title:'Prioriser une liste de prospects : qui contacter en premier | ProspectOS',
    description:'Une grosse liste n’est pas une liste d’opportunités. Prioriser ses prospects selon l’ICP, les signaux, les preuves, la couverture et une raison de contacter maintenant.',
    eyebrow:'PRIORISATION COMMERCIALE',
    h1:'Prioriser une liste de prospects : lesquels contacter en premier ?',
    intro:'Une grosse liste n’est pas une liste d’opportunités. Mille noms importés donnent l’impression d’un pipeline, mais rien n’indique par où commencer ni pourquoi. Prioriser, c’est décider de l’ordre de travail à partir de ce qui est réellement connu sur chaque prospect, et accepter qu’une partie de la liste n’ait pas encore d’intérêt démontré.',
    sections:[
      {h2:'Pourquoi le volume trompe',blocks:[
        {type:'p',text:'Une liste construite par filtres est homogène en apparence : même secteur, même taille, même zone. Pourtant, chaque entreprise a sa situation. Traiter la liste dans l’ordre alphabétique ou d’import, c’est confier la priorité au hasard. Personnaliser chaque message ne change rien au problème : on écrit mieux à des prospects qu’on n’a pas choisis.'},
      ]},
      {h2:'Six questions pour prioriser',blocks:[
        {type:'h3',text:'Adéquation avec l’ICP'},
        {type:'p',text:'Le prospect correspond-il à la cible définie, preuve à l’appui ? C’est le premier filtre.'},
        {type:'h3',text:'Signaux'},
        {type:'p',text:'Existe-t-il des éléments publics qui suggèrent un besoin lié à votre offre ? Les [signaux commerciaux](/qualifier-un-prospect-b2b) donnent une raison d’être pertinent.'},
        {type:'h3',text:'Preuves'},
        {type:'p',text:'Ces signaux ont-ils été vérifiés dans leur source ? Un signal non vérifié peut orienter une recherche, pas une décision.'},
        {type:'h3',text:'Couverture'},
        {type:'p',text:'Quelle part des critères est documentée ? Un prospect mal connu ne doit pas être classé comme un mauvais prospect.'},
        {type:'h3',text:'Contexte commercial'},
        {type:'p',text:'Ce que vous savez et qu’aucune source publique ne dit : un échange passé, une recommandation, une capacité de livraison limitée dans une zone. Ce contexte reste votre décision.'},
        {type:'h3',text:'Raison de contacter maintenant'},
        {type:'p',text:'Avez-vous un fait précis et récent à citer ? Sans raison identifiable, le contact peut attendre.'},
      ]},
      {h2:'Trois files de travail plutôt qu’un classement unique',blocks:[
        {type:'p',text:'Plutôt qu’une liste triée du premier au dernier, il est plus utile de répartir les prospects en trois files :'},
        {type:'ul',items:[
          'À contacter : critères importants étayés, une preuve récente à citer.',
          'À documenter : score bas mais couverture faible ; la prochaine action est une vérification.',
          'À revoir ou écarter : critère clé vérifié non satisfait, ou contradiction non résolue.',
        ]},
        {type:'callout',title:'Exemple (trois entreprises TEST, critères par défaut)',text:'TEST A : score 80, couverture 80. Cible, besoin et signal commercial sont étayés ; seul le canal de contact reste à confirmer avant l’envoi : c’est un candidat pour un contact. TEST B : score 25, couverture 25. Seule la cible est vérifiée, tout le reste est inconnu : à documenter, pas à écarter. TEST C : score 25, couverture 100, besoin vérifié non satisfait : à revoir. Les scores de B et C sont identiques, mais la décision est opposée.'},
      ]},
      {h2:'Le score n’est pas une probabilité de vente',blocks:[
        {type:'p',text:'Un [lead scoring explicable](/lead-scoring) ordonne le travail à partir de preuves. Il ne prédit pas qu’un prospect achètera. Un score de 70 ne signifie pas « 70 % de chances ». C’est la somme des poids des critères étayés dans votre propre ICP, et sa lecture dépend toujours de la couverture.'},
        {type:'p',text:'Pour établir ces statuts prospect par prospect, voir comment [qualifier un prospect B2B](/qualifier-un-prospect-b2b). Pour la démarche complète, de l’ICP à l’approche, voir la méthode de [prospection B2B](/prospection-b2b).'},
      ]},
    ],
    faq:[
      {q:'Faut-il contacter d’abord les scores les plus élevés ?',a:'En général oui, à condition que la couverture soit suffisante et qu’un fait récent puisse être cité. Un score élevé fondé sur peu de critères documentés mérite une vérification avant contact.'},
      {q:'Que faire des prospects sans aucune preuve ?',a:'Les laisser dans la file « à documenter ». Ils ne sont ni bons ni mauvais : ils sont inconnus.'},
    ],
    cta:{title:'Voir une liste de prospects priorisée',text:'Dans la démonstration publique, chaque prospect affiche son score, sa couverture et les critères à confirmer.'},
    related:['lead-scoring','qualifier-un-prospect-b2b','prospection-b2b'],
  },
];
