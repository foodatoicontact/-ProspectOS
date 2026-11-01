import type {Metadata} from 'next';
import {PublicSeoPage} from '../../src/components/PublicSeoPage';
import {ProspectRequestForm} from '../../src/components/ProspectRequestForm';
import {creationsMetadata} from '../../src/components/CompanyCreations';
import type {SeoPage} from '../../src/domain/seo';

// "3 prospects de votre zone": the offer made visible (concierge test, 1 nov. 2026). The founder prepares each answer by hand
// from public sources; the form only emails the request (app/api/public/demande-prospects). Static page, no data fetched.
const page:SeoPage={
 slug:'prospects-de-votre-zone',navLabel:'3 prospects de votre zone',updated:'2026-11-01',
 keywords:{primary:'trouver des prospects dans sa zone',secondary:['prospects entreprises récemment créées','liste de prospects B2B locale']},
 title:'3 prospects de votre zone, avec leur source | ProspectOS',
 description:'Recevez 3 entreprises de votre département qui ont une raison concrète d’être contactées maintenant, chacune avec sa source officielle. Sous 24 h ouvrées.',
 eyebrow:'Sans compte · Sous 24 h ouvrées',
 h1:'Recevez 3 entreprises de votre zone à contacter maintenant',
 intro:'Dites-moi ce que vous vendez et où. Je vous envoie 3 entreprises de votre département qui ont une raison concrète d’être contactées en ce moment (création récente, nouvel établissement…), chacune avec le lien vers sa source officielle.',
 sections:[
  {h2:'Ce que vous recevez',blocks:[
   {type:'ul',items:[
    'Trois entreprises de votre département, choisies pour correspondre à vos clients idéaux.',
    'Pour chacune : son nom, son numéro SIREN, le fait qui rend le contact pertinent maintenant et sa date.',
    'Le lien vers la source officielle de ce fait (annonce au BODACC, registre des entreprises, site de l’entreprise), pour que vous puissiez tout vérifier.',
    'Ce qui reste à vérifier avant de les contacter, signalé clairement : rien n’est inventé.',
   ]},
  ]},
  {h2:'Comment je les trouve',blocks:[
   {type:'p',text:'Uniquement à partir de sources publiques officielles : les annonces de création publiées au BODACC, le registre des entreprises et le site de chaque entreprise. Pas de fichier acheté, pas de données aspirées sur les réseaux sociaux. C’est la méthode de ProspectOS, appliquée à la main pour votre cas : voir [les créations d’entreprises de votre département](/creations-entreprises).'},
   {type:'callout',title:'Aucun envoi à votre place',text:'Je vous transmets les entreprises et leurs sources. C’est vous qui décidez qui contacter, et comment.'},
  ]},
 ],
 faq:[
  {q:'Combien ça coûte ?',a:'Rien, et sans engagement. C’est la meilleure façon de juger la qualité de la méthode sur votre propre marché.'},
  {q:'Pourquoi seulement 3 entreprises ?',a:'Parce que je les vérifie une par une. Je préfère vous en donner 3 sourcées que 50 approximatives.'},
  {q:'Que devient mon email ?',a:'Il sert uniquement à vous envoyer vos 3 prospects et à vous recontacter à ce sujet. Pas de newsletter, pas de revente. La demande n’est pas enregistrée en base : elle m’est transmise par email.'},
  {q:'Et ensuite ?',a:'Si la méthode vous convient, ProspectOS fait la même recherche en continu sur votre cible : voir [les tarifs](/tarifs).'},
 ],
 cta:{title:'Vous préférez chercher vous-même ?',text:'Créez votre compte ProspectOS et décrivez votre cible : vos premières recommandations arrivent avec leurs sources.',href:'/',label:'Découvrir ProspectOS'},
 related:['prospection-b2b','qualifier-un-prospect-b2b','prioriser-liste-prospects'],
};

export const metadata:Metadata=creationsMetadata(page);
export default function Page(){return <PublicSeoPage page={page}><ProspectRequestForm/></PublicSeoPage>}
