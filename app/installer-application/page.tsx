import type {Metadata} from 'next';
import {PublicSeoPage} from '../../src/components/PublicSeoPage';
import {InstallHelpCaptures} from '../../src/components/InstallHelpCaptures';
import {creationsMetadata} from '../../src/components/CompanyCreations';
import type {SeoPage} from '../../src/domain/seo';

// « Installer ProspectOS sur votre téléphone » (PWA, owner decision 26 nov. 2026; docs/PWA.md). Linked from the install
// invitation's e-mail line. Static page.
const page:SeoPage={
 slug:'installer-application',navLabel:'Installer ProspectOS sur votre téléphone',updated:'2026-11-26',
 keywords:{primary:'installer ProspectOS sur téléphone',secondary:['application ProspectOS iPhone','application ProspectOS Android']},
 title:'Installer ProspectOS sur votre téléphone (iPhone et Android) | ProspectOS',
 description:'Ajoutez ProspectOS à l’écran d’accueil de votre iPhone ou de votre téléphone Android en quelques secondes, sans passer par un store, puis activez les notifications si vous le souhaitez.',
 eyebrow:'Aide · iPhone et Android',
 h1:'Installer ProspectOS sur votre téléphone',
 intro:'ProspectOS s’installe directement depuis le navigateur, sans store et sans téléchargement : une icône sur l’écran d’accueil, l’app en plein écran, et des notifications si vous le voulez.',
 sections:[
  {h2:'Sur iPhone (Safari)',blocks:[
   {type:'ol',items:[
    'Ouvrez prospectos.fr dans Safari et connectez-vous. L’installation sur l’écran d’accueil ne se fait que depuis Safari.',
    'Touchez le bouton Partager : le carré avec une flèche vers le haut, en bas de l’écran (en haut sur iPad).',
    'Faites défiler et choisissez « Sur l’écran d’accueil ».',
    'Touchez « Ajouter ». L’icône ProspectOS apparaît sur votre écran d’accueil : ouvrez l’app depuis cette icône.',
   ]},
   {type:'callout',title:'Notifications sur iPhone',text:'Elles demandent iOS 16.4 ou plus récent, et ne peuvent être activées qu’une fois ProspectOS ouvert depuis son icône sur l’écran d’accueil.'},
  ]},
  {h2:'Sur Android (Chrome)',blocks:[
   {type:'ol',items:[
    'Ouvrez prospectos.fr dans Chrome et connectez-vous.',
    'Touchez « Installer » dans l’invitation de ProspectOS, ou ouvrez le menu ⋮ de Chrome et choisissez « Installer l’application ».',
    'Confirmez. ProspectOS apparaît avec vos autres applications.',
   ]},
  ]},
  {h2:'Activer ou couper les notifications',blocks:[
   {type:'p',text:'À la première ouverture de l’app installée, ProspectOS vous propose une seule fois d’activer les notifications. Vous pouvez les activer, les couper ou choisir lesquelles recevoir à tout moment : menu du compte, puis « Notifications ».'},
   {type:'ul',items:['Nouvelle livraison de veille.','Nouveaux signaux sur un prospect que vous surveillez (une notification par jour au plus).','Fin de votre essai.']},
   {type:'p',text:'Une notification ne contient jamais le nom d’une entreprise ni le contenu d’un signal : seulement ce qui est arrivé, et un lien vers l’app.'},
  ]},
 ],
 faq:[
  {q:'Faut-il passer par l’App Store ou le Play Store ?',a:'Non. ProspectOS s’installe depuis le navigateur ; l’app se met à jour toute seule.'},
  {q:'Mes données sont-elles gardées sur le téléphone ?',a:'Non. Seules les pages publiques et la coquille de l’app sont gardées pour s’ouvrir plus vite ; vos prospects et vos livraisons sont toujours chargés depuis votre compte.'},
  {q:'Comment désinstaller ?',a:'Comme toute application : appui long sur l’icône, puis « Supprimer l’app » (iPhone) ou « Désinstaller » (Android).'},
 ],
 cta:{title:'Pas encore de compte ?',text:'Créez votre compte ProspectOS : 7 jours d’essai, sans moyen de paiement.',href:'/',label:'Découvrir ProspectOS'},
 related:['prospection-b2b','veille-entreprises','prioriser-liste-prospects'],
};

export const metadata:Metadata=creationsMetadata(page);
export default function Page(){return <PublicSeoPage page={page}><InstallHelpCaptures/></PublicSeoPage>}
