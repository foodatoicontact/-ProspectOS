export const SITE_URL=(process.env.NEXT_PUBLIC_SITE_URL??'https://prospectos-v0.vercel.app').replace(/\/$/,'');

export const siteMetadata={
  title:'ProspectOS — Logiciel de prospection B2B fondé sur des preuves',
  description:'ProspectOS est un logiciel de prospection B2B assisté par IA qui qualifie et score des prospects à partir de preuves vérifiables, puis prépare une approche personnalisée avec validation humaine.',
  canonical:SITE_URL,
};

export type SeoPage={
  slug:string;
  title:string;
  description:string;
  eyebrow:string;
  h1:string;
  intro:string;
  sections:{title:string;body:string}[];
};

export const seoPages:SeoPage[]=[
  {
    slug:'prospection-b2b',
    title:'Prospection B2B fondée sur des preuves | ProspectOS',
    description:'Structurez votre prospection B2B avec des prospects documentés, un scoring explicable et des preuves vérifiables avant toute prise de contact commerciale.',
    eyebrow:'PROSPECTION B2B',
    h1:'Une prospection B2B qui explique pourquoi chaque prospect mérite votre attention.',
    intro:'ProspectOS organise la qualification commerciale autour de faits sourcés : activité, zone géographique, signaux de besoin et canaux de contact documentés. L’objectif est de réduire la prospection au hasard sans automatiser aveuglément la prise de contact.',
    sections:[
      {title:'Qualifier avant de contacter',body:'Chaque critère possède un poids, un statut de preuve et une source. Une information inconnue ne rapporte aucun point et une contradiction déclenche une revue.'},
      {title:'Comprendre le score',body:'Le score commercial reste lisible : vous voyez les critères confirmés, ceux qui restent à vérifier et les sources qui justifient la qualification.'},
      {title:'Garder la décision humaine',body:'ProspectOS prépare l’approche et les éléments utiles, mais les actions finales de prospection restent sous contrôle humain.'},
    ],
  },
  {
    slug:'prospection-ia',
    title:'Prospection IA avec validation humaine | ProspectOS',
    description:'Utilisez l’IA pour analyser et qualifier des prospects sans transformer une inférence en fait : ProspectOS exige des sources et conserve une validation humaine.',
    eyebrow:'PROSPECTION & IA',
    h1:'L’IA peut accélérer la prospection sans inventer ce qu’elle ne sait pas.',
    intro:'ProspectOS utilise l’IA comme outil d’analyse et de préparation, pas comme source de vérité. Une information absente reste inconnue et une observation automatique doit être vérifiée avant d’influencer les actions commerciales sensibles.',
    sections:[
      {title:'Des faits avant les formulations',body:'Les messages personnalisés sont construits à partir d’informations vérifiées afin d’éviter les accroches qui prétendent connaître un besoin non documenté.'},
      {title:'Des observations traçables',body:'Les signaux collectés conservent leur URL, leur extrait, leur date et leur niveau de confiance pour permettre une revue rapide.'},
      {title:'Une IA au service du commercial',body:'Le système aide à classer, résumer et préparer. Il ne remplace pas le jugement humain au moment de contacter un prospect.'},
    ],
  },
  {
    slug:'lead-scoring',
    title:'Lead scoring explicable et sourcé | ProspectOS',
    description:'Priorisez vos prospects avec un lead scoring transparent : critères pondérés, preuves vérifiées, couverture documentaire et explication détaillée de chaque score.',
    eyebrow:'LEAD SCORING',
    h1:'Un lead scoring utile seulement si vous pouvez expliquer chaque point.',
    intro:'ProspectOS sépare le potentiel commercial de la couverture documentaire. Le score ne monte que lorsque les critères correspondants disposent de preuves conformes aux règles du projet.',
    sections:[
      {title:'Critères pondérés',body:'Chaque ICP peut définir ses propres critères et leurs poids. Le total reste lisible et l’impact de chaque signal est visible.'},
      {title:'Inconnu ne veut pas dire positif',body:'Une information non trouvée ou non vérifiée ne rapporte aucun point. Cela évite de gonfler artificiellement la priorité d’un prospect.'},
      {title:'Contradictions visibles',body:'Lorsque deux preuves vérifiées se contredisent, le critère passe en revue au lieu de produire silencieusement un score trompeur.'},
    ],
  },
  {
    slug:'prospection-restaurants',
    title:'Prospection commerciale pour restaurants | ProspectOS',
    description:'Identifiez et qualifiez des restaurants à partir de signaux publics : commande par téléphone, plateformes de livraison, click & collect et autres preuves commerciales.',
    eyebrow:'CAS D’USAGE RESTAURATION',
    h1:'Qualifier les restaurants à prospecter à partir de signaux réellement observés.',
    intro:'La verticale de démonstration Foodatoi montre comment ProspectOS peut documenter un établissement, vérifier ses modes de commande et préparer une approche adaptée sans inventer de contexte commercial.',
    sections:[
      {title:'Signaux adaptés au terrain',body:'Activité alimentaire, localisation, commande par téléphone, plateformes de livraison, click & collect ou livraison interne peuvent être suivis comme critères distincts.'},
      {title:'Sources visibles',body:'Chaque affirmation utile peut être rattachée à un site officiel ou une autre source publique autorisée afin que le commercial puisse la vérifier.'},
      {title:'De la découverte à l’approche',body:'Le Discovery Engine prépare les candidats et les observations ; la validation humaine transforme ensuite les preuves pertinentes en qualification exploitable.'},
    ],
  },
];

export const robotsPolicy={
  allow:'/',
  disallow:['/api/','/auth/'],
  sitemap:`${SITE_URL}/sitemap.xml`,
};

export const sitemapEntries=[
  {url:SITE_URL,changeFrequency:'weekly' as const,priority:1},
  ...seoPages.map(page=>({url:`${SITE_URL}/${page.slug}`,changeFrequency:'monthly' as const,priority:.8})),
];

export const softwareApplicationJsonLd={
  '@context':'https://schema.org',
  '@type':'SoftwareApplication',
  name:'ProspectOS',
  url:SITE_URL,
  applicationCategory:'BusinessApplication',
  operatingSystem:'Web',
  description:siteMetadata.description,
};

export const webSiteJsonLd={
  '@context':'https://schema.org',
  '@type':'WebSite',
  name:'ProspectOS',
  url:SITE_URL,
  description:siteMetadata.description,
  inLanguage:'fr-FR',
};

export function getSeoPage(slug:string){
  const page=seoPages.find(item=>item.slug===slug);
  if(!page)throw new Error(`Unknown SEO page: ${slug}`);
  return page;
}
