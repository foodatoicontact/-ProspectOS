'use client';
// The account menu behind the avatar (ZF-UI0 MOBILE_INFORMATION_ARCHITECTURE). Every entry opens what already exists:
// the account dialog (account, team, data & privacy), the offer & target screen, the sources screen, the language and
// theme choices, sign-out. Bêta Analytics only for an INTERNAL plan. In the demo: language, theme, reset, exit.
import {Chip,ChipGroup,Icon} from '../primitives.tsx';
import {ThemeSwitcher} from '../ThemeSwitcher.tsx';
import type {IconName} from '../icons.ts';
import type {Locale} from '../../../i18n/locale.ts';

export type UserMenuProps={
 mode:'live'|'demo';email:string;internal:boolean;busy:boolean;locale:Locale;onLocale:(l:Locale)=>void;
 onAccount:()=>void;onTeam:()=>void;onOfferTarget:()=>void;onSources:()=>void;onPrivacy:()=>void;
 onBetaAnalytics:()=>void;onSignOut:()=>void;onResetDemo:()=>void;
};

export const MENU_TEXT:Record<Locale,{title:string;trigger:string;demo:string;account:string;team:string;offer:string;sources:string;
 language:string;theme:string;privacy:string;privacyPolicy:string;beta:string;signOut:string;exitDemo:string;resetDemo:string}>={
 fr:{title:'Compte',trigger:'Menu du compte : langue, thème, compte, déconnexion',demo:'Démo sur cet appareil',account:'Compte',
  team:'Organisation et équipe',offer:'Offre et cible',sources:'Sources',language:'Langue',theme:'Thème',privacy:'Données et confidentialité',
  privacyPolicy:'Politique de confidentialité',beta:'Bêta Analytics',signOut:'Se déconnecter',exitDemo:'Quitter la démo',resetDemo:'Réinitialiser la démo'},
 en:{title:'Account',trigger:'Account menu: language, theme, account, sign out',demo:'Demo on this device',account:'Account',
  team:'Organization and team',offer:'Offer and target',sources:'Sources',language:'Language',theme:'Theme',privacy:'Data and privacy',
  privacyPolicy:'Privacy policy',beta:'Beta Analytics',signOut:'Sign out',exitDemo:'Exit demo',resetDemo:'Reset demo'},
};

function Item({icon,label,onClick,disabled,danger}:{icon:IconName;label:string;onClick:()=>void;disabled?:boolean;danger?:boolean}){
 return <li><button type="button" className={`pos-menu__item${danger?' pos-menu__item--danger':''}`} disabled={disabled} onClick={onClick}>
  <Icon name={icon} size={18}/><span className="pos-menu__label">{label}</span>
 </button></li>;
}

export function UserMenuContent(p:UserMenuProps&{onDone:()=>void}){
 const t=MENU_TEXT[p.locale];
 // Close first, then act: the action may open a dialog or leave the workspace.
 const act=(fn:()=>void)=>()=>{p.onDone();fn()};
 const live=p.mode==='live';
 return <div className="pos-usermenu">
  <p className="pos-menu__who">{live?p.email:t.demo}</p>
  <ul className="pos-menu__list">
   {live&&<Item icon="declared" label={t.account} onClick={act(p.onAccount)}/>}
   {live&&<Item icon="prospects" label={t.team} onClick={act(p.onTeam)}/>}
   <Item icon="settings" label={t.offer} onClick={act(p.onOfferTarget)}/>
   <Item icon="sources" label={t.sources} onClick={act(p.onSources)}/>
   {live&&<Item icon="info" label={t.privacy} onClick={act(p.onPrivacy)}/>}
   {live&&p.internal&&<Item icon="activity" label={t.beta} onClick={act(p.onBetaAnalytics)}/>}
  </ul>
  <div className="pos-menu__group">
   <p className="pos-menu__heading">{t.language}</p>
   <ChipGroup label={t.language} variant="segmented">
    {(['fr','en'] as const).map(l=><Chip key={l} pressed={p.locale===l} onPressedChange={()=>p.onLocale(l)} lang={l}>{l==='fr'?'Français':'English'}</Chip>)}
   </ChipGroup>
  </div>
  <div className="pos-menu__group">
   <p className="pos-menu__heading">{t.theme}</p>
   <ThemeSwitcher locale={p.locale}/>
  </div>
  {live&&<p className="pos-menu__note"><a href="/confidentialite" target="_blank" rel="noreferrer">{t.privacyPolicy}</a></p>}
  <div className="pos-menu__sep" role="presentation"/>
  <ul className="pos-menu__list">
   {!live&&<Item icon="activity" label={t.resetDemo} disabled={p.busy} onClick={act(p.onResetDemo)}/>}
   <Item icon="external" label={live?t.signOut:t.exitDemo} disabled={p.busy} danger onClick={act(p.onSignOut)}/>
  </ul>
 </div>;
}
