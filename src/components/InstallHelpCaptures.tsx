// « Installer ProspectOS sur votre téléphone » (docs/PWA.md): the captures of the help page, right after its introduction.
// They are captures of ProspectOS's own screens (the invitation on iPhone and on Android, the notification settings), taken
// at 390 px from the real components (src/ui/v2/pwa/PwaLayer.tsx); Safari's and Chrome's own menus are described in words,
// with Safari's Share icon drawn, rather than shown as an Apple or Google screenshot.
const CAPTURES=[
 {src:'/aide/installer-iphone.png',w:390,h:228,alt:'Sur iPhone, ProspectOS affiche en bas de l’écran : « Installez ProspectOS sur votre téléphone », puis trois étapes — touchez Partager, choisissez « Sur l’écran d’accueil », touchez « Ajouter ».',caption:'Sur iPhone : l’invitation rappelle les trois gestes à faire dans Safari.'},
 {src:'/aide/installer-android.png',w:390,h:151,alt:'Sur Android, ProspectOS affiche en bas de l’écran : « Installez ProspectOS sur votre téléphone » avec un bouton « Installer ».',caption:'Sur Android : un bouton « Installer » ouvre la fenêtre d’installation de Chrome.'},
 {src:'/aide/notifications.png',w:390,h:424,alt:'Le panneau Notifications de ProspectOS : activées sur cet appareil, avec trois cases — nouvelle livraison de veille, nouveaux signaux sur un prospect surveillé, fin de l’essai.',caption:'Menu du compte → Notifications : activez-les ou coupez-les, appareil par appareil et type par type.'},
];
const CSS=`.pos-help-captures{display:grid;gap:var(--pos-space-5,20px);grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));margin:0 0 var(--pos-space-6,24px)}
.pos-help-captures figure{margin:0;display:grid;gap:8px;justify-items:center}
.pos-help-captures img{width:100%;max-width:300px;height:auto;border-radius:16px;border:1px solid var(--pos-border);box-shadow:var(--pos-shadow-card)}
.pos-help-captures figcaption{font-size:var(--pos-text-sm,14px);color:var(--pos-text-2);text-align:center;max-width:300px}`;
export function InstallHelpCaptures(){
 return <div className="pos-help-captures"><style href="pos-help-captures" precedence="default">{CSS}</style>
  {CAPTURES.map(c=><figure key={c.src}><img src={c.src} alt={c.alt} width={c.w} height={c.h} loading="lazy"/><figcaption>{c.caption}</figcaption></figure>)}
 </div>;
}
