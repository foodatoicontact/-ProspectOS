// ProspectOS installable (PWA, migration 057, docs/PWA.md) — every text of the install invitation, the notification
// settings and the notifications themselves, FR and EN (owner decision, 26 nov. 2026: written by Claude, reviewed in the PR).
// One file so the wording is read and changed in one place. The service worker (public/sw.js) carries a copy of NOTIFY,
// checked equal by tests/pwa.test.ts.
import type {Locale} from '../i18n/locale.ts';

export const INSTALL_COPY:Record<Locale,{
 title:string;body:string;install:string;later:string;never:string;iosSteps:[string,string,string];iosShareLabel:string;close:string;
}>={
 fr:{
  title:'Installez ProspectOS sur votre téléphone',
  body:'Ouvrez l’app d’un geste depuis l’écran d’accueil, en plein écran, et recevez vos nouvelles livraisons et vos signaux.',
  install:'Installer',later:'Plus tard',never:'Ne plus afficher',
  iosSteps:['Touchez Partager','Choisissez « Sur l’écran d’accueil »','Touchez « Ajouter »'],
  iosShareLabel:'Icône Partager de Safari',close:'Fermer',
 },
 en:{
  title:'Install ProspectOS on your phone',
  body:'Open the app in one tap from your home screen, full screen, and get your new deliveries and signals.',
  install:'Install',later:'Later',never:'Don’t show again',
  iosSteps:['Tap Share','Choose “Add to Home Screen”','Tap “Add”'],
  iosShareLabel:'Safari Share icon',close:'Close',
 },
};

export const PUSH_COPY:Record<Locale,{
 offerTitle:string;offerBody:string;enable:string;notNow:string;
 settingsTitle:string;settingsIntro:string;thisDevice:string;on:string;off:string;turnOn:string;turnOff:string;
 kinds:{delivery:string;signals:string;trial:string};unsupported:string;iosHint:string;denied:string;saved:string;error:string;
}>={
 fr:{
  offerTitle:'Activer les notifications ?',
  offerBody:'Soyez prévenu d’une nouvelle livraison de veille, de nouveaux signaux sur vos prospects surveillés et de la fin de votre essai. Vous pouvez les couper à tout moment dans les paramètres.',
  enable:'Activer',notNow:'Pas maintenant',
  settingsTitle:'Notifications',settingsIntro:'Les notifications ne contiennent jamais le nom d’une entreprise ni le contenu d’un signal : seulement ce qui est arrivé, et un lien vers l’app.',
  thisDevice:'Sur cet appareil',on:'Activées',off:'Désactivées',turnOn:'Activer sur cet appareil',turnOff:'Désactiver sur cet appareil',
  kinds:{delivery:'Nouvelle livraison de veille',signals:'Nouveaux signaux sur un prospect surveillé',trial:'Fin de l’essai'},
  unsupported:'Ce navigateur ne permet pas les notifications.',
  iosHint:'Sur iPhone (iOS 16.4 ou plus récent), ajoutez d’abord ProspectOS à l’écran d’accueil, puis ouvrez-le depuis son icône pour activer les notifications.',
  denied:'Les notifications sont bloquées pour ProspectOS dans les réglages de ce navigateur. Autorisez-les là, puis revenez ici.',
  saved:'Préférences enregistrées.',error:'Action impossible pour le moment.',
 },
 en:{
  offerTitle:'Turn on notifications?',
  offerBody:'Be told about a new watch delivery, new signals on the prospects you monitor and the end of your trial. You can turn them off at any time in the settings.',
  enable:'Turn on',notNow:'Not now',
  settingsTitle:'Notifications',settingsIntro:'Notifications never include a company name or the content of a signal: only what happened, and a link to the app.',
  thisDevice:'On this device',on:'On',off:'Off',turnOn:'Turn on for this device',turnOff:'Turn off for this device',
  kinds:{delivery:'New watch delivery',signals:'New signals on a monitored prospect',trial:'End of trial'},
  unsupported:'This browser does not support notifications.',
  iosHint:'On iPhone (iOS 16.4 or later), first add ProspectOS to your home screen, then open it from its icon to turn notifications on.',
  denied:'Notifications are blocked for ProspectOS in this browser’s settings. Allow them there, then come back.',
  saved:'Preferences saved.',error:'Something went wrong. Please try again.',
 },
};

// The notifications themselves (shown by the service worker in the device's language).
export const NOTIFY:Record<Locale,Record<'DELIVERY'|'SIGNALS'|'TRIAL_ENDED',{title:string;body:string}>>={
 fr:{
  DELIVERY:{title:'Nouvelle livraison de veille',body:'Votre nouvelle liste d’entreprises est prête dans ProspectOS.'},
  SIGNALS:{title:'Nouveaux signaux',body:'De nouveaux signaux sont à vérifier sur vos prospects surveillés.'},
  TRIAL_ENDED:{title:'Votre essai est terminé',body:'Choisissez une offre pour continuer à utiliser ProspectOS.'},
 },
 en:{
  DELIVERY:{title:'New watch delivery',body:'Your new list of companies is ready in ProspectOS.'},
  SIGNALS:{title:'New signals',body:'New signals are waiting for review on the prospects you monitor.'},
  TRIAL_ENDED:{title:'Your trial has ended',body:'Choose a plan to keep using ProspectOS.'},
 },
};

// The one line added to the existing e-mails (owner decision: the veille space opening e-mail; the Supabase « Confirm
// signup » template takes the same line by hand, docs/PWA.md). No other e-mail.
export const EMAIL_INSTALL_LINE='Sur téléphone, installez ProspectOS sur votre écran d’accueil : https://prospectos.fr/installer-application';
