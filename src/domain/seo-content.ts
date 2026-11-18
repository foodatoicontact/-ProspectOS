import type {SeoPage} from './seo.ts';
import {PLAN_QUOTAS,CHECKOUT_PRICES,TEAM_PRICING} from './plans.ts';
import {BETA_OFFER} from './pricing.ts';

// Prices and quotas quoted on the factual pages come from plans.ts, never typed a second time.
const {TRIAL,BETA:SOLO,PRO}=PLAN_QUOTAS;
const SOLO_EUR=CHECKOUT_PRICES.BETA.unitAmount/100,PRO_EUR=CHECKOUT_PRICES.PRO.unitAmount/100;
const TEAM_EUR=TEAM_PRICING.baseAmount/100,TEAM_EXTRA_EUR=TEAM_PRICING.extraSeatAmount/100,TEAM_INCL=TEAM_PRICING.includedSeats,TEAM_MAX=TEAM_PRICING.maxSeats;

// Editorial content of the public SEO pages. Plain typed data, no CMS.
// Inline links use the `[anchor](/path)` form and must point to an existing public route (checked by
// tests/seo-content.test.ts). Every statement about ProspectOS must describe the product as it actually
// works (src/domain/core.ts scoring, human review of evidence, factual outreach template, no sending):
// no client, testimonial, statistic, result or integration may be invented here.
// `updated` = date of the last real edit of the page content (ISO, YYYY-MM-DD). Change it by hand when
// the content changes; never derive it from the build date.

// Real counts quoted on /prospection-agences-consultants, computed once from the BODACC open data with ProspectOS's own rules
// (src/collect/bodacc.ts parseBodacc: legal persons only; src/discovery/providers/bodacc-sales.ts readSalesNotice: purchases by a
// company), frozen with their date — never recomputed at build time, never rounded up. Window: 20 Aug.–17 Nov. 2026.
export const AGENCY_FIGURES={computedOn:'2026-11-18',computedOnLabel:'18 novembre 2026',from:'20 août',to:'17 novembre 2026',
 salesHauteGaronne:{companies:68,tenOrMore:12,tenOrMoreContactable:7},
 creationsIdf:{companies:13331,soleTradersLeftOut:29203},
 movesHautsDeSeine:{companies:857}} as const;
const nf=(n:number)=>n.toLocaleString('fr-FR');
const TRIAL_DAYS=BETA_OFFER.trialDays;

export const seoPages:SeoPage[]=[
  {
    slug:'prospection-b2b',
    navLabel:'Prospection B2B : la méthode',
    updated:'2026-10-06',
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
        {type:'callout',title:'Prospection autonome, action humaine',text:'ProspectOS aide à découvrir des candidats, à rattacher chaque observation à sa source et à calculer automatiquement un score estimé, pondéré par la fiabilité de chaque source, puis un score vérifié à partir des seules preuves confirmées. La vérification des preuves, la décision de contacter et l’envoi restent des actions humaines. Pour la place exacte de l’IA dans ce processus, voir la page [prospection B2B assistée par IA](/prospection-ia). Le fonctionnement du logiciel, ses sources officielles et son tarif sont détaillés sur la page [logiciel de prospection B2B](/logiciel-prospection-b2b).'},
      ]},
    ],
    faq:[
      {q:'Faut-il beaucoup de critères pour qualifier un prospect ?',a:'Non. Quatre à six critères bien choisis suffisent souvent. L’important est que chacun soit observable dans une source publique et que son poids reflète son importance réelle pour votre offre.'},
      {q:'Peut-on prospecter sans preuve ?',a:'On peut contacter sans preuve, mais on ne peut alors pas expliquer pourquoi ce prospect plutôt qu’un autre. La méthode décrite ici vise justement à pouvoir répondre à cette question.'},
    ],
    cta:{title:'Voir la méthode appliquée',text:'La démonstration publique montre, sans créer de compte, des recommandations expliquées : pourquoi maintenant, sur quelles preuves, avec leurs sources visibles, et toujours sous votre validation.'},
    related:['logiciel-prospection-b2b','qualifier-un-prospect-b2b','lead-scoring','prospection-ia'],
  },
  {
    slug:'prospection-ia',
    navLabel:'Prospection B2B assistée par IA',
    updated:'2026-10-06',
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
          'Constater l’effet sur le score : une preuve confirmée fait passer un critère d’estimé à vérifié.',
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
    updated:'2026-10-06',
    keywords:{primary:'lead scoring explicable',secondary:['lead scoring B2B','scoring prospects avec preuves','score de priorité']},
    title:'Lead scoring explicable : un score de priorité sourcé | ProspectOS',
    description:'Lead scoring explicable : critères pondérés, preuves vérifiées, couverture, informations inconnues et contradictions. Un score de priorité, pas une probabilité de vente.',
    eyebrow:'LEAD SCORING EXPLICABLE',
    h1:'Lead scoring explicable : un score de priorité, pas une probabilité de vente',
    intro:'Un score de prospect n’est utile que si l’on peut dire d’où vient chaque point. Un chiffre opaque, même précis en apparence, ne permet ni de décider ni de corriger. Cette page décrit un lead scoring explicable : des critères pondérés, des points accordés uniquement sur preuve vérifiée, et une distinction nette entre ce qui est faux et ce qui est simplement inconnu.',
    sections:[
      {h2:'Ce que mesure un lead scoring explicable',blocks:[
        {type:'p',text:'Le score mesure à quel point un prospect correspond à votre ICP. ProspectOS en affiche deux lectures : un score estimé, calculé automatiquement à partir des sources trouvées et pondéré par leur fiabilité, et un score vérifié, qui ne compte que ce qu’une personne a confirmé. Il ne mesure pas l’intention d’achat, ni une probabilité de signer. Deux usages en découlent : ordonner le travail commercial, et repérer ce qui manque pour décider.'},
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
        {type:'callout',title:'Exemple chiffré (entreprise TEST, critères par défaut)',text:'Cible : preuve vérifiée et satisfaite, +25. Besoin : observation trouvée mais pas encore vérifiée, 0 dans le score vérifié (à confirmer), comptée dans le score estimé selon la fiabilité de sa source. Signal commercial : preuve vérifiée et satisfaite, +25. Canal de contact : vérifié, aucun canal professionnel trouvé, 0 (non satisfait). Résultat : score 50/100, couverture 70/100 (25 + 25 + 20). La prochaine action utile est claire : vérifier l’observation sur le besoin.'},
      ]},
      {h2:'Ce que le score ne dit pas',blocks:[
        {type:'p',text:'Il ne dit pas si le prospect achètera, ni quand. Il n’est pas comparable entre deux projets dont les critères diffèrent. Il n’intègre pas le contexte commercial que vous seul connaissez : un échange récent, une recommandation, une contrainte de calendrier. Pour combiner le score avec ces éléments, voir comment [prioriser une liste de prospects](/prioriser-liste-prospects) et comment [qualifier un prospect B2B](/qualifier-un-prospect-b2b) étape par étape.'},
      ]},
    ],
    faq:[
      {q:'Comment une observation non vérifiée est-elle comptée ?',a:'Dans le score estimé seulement, pondérée par la fiabilité de sa source : site officiel 90 %, annuaire 80 %, extrait de recherche 60 %, simple déduction 30 %. Le score vérifié ne compte que les preuves confirmées : c’est lui qui rend chaque point défendable, et la vérification prend quelques secondes.'},
      {q:'Pourquoi une limite de 90 jours ?',a:'Une information publique change : horaires, offre, organisation. Au-delà de 90 jours, une observation doit être revérifiée avant de compter à nouveau.'},
    ],
    cta:{title:'Voir un score expliqué critère par critère',text:'Dans la démonstration publique, chaque point du score renvoie à sa preuve et à sa source.'},
    related:['prioriser-liste-prospects','qualifier-un-prospect-b2b','prospection-ia'],
  },
  {
    slug:'prospection-restaurants',
    navLabel:'Prospecter des restaurants',
    updated:'2026-10-06',
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
      {q:'Peut-on se fier à une information trouvée sur une plateforme ?',a:'Elle compte dans le score estimé selon la fiabilité de la plateforme, mais dans le score vérifié seulement après vérification, et tant qu’elle est récente. Une observation de plus de 90 jours ne compte plus dans aucun des deux.'},
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
  {
    slug:'tarifs',
    navLabel:'Tarifs et offres',
    updated:'2026-11-14',
    keywords:{primary:'tarif logiciel de prospection B2B',secondary:['prix ProspectOS','abonnement prospection','essai gratuit prospection']},
    title:`Tarifs ProspectOS : ${SOLO_EUR} €/mois, vos prospects repérés au bon moment`,
    description:`Dès ${SOLO_EUR} € par mois, sans engagement, après un essai gratuit de 7 jours : repérez les entreprises qui viennent de bouger, sources officielles à l’appui.`,
    eyebrow:'TARIFS · OFFRES',
    h1:'Tarifs ProspectOS : essayez 7 jours gratuitement, puis choisissez Solo ou Pro',
    intro:'ProspectOS vous aide à décider quelles entreprises contacter, pourquoi maintenant, et sur la base de quelles preuves. Commencez par 7 jours d’essai gratuit, sans carte bancaire, puis choisissez un abonnement mensuel sans engagement. Les principes sont identiques dans chaque offre : sources visibles, vérification humaine des preuves, aucun envoi automatique de message. Seuls les volumes changent.',
    sections:[
      {h2:'Les offres et leurs prix mensuels',blocks:[
        {type:'ul',items:[
          `Essai gratuit — 7 jours, sans carte bancaire : ${TRIAL.discovery} recherches de prospects, ${TRIAL.analysis} analyses de prospects et ${TRIAL.aiOffer} analyses d’offre IA pour toute la durée de l’essai.`,
          `ProspectOS Solo — ${SOLO_EUR} € par mois, 1 compte : ${SOLO.discovery} recherches de prospects, ${SOLO.analysis} analyses de prospects et ${SOLO.aiOffer} analyses d’offre IA par mois.`,
          `ProspectOS Pro — ${PRO_EUR} € par mois, 1 compte : ${PRO.discovery} recherches de prospects, ${PRO.analysis} analyses de prospects et ${PRO.aiOffer} analyses d’offre IA par mois.`,
          `ProspectOS Équipe — ${TEAM_EUR} € par mois pour ${TEAM_INCL} comptes, + ${TEAM_EXTRA_EUR} € par compte supplémentaire, jusqu’à ${TEAM_MAX} comptes : par compte, ${PRO.discovery} recherches de prospects, ${PRO.analysis} analyses de prospects et ${PRO.aiOffer} analyses d’offre IA par mois, en pot commun pour toute l’équipe.`,
        ]},
        {type:'p',text:'Les abonnements Solo, Pro et Équipe sont mensuels, sans engagement et résiliables à tout moment depuis le compte. Les prix sont indiqués en euros, sans TVA : l’éditeur bénéficie du régime de franchise en base de TVA. Le passage à une offre payante se fait depuis le compte, après la création du compte, sur la page de notre prestataire de paiement ; l’accès payant n’est ouvert qu’une fois le paiement confirmé par notre serveur. Les conditions complètes figurent dans les [conditions générales de vente](/cgv).'},
      ]},
      {h2:'Ce que mesure chaque quota',blocks:[
        {type:'p',text:'Trois actions sont comptées, parce que ce sont elles qui sollicitent des sources externes ou un modèle d’IA. Le reste (consulter ses prospects, vérifier une preuve, modifier son ICP, exporter) n’est pas décompté des quotas.'},
        {type:'h3',text:'Une recherche'},
        {type:'p',text:'Une recherche est un lancement de découverte : ProspectOS interroge le registre public des entreprises ou le web pour trouver des entreprises candidates correspondant à votre requête, votre zone et vos filtres. La méthode est décrite dans la page sur la [prospection B2B](/prospection-b2b).'},
        {type:'h3',text:'Une analyse de prospect'},
        {type:'p',text:'Une analyse de prospect lit le site officiel d’une entreprise (en respectant son fichier robots.txt) et propose des observations sourcées pour chaque critère de votre ICP. Ces observations restent à vérifier par vous avant de compter dans le score, comme l’explique la page sur le [lead scoring explicable](/lead-scoring).'},
        {type:'h3',text:'Une analyse d’offre IA'},
        {type:'p',text:'Une analyse d’offre IA aide à formuler votre profil client idéal à partir de la description de votre offre. Vous relisez et modifiez les critères proposés avant de les enregistrer.'},
      ]},
      {h2:'Les règles de décompte qui protègent votre quota',blocks:[
        {type:'ol',items:[
          'Une recherche dont la source n’a répondu à aucune requête n’est pas décomptée : votre quota est rendu automatiquement.',
          'Avec l’offre Équipe, une recherche identique lancée par un coéquipier depuis moins de 7 jours est reprise depuis la base partagée, sans nouvelle requête et sans être décomptée.',
          'Les quotas de l’offre Équipe forment un pot commun : tous les comptes de l’équipe puisent dans les mêmes volumes mensuels, calculés selon le nombre de comptes payés.',
          'Les quotas sont appliqués par notre serveur, jamais par le navigateur : le compteur affiché dans votre compte est celui qui fait foi.',
        ]},
      ]},
      {h2:'Libre-service ou veille dédiée : deux façons d’utiliser ProspectOS',blocks:[
        {type:'p',text:'Les offres Solo, Pro et Équipe sont en libre-service : vous lancez vos recherches et vérifiez vous-même les preuves, au prix affiché. La veille dédiée est un service : ProspectOS prépare une liste sur votre cible et vos zones (registre, BODACC, BOAMP), la met à jour à la fréquence convenue et vous la livre en PDF et en CSV. Son fonctionnement est détaillé sur la page [veille entreprises](/veille-entreprises).'},
        {type:'p',text:'Son prix dépend des zones, des sources et de la fréquence : il est fixé sur devis, avant tout engagement. La méthode suivie est décrite sur la page [prospection B2B](/prospection-b2b).'},
      ]},
      {h2:'Choisir entre Solo, Pro et Équipe',blocks:[
        {type:'p',text:'Les offres Solo et Pro concernent une seule personne qui prospecte : dirigeant, indépendant ou commercial unique ; Pro triple les volumes de Solo. L’offre Équipe sert aux équipes de 2 à 5 comptes qui prospectent les mêmes marchés ; le nombre de comptes se choisit sur la page de paiement : chacun voit les recherches des autres, les prospects sont partagés, et une même requête n’est pas payée deux fois.'},
        {type:'callout',title:'Comment fonctionne l’offre Équipe',text:'Le titulaire de l’abonnement Équipe invite ses coéquipiers par un lien personnel, valable 7 jours et utilisable une seule fois. L’invitation n’est acceptée que par le compte dont l’adresse e-mail confirmée correspond à celle invitée. Si l’abonnement Équipe prend fin, les membres gardent l’accès en lecture aux données de l’équipe.'},
        {type:'p',text:'Avant de choisir, la démonstration publique permet de parcourir des prospects de test, leurs sources et un score expliqué, sans créer de compte. Pour comprendre la place exacte de l’IA dans le produit, voir la page sur la [prospection assistée par IA](/prospection-ia).'},
      ]},
    ],
    faq:[
      {q:'Combien coûte ProspectOS ?',a:`ProspectOS Solo coûte ${SOLO_EUR} € par mois et ProspectOS Pro ${PRO_EUR} € par mois, pour 1 compte. ProspectOS Équipe coûte ${TEAM_EUR} € par mois pour ${TEAM_INCL} comptes, + ${TEAM_EXTRA_EUR} € par compte supplémentaire, jusqu’à ${TEAM_MAX} comptes. Chaque compte commence par un essai gratuit de 7 jours, sans carte bancaire.`},
      {q:'Que se passe-t-il à la fin de l’essai gratuit ?',a:'Aucun abonnement n’est souscrit automatiquement et rien ne vous est facturé. Vos données restent consultables et exportables ; pour relancer des recherches et des analyses, vous choisissez une offre depuis votre compte.'},
      {q:'Quelle différence entre un abonnement et la veille dédiée ?',a:'Avec un abonnement, vous utilisez le logiciel vous-même, au prix affiché. Avec la veille dédiée, ProspectOS prépare et met à jour la liste pour vous, sur devis.'},
      {q:'Comment est fixé le prix de la veille dédiée ?',a:'Sur devis, après un échange sur votre cible. Le devis indique le prix, la durée, la fréquence de mise à jour et les conditions d’arrêt avant tout engagement. Écrivez à contact@prospectos.fr.'},
      {q:'Que se passe-t-il quand un quota est atteint ?',a:'L’action concernée est refusée jusqu’au renouvellement mensuel ou jusqu’au passage à une offre supérieure. Vos prospects, vos preuves et vos exports restent accessibles.'},
      {q:'Puis-je exporter mes données ?',a:'Oui, dans toutes les offres : export CSV des prospects et export complet des données du compte. La suppression du compte se fait aussi en libre-service.'},
    ],
    cta:{title:'Essayez ProspectOS sur vos vrais prospects',text:'7 jours gratuits, sans carte bancaire. Vous choisissez votre offre ensuite, depuis votre compte.',href:'/#inscription',label:'Démarrer mon essai gratuit — 7 jours'},
    related:['logiciel-prospection-b2b','prospection-ia','a-propos'],
  },
  {
    slug:'logiciel-prospection-b2b',
    navLabel:'Logiciel de prospection B2B',
    updated:'2026-11-18',
    keywords:{primary:'logiciel de prospection B2B',secondary:['outil de prospection commerciale','comparatif des outils de prospection','prospection BODACC','appels d’offres BOAMP']},
    title:'Logiciel de prospection B2B : sources officielles et preuves | ProspectOS',
    description:'Logiciel de prospection B2B : entreprises repérées dans le registre, le BODACC et le BOAMP, chaque fait sourcé et vérifié, aucun envoi automatique. Essai de 7 jours.',
    eyebrow:'LOGICIEL · PROSPECTION B2B',
    h1:'Logiciel de prospection B2B : qui contacter, pourquoi maintenant, sur quelle source',
    intro:'Un logiciel de prospection B2B doit répondre à trois questions avant tout envoi : quelle entreprise contacter, pourquoi maintenant, et sur quelle source repose cette réponse. ProspectOS y répond à partir de sources officielles françaises : le registre des entreprises, les annonces légales du BODACC et les appels d’offres du BOAMP. Chaque fait garde son lien vers la source, une personne le vérifie, et aucun message ne part automatiquement. Cette page compare les grandes approches de prospection, décrit ce que fait le logiciel et dit aussi ce qu’il ne fait pas.',
    sections:[
      {h2:'Quatre façons de trouver des prospects B2B, et leurs limites',blocks:[
        {type:'p',text:'Aucune approche n’est parfaite. Le bon choix dépend de ce que vous vendez, du volume visé et du temps que vous pouvez consacrer à chaque contact.'},
        {type:'ul',items:[
          'Fichiers de contacts achetés : rapides à obtenir, mais leur fraîcheur varie et l’origine de chaque coordonnée doit pouvoir être justifiée au regard du RGPD. Ils disent qui existe, rarement pourquoi contacter maintenant.',
          'Extraction de profils sur les réseaux sociaux : riche en noms et en fonctions, mais les conditions d’utilisation de LinkedIn interdisent l’extraction automatisée, et le compte utilisé peut être restreint.',
          'Outils d’envoi automatique : utiles pour le volume, mais des messages génériques envoyés en masse exposent la réputation de votre domaine d’envoi et obtiennent peu de réponses qualifiées.',
          'Sources officielles, l’approche de ProspectOS : des faits publics, datés et vérifiables (création, reprise, appel d’offres). En contrepartie, ces sources ne donnent ni e-mail ni téléphone, et un événement non publié reste invisible.',
        ]},
      ]},
      {h2:'Ce que fait ProspectOS au quotidien',blocks:[
        {type:'ol',items:[
          'Vous décrivez votre offre ; l’analyse d’offre propose un profil client idéal (ICP) en critères pondérés, que vous corrigez et validez.',
          'Vous lancez une recherche par secteur, zone et tranche d’effectif dans le registre, ou une recherche de reprises récentes dans le BODACC.',
          'Dans l’écran Recherche, le bloc « Appels d’offres ouverts » liste les marchés publics du BOAMP auxquels vous pouvez encore répondre, avec le mot-clé qui a fait ressortir chaque avis.',
          'Pour chaque entreprise retenue, les observations sont rattachées à leur source : l’URL, l’extrait exact et la date. Seules celles que vous confirmez deviennent des preuves.',
          'Le score de 0 à 100 s’explique critère par critère ; il ordonne votre liste, il ne prédit pas une vente.',
          'ProspectOS prépare une approche à partir du fait vérifié le plus important ; vous la relisez et l’envoyez depuis votre propre messagerie.',
        ]},
        {type:'p',text:'Les étapes de la méthode elle-même, indépendamment du logiciel, sont décrites dans [la méthode de prospection B2B](/prospection-b2b). Le calcul du score est détaillé sur la page [lead scoring explicable](/lead-scoring).'},
      ]},
      {h2:'Les sources : registre, BODACC et BOAMP',blocks:[
        {type:'h3',text:'Le registre des entreprises'},
        {type:'p',text:'L’API Recherche d’entreprises publie les données du registre national sous Licence Ouverte : activité (code NAF), adresse de l’établissement, tranche d’effectif, état administratif. Vos mots métier sont traduits en activités NAF, avec une explication que vous confirmez ; un mot sans correspondance est signalé, jamais deviné.'},
        {type:'h3',text:'Le BODACC'},
        {type:'p',text:'Le Bulletin officiel des annonces civiles et commerciales publie les créations, les ventes de fonds de commerce et les changements de dirigeant. Une reprise ou un nouveau dirigeant est souvent le moment où une entreprise revoit ses outils et ses prestataires. Chaque annonce est datée et accessible par son lien officiel.'},
        {type:'h3',text:'Le BOAMP'},
        {type:'p',text:'Le Bulletin officiel des annonces des marchés publics liste les appels d’offres en cours. ProspectOS n’affiche que les avis dont la date limite n’est pas passée et renvoie toujours vers l’avis officiel. Rien n’est enregistré ni répondu à votre place.'},
      ]},
      {h2:'Trois recherches menées avec ProspectOS',blocks:[
        {type:'p',text:'Ces cas décrivent la démarche, sans résultat annoncé ni entreprise nommée. Agences et consultants : voir [les signaux par métier](/prospection-agences-consultants).'},
        {type:'h3',text:'Garages repris en Île-de-France'},
        {type:'p',text:'Pour un éditeur d’assistant de messagerie destiné aux garages : les ventes de fonds de garages publiées au BODACC dans les huit départements franciliens, chaque acquéreur vérifié au registre, les garages qui vendent des véhicules placés en tête, et une première phrase qui cite la reprise.'},
        {type:'h3',text:'Hôtels et restaurants qui changent de propriétaire'},
        {type:'p',text:'Pour un fournisseur de l’hôtellerie : les reprises d’hôtels et de restaurants sur 90 jours dans plusieurs régions, avec le prix de cession quand l’annonce l’indique. La liste signale aussi sa limite : un rachat des parts de la société n’apparaît pas dans les ventes de fonds.'},
        {type:'h3',text:'Appels d’offres en sécurité incendie'},
        {type:'p',text:'Pour une entreprise de sécurité incendie : les marchés publics ouverts du BOAMP dans ses départements d’intervention, triés par date limite de réponse, chacun avec son acheteur public et le lien vers l’avis.'},
      ]},
      {h2:'Ce que ProspectOS ne fait pas',blocks:[
        {type:'callout',title:'Des limites assumées',text:'ProspectOS n’envoie aucun message automatiquement, ne vend pas de fichier de contacts, n’extrait pas de données de LinkedIn ni des pages de résultats des moteurs de recherche, ne fournit ni e-mail ni téléphone personnels et ne transforme jamais une supposition en preuve. La décision de contacter reste humaine.'},
      ]},
      {h2:'Tarif et premiers pas',blocks:[
        {type:'p',text:`L’essai gratuit dure 7 jours, sans carte bancaire. Ensuite, ProspectOS Solo coûte ${SOLO_EUR} € par mois et ProspectOS Pro ${PRO_EUR} € par mois pour un compte ; ProspectOS Équipe coûte ${TEAM_EUR} € par mois pour ${TEAM_INCL} comptes, + ${TEAM_EXTRA_EUR} € par compte supplémentaire, jusqu’à ${TEAM_MAX} comptes. Les quotas et les règles de décompte sont détaillés sur la page des [tarifs de ProspectOS](/tarifs). Une démonstration publique avec des données de test est accessible sans compte.`},
      ]},
    ],
    faq:[
      {q:'Quelle différence entre un logiciel de prospection et un fichier de prospects ?',a:'Un fichier donne une liste figée de contacts. ProspectOS cherche les entreprises au moment de votre recherche, dans des sources publiques, et documente pourquoi chacune correspond ou non à votre offre, avec la source de chaque fait.'},
      {q:'ProspectOS fournit-il des e-mails ou des numéros de téléphone ?',a:'Non. Les sources officielles n’en publient pas pour les personnes, et ProspectOS n’en invente pas. Un canal de contact professionnel peut être rattaché à une fiche s’il est trouvé sur le site officiel de l’entreprise, avec sa source.'},
      {q:'ProspectOS envoie-t-il des messages à ma place ?',a:'Non. Il prépare une approche à partir des faits vérifiés ; vous la relisez, la modifiez si besoin et l’envoyez depuis votre propre outil.'},
      {q:'Quelles entreprises peut-on trouver ?',a:'Les entreprises françaises inscrites au registre, filtrables par activité, zone et effectif, celles qui apparaissent dans les annonces du BODACC (créations, reprises, changements de dirigeant), et les acheteurs publics qui publient des appels d’offres au BOAMP.'},
    ],
    cta:{title:'Essayer le logiciel sur votre cible',text:'La démonstration publique montre, sans compte, des prospects de test avec leurs sources ; l’essai de 7 jours lance de vraies recherches sur vos critères.'},
    related:['prospection-b2b','tarifs','qualifier-un-prospect-b2b','a-propos'],
  },
  {
    slug:'veille-entreprises',
    navLabel:'Veille entreprises : chaque lundi',
    updated:'2026-11-15',
    keywords:{primary:'veille entreprises',secondary:['liste des entreprises nouvellement créées','veille BODACC','entreprises qui déménagent','fichier de prospection B2B']},
    title:'Veille entreprises : nouvelles sociétés et reprises | ProspectOS',
    description:'Veille entreprises dédiée : chaque lundi, les sociétés qui viennent de s’installer, de déménager ou d’être reprises dans vos zones, vérifiées et sourcées au BODACC.',
    eyebrow:'SERVICE · VEILLE DÉDIÉE',
    h1:'Veille entreprises : les sociétés à appeler cette semaine, livrées chaque lundi',
    intro:'Une entreprise qui vient de s’installer, d’ouvrir un établissement, de déménager son siège ou d’être reprise revoit ses prestataires : locaux à équiper, contrats à renégocier, vérifications à programmer. Ces événements sont publics, datés et publiés chaque jour. La veille dédiée de ProspectOS les repère pour vous, les vérifie et vous livre chaque lundi la liste des entreprises à appeler dans vos zones, avec la raison de l’appel et le lien vers la source officielle.',
    sections:[
      {h2:'Ce que vous recevez chaque lundi',blocks:[
        {type:'ul',items:[
          'Une liste numérotée et datée, en PDF et en CSV, des entreprises qui correspondent à votre métier et à vos départements.',
          'Pour chaque entreprise : le fait publié et sa date, pourquoi c’est le bon moment, une première phrase d’accroche qui cite ce fait, et le lien vers la publication officielle.',
          'Un espace de suivi dans ProspectOS : le statut de chaque entreprise (à contacter, contacté, devis envoyé, signé, perdu), un journal horodaté et, si vous êtes rémunéré au résultat, le relevé du mois.',
        ]},
        {type:'p',text:'Le nombre d’entreprises dépend de ce qui est publié pendant la semaine : aucun volume minimum n’est promis. Une liste courte et juste vaut mieux qu’un long fichier à trier.'},
      ]},
      {h2:'Les événements qui déclenchent un appel',blocks:[
        {type:'h3',text:'Créations et nouveaux établissements'},
        {type:'p',text:'Une société qui s’immatricule ou ouvre un établissement doit équiper ses locaux et choisir ses premiers fournisseurs. L’annonce indique l’activité déclarée et la commune.'},
        {type:'h3',text:'Transferts de siège'},
        {type:'p',text:'Une nouvelle adresse signifie souvent de nouveaux locaux : aménagement, sécurité, maintenance, télécoms. C’est le signal le plus utile pour les métiers qui interviennent sur place.'},
        {type:'h3',text:'Reprises de fonds de commerce'},
        {type:'p',text:'Un nouveau propriétaire remet les contrats à plat. La veille signale les ventes de fonds publiées au BODACC, côté acquéreur, avec le prix quand l’annonce l’indique.'},
        {type:'h3',text:'Installations classées inspectées'},
        {type:'p',text:'Pour la sécurité incendie et la maintenance industrielle, la base officielle des installations classées indique les entrepôts et sites inspectés récemment.'},
      ]},
      {h2:'Pourquoi une veille plutôt qu’un fichier acheté',blocks:[
        {type:'p',text:'Le BODACC publie plusieurs milliers d’annonces chaque semaine : environ 5 500 en Île-de-France sur la semaine du 2 au 8 novembre 2026. Les lire, écarter le hors-cible, vérifier chaque entreprise au registre et préparer une raison d’appeler représente plusieurs heures par semaine. Un fichier acheté dit qui existe ; la veille dit qui vient de changer, et pourquoi l’appeler maintenant.'},
        {type:'p',text:'Le même travail peut être fait en libre-service avec le [logiciel de prospection B2B](/logiciel-prospection-b2b), si vous préférez mener vos recherches vous-même. La méthode de fond est décrite dans [la méthode de prospection B2B](/prospection-b2b).'},
      ]},
      {h2:'Sources officielles et données personnelles',blocks:[
        {type:'p',text:'Les faits viennent du BODACC (DILA), de la base des installations classées (Géorisques) et du registre des entreprises (API Recherche d’entreprises), publiés sous Licence Ouverte. Chaque entreprise est vérifiée au registre avant livraison : active, avec un SIREN, et sans opposition à la prospection commerciale.'},
        {type:'callout',title:'Des entreprises, pas des personnes',text:'Les entrepreneurs individuels et les entreprises inscrites comme opposées à la prospection commerciale sont retirés de chaque liste. Aucune adresse ni coordonnée personnelle n’est fournie, et ProspectOS ne contacte jamais les entreprises à votre place.'},
      ]},
      {h2:'Tarif : au forfait ou au résultat',blocks:[
        {type:'p',text:'La veille dédiée est proposée sur devis, au forfait par région ou au résultat : un minimum mensuel et une commission par client signé, le plus élevé des deux étant facturé. Le premier mois peut être offert, sans engagement. Les abonnements en libre-service sont détaillés sur la page [tarifs](/tarifs).'},
      ]},
    ],
    faq:[
      {q:'Quelles zones peut couvrir la veille ?',a:'Toute la France métropolitaine et les départements d’outre-mer publiés au BODACC. Vous choisissez vos départements ; la liste ne contient que ceux-là.'},
      {q:'Combien d’entreprises par semaine ?',a:'Cela dépend de votre métier, de vos zones et de ce qui est publié : aucun volume minimum n’est promis. Chaque entreprise livrée est vérifiée et sourcée.'},
      {q:'Puis-je arrêter quand je veux ?',a:'Oui. Au mois, la veille est résiliable avec un préavis de 30 jours ; le premier mois peut être offert et renonçable sans frais.'},
      {q:'Est-ce conforme au RGPD ?',a:'La veille ne livre que des entreprises, à partir de données publiques officielles. Les entrepreneurs individuels et les entreprises opposées à la prospection commerciale sont retirés avant livraison.'},
    ],
    cta:{title:'Recevoir un échantillon sur votre zone',text:'Écrivez à contact@prospectos.fr avec votre métier et vos départements : vous recevez un échantillon de la liste avant toute décision.',href:'/tarifs',label:'Voir les tarifs'},
    related:['logiciel-prospection-b2b','tarifs','prospection-b2b'],
  },
  {
    slug:'prospection-agences-consultants',
    navLabel:'Agences, consultants, freelances : trouver des clients',
    updated:'2026-11-18',
    keywords:{primary:'trouver des clients agence',secondary:['prospection consultant indépendant','trouver des clients freelance B2B','prospection PME','signaux d’achat BODACC']},
    title:'Trouver des clients pour votre agence | ProspectOS',
    description:'Agences, consultants indépendants, freelances tech : repérez les PME au moment où elles achètent (reprise, création, transfert de siège), sources officielles à l’appui.',
    eyebrow:'AGENCES · CONSULTANTS · FREELANCES',
    h1:'Trouver des clients pour une agence, un consultant ou un freelance qui vend aux PME',
    intro:'Une agence, un consultant ou un freelance n’a pas besoin de mille prospects, mais de quelques PME au bon moment : celles qui viennent de changer. ProspectOS les repère dans les annonces officielles, chaque fiche avec sa source.',
    sections:[
      {h2:'Vendre cher sans commercial : le problème des indépendants',blocks:[
        {type:'p',text:'Vos missions valent plusieurs milliers d’euros et chaque client compte. Sans commercial, la prospection passe après la production et le chiffre d’affaires dépend du bouche-à-oreille : des mois pleins, puis des creux.'},
      ]},
      {h2:'Le bon moment pour contacter une PME',blocks:[
        {type:'p',text:'Une PME achète quand quelque chose change chez elle. Voici ce que ProspectOS repère aujourd’hui, et où.'},
        {type:'ul',items:[
          'Reprise d’un fonds de commerce (BODACC) : un repreneur revoit ses outils et son organisation dans les premiers mois. Recherche « Reprises de commerces » sur 90 jours, par zone et activité.',
          'Création de société : tout est à mettre en place, du site au logiciel de gestion. Repérée dans la veille dédiée et dans le suivi des entreprises.',
          'Transfert du siège social : de nouveaux locaux et une organisation à revoir. Veille dédiée et suivi.',
          'Augmentation de capital : l’entreprise se donne des moyens et doit les employer vite. Repérée sur les entreprises que vous suivez.',
          'Changement de dirigeant : un nouveau responsable remet à plat les priorités et les prestataires. Repéré sur les entreprises que vous suivez.',
          'Appel d’offres public (BOAMP) : un besoin décrit, avec une date limite. Bloc « Appels d’offres ouverts », par mots-clés et départements.',
        ]},
        {type:'p',text:'Une procédure collective n’est jamais présentée comme un moment d’achat : ProspectOS l’écarte et le signale.'},
      ]},
      {h2:'Quel signal suivre selon votre métier',blocks:[
        {type:'table',caption:'Correspondances métier → signal',head:['Votre métier','Signaux à suivre en priorité'],rows:[
          ['Agence web','Création de société, transfert de siège, reprise de fonds : un site à créer ou à refaire.'],
          ['Agence d’automatisation et d’IA','Reprise de fonds, augmentation de capital : des process à reprendre et des moyens pour les outiller.'],
          ['Développeur ERP ou CRM','Reprise de fonds, augmentation de capital, transfert de siège : un système d’information à faire évoluer.'],
          ['Consultant en organisation','Changement de dirigeant, reprise de fonds : une organisation à repenser.'],
          ['Agence marketing','Création de société, reprise de fonds, appels d’offres publics de communication.'],
          ['Expert-comptable','Création de société, reprise de fonds : un cabinet à choisir dès le départ.'],
        ]},
      ]},
      {h2:'Trois recherches réelles sur les 90 derniers jours',blocks:[
        {type:'p',text:`Comptages faits le ${AGENCY_FIGURES.computedOnLabel} sur les annonces publiées du ${AGENCY_FIGURES.from} au ${AGENCY_FIGURES.to}, avec les règles de ProspectOS : seules les sociétés sont retenues, jamais une personne.`},
        {type:'ul',items:[
          `Reprises de fonds en Haute-Garonne : ${nf(AGENCY_FIGURES.salesHauteGaronne.companies)} sociétés acquéreuses, dont ${nf(AGENCY_FIGURES.salesHauteGaronne.tenOrMore)} de 10 salariés ou plus au registre, et ${nf(AGENCY_FIGURES.salesHauteGaronne.tenOrMoreContactable)} de celles-ci actives et sans opposition à la prospection.`,
          `Créations de sociétés en Île-de-France : ${nf(AGENCY_FIGURES.creationsIdf.companies)} sociétés ; ${nf(AGENCY_FIGURES.creationsIdf.soleTradersLeftOut)} annonces d’entrepreneurs individuels écartées.`,
          `Transferts de siège dans les Hauts-de-Seine : ${nf(AGENCY_FIGURES.movesHautsDeSeine.companies)} sociétés.`,
        ]},
        {type:'callout',title:'Ce que ces chiffres ne disent pas',text:'Une partie des sociétés refuse la prospection commerciale au registre : ProspectOS les retire avant toute livraison. Dans nos relevés de novembre, c’est le cas de la plupart des sociétés tout juste créées, et moins souvent des entreprises reprises.'},
      ]},
      {h2:'Comment ça marche, en trois étapes',blocks:[
        {type:'ol',items:[
          'Choisir votre cible : le métier de vos clients, leur zone, leur taille, et les signaux qui comptent pour vous.',
          'Recevoir les entreprises : chaque fiche donne le fait, sa date et le lien vers l’annonce officielle. Rien n’est considéré comme vérifié tant que vous ne l’avez pas confirmé.',
          'Contacter au bon moment : ProspectOS prépare une première phrase à partir du fait. Vous la relisez et l’envoyez vous-même ; aucun message n’est envoyé automatiquement.',
        ]},
      ]},
      {h2:'Deux formules : libre-service ou veille dédiée',blocks:[
        {type:'p',text:`En libre-service, vous lancez vos recherches vous-même : essai gratuit de ${TRIAL_DAYS} jours, puis ProspectOS Solo à ${SOLO_EUR} € par mois, Pro à ${PRO_EUR} € ou Équipe à ${TEAM_EUR} € pour ${TEAM_INCL} comptes, sans engagement.`},
        {type:'p',text:'Avec la veille dédiée, nous préparons chaque semaine la liste des entreprises de votre zone et de votre métier ; elle est chiffrée sur devis. Les deux formules sont détaillées sur la page [tarifs](/tarifs), section « Libre-service ou veille dédiée ». La démarche complète est décrite dans [la méthode de prospection B2B](/prospection-b2b).'},
      ]},
    ],
    faq:[
      {q:'D’où viennent les données ?',a:'Du BODACC (créations, ventes de fonds, modifications), du registre des entreprises (activité, effectif, état) et du BOAMP. Chaque fiche renvoie vers l’annonce d’origine.'},
      {q:'Est-ce conforme au RGPD ?',a:'Les données viennent de publications officielles et ProspectOS ne retient que des sociétés : jamais un entrepreneur individuel, jamais une société qui refuse la prospection au registre. Au premier contact, citez la source de l’information et proposez de ne plus recontacter la personne si elle le souhaite.'},
      {q:'Combien d’entreprises par semaine sur ma zone ?',a:'Cela dépend de ce qui est publié : le volume varie selon le département, le métier et la semaine. Les chiffres ci-dessus donnent un ordre de grandeur réel ; aucun volume minimum n’est promis.'},
      {q:'Puis-je essayer sur mon secteur ?',a:`Oui : l’essai gratuit de ${TRIAL_DAYS} jours donne accès aux recherches sur vos propres zones et activités, sans carte bancaire. Pour une veille dédiée, demandez un devis depuis la page [tarifs](/tarifs).`},
    ],
    cta:{title:'Voyez les PME qui bougent sur votre zone',text:`Lancez l’essai gratuit de ${TRIAL_DAYS} jours, ou demandez une veille dédiée.`,href:'/tarifs',label:'Voir les formules'},
    related:['logiciel-prospection-b2b','veille-entreprises','tarifs'],
  },
  {
    slug:'a-propos',
    navLabel:'À propos de ProspectOS',
    updated:'2026-11-11',
    keywords:{primary:'ProspectOS',secondary:['éditeur ProspectOS','logiciel de prospection français','ProspectOS avis']},
    title:'À propos de ProspectOS : prospection B2B fondée sur les sources officielles',
    description:'ProspectOS, logiciel français édité à Toulouse : des prospects B2B trouvés dans les registres officiels, chaque fait sourcé et vérifié avant contact.',
    eyebrow:'À PROPOS',
    h1:'À propos de ProspectOS : qui l’édite et comment il fonctionne',
    intro:'ProspectOS est un logiciel de prospection B2B assisté par IA, édité en France par Kevin Cardia, entrepreneur individuel basé à Toulouse. Il est né d’un constat simple : une liste de prospects vaut ce que valent les raisons de contacter chaque entreprise. Le produit est donc construit autour d’une règle unique, appliquée partout : l’IA propose, l’utilisateur vérifie et décide.',
    sections:[
      {h2:'L’éditeur de ProspectOS',blocks:[
        {type:'p',text:'ProspectOS est édité par Kevin Cardia, entrepreneur individuel (régime de la micro-entreprise) établi à Toulouse, en France. Les informations légales complètes figurent dans les [mentions légales](/mentions-legales), et le traitement des données personnelles est décrit dans la [politique de confidentialité](/confidentialite).'},
        {type:'p',text:'Le contact se fait par e-mail à contact@prospectos.fr. ProspectOS est une application web, utilisable en français et en anglais, sans installation.'},
      ]},
      {h2:'Les principes qui guident le produit',blocks:[
        {type:'ol',items:[
          'Prospection autonome, action humaine : le logiciel cherche, lit et prépare ; une personne vérifie, décide et envoie.',
          'Aucune preuve inventée : chaque observation garde son URL, son extrait exact et sa date d’observation.',
          'Une recommandation expliquée : pour chaque entreprise, ProspectOS dit s’il faut contacter, vérifier ou attendre, pourquoi maintenant, et sur quelles preuves ; les preuves et leurs sources restent visibles, et rien n’est tenu pour acquis sans votre validation.',
          'Aucun envoi automatique : ProspectOS ne contacte personne à votre place.',
          'Aucune déduction depuis des connaissances externes : une information non trouvée dans une source reste inconnue.',
        ]},
      ]},
      {h2:'Les sources de données utilisées',blocks:[
        {type:'p',text:'Pour trouver des entreprises françaises, ProspectOS interroge l’API Recherche d’entreprises, qui diffuse les données du registre public des entreprises sous Licence Ouverte. Ces données servent à découvrir des candidats ; elles ne deviennent jamais une preuve à elles seules.'},
        {type:'p',text:'Pour qualifier un prospect, ProspectOS lit le site officiel de l’entreprise en respectant son fichier robots.txt, et une recherche web peut compléter la découverte. La façon dont ces observations deviennent des preuves est détaillée dans la page sur la [prospection assistée par IA](/prospection-ia).'},
      ]},
      {h2:'Données, sécurité et contrôle du compte',blocks:[
        {type:'ul',items:[
          'Chaque compte n’accède qu’aux données de son organisation, contrôlées côté base de données.',
          'Les quotas et les droits sont appliqués par le serveur, jamais par le navigateur.',
          'L’export complet des données du compte et sa suppression se font en libre-service.',
          'Une clé API Anthropic personnelle peut être enregistrée pour vos propres analyses ; elle n’est jamais réaffichée.',
        ]},
        {type:'callout',title:'Ce que ProspectOS ne publie pas',text:'Aucun client, aucun avis, aucune note et aucun résultat chiffré ne sont annoncés sur ce site tant qu’ils ne sont pas vérifiables. La démonstration publique montre le produit sur des exemples d’entreprises construits à partir de données publiques ; ces entreprises ne sont ni des clientes ni des partenaires de ProspectOS.'},
      ]},
      {h2:'Essayer ProspectOS et choisir une offre',blocks:[
        {type:'p',text:`La démonstration publique se parcourt sans compte : elle montre une mission de prospection et des exemples d’entreprises issus de données publiques, avec pour chacune la recommandation expliquée, les preuves et leurs sources, et ce qui reste à vérifier. Pour lancer de vraies recherches, l’essai gratuit dure 7 jours, sans carte bancaire, dans la limite des places ouvertes.`},
        {type:'p',text:`Ensuite, ProspectOS Solo coûte ${SOLO_EUR} € par mois et ProspectOS Pro ${PRO_EUR} € par mois pour une personne ; ProspectOS Équipe coûte ${TEAM_EUR} € par mois pour ${TEAM_INCL} comptes, + ${TEAM_EXTRA_EUR} € par compte supplémentaire, jusqu’à ${TEAM_MAX} comptes, avec une base de prospects et des quotas partagés. Le détail des volumes et des règles de décompte figure sur la page des [tarifs](/tarifs).`},
      ]},
    ],
    faq:[
      {q:'Qui édite ProspectOS ?',a:'Kevin Cardia, entrepreneur individuel basé à Toulouse. Les informations légales complètes sont dans les [mentions légales](/mentions-legales).'},
      {q:'Comment contacter ProspectOS ?',a:'Par e-mail à contact@prospectos.fr, y compris pour l’offre Entreprise / White Label.'},
      {q:'Où sont décrits les prix ?',a:'Sur la page des [tarifs](/tarifs) : essai gratuit de 7 jours, offres Solo, Pro et Équipe, offre Entreprise sur devis.'},
    ],
    cta:{title:'Découvrir ProspectOS',text:'La démonstration publique est accessible sans compte, sur des exemples issus de données publiques.'},
    related:['logiciel-prospection-b2b','tarifs','prospection-b2b'],
  },
];
