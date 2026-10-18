// WEB-1 — copy of the ProspectOS 2.0 homepage. Commercial wording (trial CTA, its sub-line, the demo link, sign-in,
// prices, legal) is NOT here: it comes unchanged from src/i18n through app/page.tsx, so the offer reads exactly as on main.
// Every company shown is invented for the demo (tests/web-v2-home.test.ts rejects real names and generic SaaS claims).
import type {Locale} from '../../../i18n/locale.ts';
import type {UiStatus} from '../status.ts';

export type DemoCompany={id:string;name:string;signal:string;meta:string;status:UiStatus;explanation:string;note?:string;
 action:{label:string;tone:'primary'|'contact'}|null};
export type HomeCopy={
 nav:{aria:string;pricing:string;home:string};
 hero:{eyebrow:string;title:string;lines:[string,string,string];subtitle:string;how:string;human:string};
 demo:{label:string;why:string;whyTitle:string;now:string;nowText:string;source:string;sourceText:string;matching:string;
  matchingItems:string[];missing:string;missingItems:string[];completeTitle:string;completeText:string;caption:string;
  signalPrefix:string;verified:string;todo:string;close:string};
 positioning:{line1:string;line2:string;pillars:{key:string;question:string;body:string}[]};
 workflow:{title:string;steps:{name:string;body:string}[];motto:[string,string,string];guarantee:string};
 product:{title:string;body:string;darkTitle:string;darkBody:string;mockAria:string;mockDarkAria:string;today:string;project:string;
  filters:string;counts:{contact:string;verify:string;watch:string};none:string};
 signup:{title:string;body:string;points:string[]};
 seoAria:string;
};

export const HOME_COPY:Record<Locale,HomeCopy>={
 fr:{
  nav:{aria:'Navigation principale',pricing:'Tarifs',home:'ProspectOS — accueil'},
  hero:{eyebrow:'Logiciel de prospection B2B',title:'Arrêtez de prospecter toute votre liste.',
   lines:['Qui contacter.','Pourquoi maintenant.','Avec quelles preuves.'],
   subtitle:'ProspectOS détecte les entreprises qui correspondent à votre cible et les signaux qui rendent le timing pertinent.',
   how:'Voir comment ça fonctionne',human:'Aucun envoi automatique : vous gardez la main.'},
  demo:{label:'Exemple fictif',why:'Voir pourquoi',whyTitle:'Pourquoi cette recommandation ?',now:'Pourquoi maintenant',
   nowText:'Ouverture d’un nouvel établissement annoncée il y a 4 jours.',source:'Source',sourceText:'Article de presse locale, avec lien et extrait.',
   matching:'Ce qui correspond déjà',matchingItems:['Restauration avec point de vente physique','Implantée dans votre zone'],
   missing:'Ce qui manque pour décider',missingItems:['Décision d’achat prise localement','Un contact professionnel documenté'],
   completeTitle:'Que manque-t-il pour décider ?',
   completeText:'Une information compte quand une source la documente. Vous l’ajoutez depuis la fiche de l’entreprise ; la recommandation se met à jour ensuite.',
   caption:'Entreprise inventée pour la démonstration. Dans ProspectOS, chaque élément renvoie à sa source.',
   signalPrefix:'Signal : ',verified:'Vérifié',todo:'À documenter',close:'Fermer le détail'},
  positioning:{line1:'Une liste vous dit qui existe.',line2:'ProspectOS vous dit qui mérite votre attention maintenant.',
   pillars:[
    {key:'Fit',question:'Est-ce la bonne entreprise ?',body:'Chaque critère de votre cible est vérifié, ou signalé comme manquant.'},
    {key:'Timing',question:'Pourquoi maintenant ?',body:'Un signal public récent rend le contact pertinent : ouverture, recrutement, levée de fonds, lancement.'},
    {key:'Preuve',question:'Sur quoi repose la recommandation ?',body:'Chaque élément renvoie à sa source : lien, extrait, date.'},
   ]},
  workflow:{title:'De votre cible à une décision.',
   steps:[
    {name:'Cible',body:'Vous décrivez les entreprises que vous voulez atteindre.'},
    {name:'Signaux publics',body:'ProspectOS repère ce qui change chez elles.'},
    {name:'Preuves',body:'Chaque signal est rattaché à sa source.'},
    {name:'Recommandation',body:'Contacter, vérifier ou attendre — avec la raison.'},
    {name:'Action humaine',body:'Vous décidez de la suite.'},
   ],
   motto:['L’IA propose.','Vous vérifiez.','Vous décidez.'],
   guarantee:'Aucun envoi automatique : aucun message ne part sans votre validation.'},
  product:{title:'Votre journée commence par l’essentiel.',
   body:'« Aujourd’hui » rassemble les entreprises à contacter, à vérifier ou à garder en veille, dans l’ordre où elles comptent.',
   darkTitle:'Le même produit, en thème sombre.',darkBody:'Clair ou sombre, selon votre préférence. La lecture et les couleurs gardent le même sens.',
   mockAria:'Aperçu de l’écran Aujourd’hui en thème clair, avec trois entreprises fictives : une à contacter, une à vérifier, une en veille.',
   mockDarkAria:'Aperçu de l’écran Aujourd’hui en thème sombre, avec les mêmes entreprises fictives.',
   today:'Aujourd’hui',project:'Projet d’exemple · Ouvertures en Occitanie',filters:'Filtres',
   counts:{contact:'à contacter',verify:'à vérifier',watch:'en veille'},none:'Rien à faire pour l’instant.'},
  signup:{title:'Essayez ProspectOS sur votre cible.',body:'Créez votre compte, décrivez votre cible : vos premières recommandations arrivent avec leurs sources.',
   points:['Recommandations expliquées','Sources visibles','Décision humaine']},
  seoAria:'Découvrir ProspectOS',
 },
 en:{
  nav:{aria:'Main navigation',pricing:'Pricing',home:'ProspectOS — home'},
  hero:{eyebrow:'B2B prospecting software',title:'Stop prospecting your whole list.',
   lines:['Who to contact.','Why now.','With what evidence.'],
   subtitle:'ProspectOS detects the companies that match your target and the signals that make the timing right.',
   how:'See how it works',human:'Nothing is sent automatically: you stay in control.'},
  demo:{label:'Fictitious example',why:'See why',whyTitle:'Why this recommendation?',now:'Why now',
   nowText:'Opening of a new location announced 4 days ago.',source:'Source',sourceText:'Local press article, with link and excerpt.',
   matching:'Already matching',matchingItems:['Restaurant with a physical point of sale','Located in your area'],
   missing:'Missing to decide',missingItems:['Purchasing decided locally','A documented business contact'],
   completeTitle:'What is missing to decide?',
   completeText:'A piece of information counts once a source documents it. You add it from the company record; the recommendation is then updated.',
   caption:'Company invented for the demo. In ProspectOS, every item links to its source.',
   signalPrefix:'Signal: ',verified:'Verified',todo:'To document',close:'Close the detail'},
  positioning:{line1:'A list tells you who exists.',line2:'ProspectOS tells you who deserves your attention now.',
   pillars:[
    {key:'Fit',question:'Is it the right company?',body:'Every criterion of your target is verified, or flagged as missing.'},
    {key:'Timing',question:'Why now?',body:'A recent public signal makes the contact relevant: opening, hiring, funding, launch.'},
    {key:'Evidence',question:'What is the recommendation based on?',body:'Every item links to its source: link, excerpt, date.'},
   ]},
  workflow:{title:'From your target to a decision.',
   steps:[
    {name:'Target',body:'You describe the companies you want to reach.'},
    {name:'Public signals',body:'ProspectOS spots what changes for them.'},
    {name:'Evidence',body:'Every signal is tied to its source.'},
    {name:'Recommendation',body:'Contact, check or wait — with the reason.'},
    {name:'Human action',body:'You decide what happens next.'},
   ],
   motto:['AI suggests.','You check.','You decide.'],
   guarantee:'Nothing is sent automatically: no message leaves without your approval.'},
  product:{title:'Your day starts with what matters.',
   body:'“Today” gathers the companies to contact, to check or to keep watching, in the order that matters.',
   darkTitle:'The same product, in dark theme.',darkBody:'Light or dark, as you prefer. Reading and colours keep the same meaning.',
   mockAria:'Preview of the Today screen in light theme, with three fictitious companies: one to contact, one to check, one being watched.',
   mockDarkAria:'Preview of the Today screen in dark theme, with the same fictitious companies.',
   today:'Today',project:'Example project · Openings in Occitanie',filters:'Filters',
   counts:{contact:'to contact',verify:'to verify',watch:'watching'},none:'Nothing to do for now.'},
  signup:{title:'Try ProspectOS on your own target.',body:'Create your account, describe your target: your first recommendations come with their sources.',
   points:['Explained recommendations','Visible sources','Human decision']},
  seoAria:'Discover ProspectOS',
 },
};

// The demo companies: invented names, no logo, no photo. "Maison Alba" is the hero card; the others only appear in the
// Today preview.
export function demoCompanies(locale:Locale):DemoCompany[]{
 const fr=locale==='fr';
 return [
  {id:'norde',name:'Atelier Norde',signal:fr?'Nouvelle implantation':'New location',meta:fr?'Montpellier · il y a 2 jours':'Montpellier · 2 days ago',status:'contact',
   explanation:fr?'Correspond à votre cible, et le moment est favorable.':'Matches your target, and the timing is right.',
   action:{label:fr?'Préparer le message':'Prepare the message',tone:'contact'}},
  {id:'alba',name:'Maison Alba',signal:fr?'Nouvelle implantation':'New location',meta:fr?'Toulouse · il y a 4 jours':'Toulouse · 4 days ago',status:'verify',
   explanation:fr?'Correspond à votre cible sur les critères déjà vérifiés.':'Matches your target on the criteria already verified.',
   note:fr?'2 informations à documenter.':'2 pieces of information to document.',
   action:{label:fr?'Compléter les informations':'Complete the information',tone:'primary'}},
  {id:'lumen',name:'Café Lumen',signal:fr?'Lancement de produit':'Product launch',meta:fr?'Nîmes · il y a 41 jours':'Nîmes · 41 days ago',status:'watch',
   explanation:fr?'Bonne cible, mais le signal n’est plus récent.':'Good target, but the signal is no longer recent.',action:null},
 ];
}
export const HERO_DEMO_ID='alba';
