// UI-2 navigation model (docs/UI_V2.md). The v2 shell only re-labels and re-groups the screens that already exist:
// each entry maps to an existing view of app/page.tsx, nothing new is created. Where no screen matches exactly, the
// closest existing one is reused (ZF-UI0 CURRENT_COMPONENT_REUSE_MAP).
import type {Locale} from '../../../i18n/locale.ts';
import type {IconName} from '../icons.ts';

export type NavKey='today'|'prospects'|'search'|'activity'|'sources'|'settings';
// The views app/page.tsx already renders (its `view` state).
export type AppView='today'|'prospects'|'discovery'|'actions'|'dashboard'|'icp'|'beta-analytics'|'outreach';
// What this account can see today: "Aujourd'hui" (ZF1) and "À faire" (NBA) exist only for a live account with their flag.
export type NavCaps={live:boolean;today:boolean;actions:boolean};

export const PRIMARY_NAV:readonly NavKey[]=['today','prospects','search','activity'];
export const SECONDARY_NAV:readonly NavKey[]=['sources','settings'];
export const NAV_ORDER:readonly NavKey[]=[...PRIMARY_NAV,...SECONDARY_NAV];

export const NAV_ICON:Record<NavKey,IconName>={today:'today',prospects:'prospects',search:'search',activity:'activity',sources:'sources',settings:'settings'};
export const NAV_LABEL:Record<Locale,Record<NavKey,string>>={
 fr:{today:'Aujourd’hui',prospects:'Prospects',search:'Recherche',activity:'Activité',sources:'Sources',settings:'Paramètres'},
 en:{today:'Today',prospects:'Prospects',search:'Search',activity:'Activity',sources:'Sources',settings:'Settings'},
};

// Entry → existing screen.
// - today: ZF1 "Aujourd'hui" when it exists; else "À faire" (NBA); else the prospects list ("your next conversations").
// - search, sources: Discovery (its source choice — registry, web — is the only "sources" screen that exists today).
// - activity: "À faire" when "Aujourd'hui" already exists (advanced mode), else the overview it absorbs.
// - settings: offer & ICP (account, team and billing stay in the account menu).
export function viewForNav(key:NavKey,caps:NavCaps):AppView{
 switch(key){
  case 'today':return caps.live&&caps.today?'today':caps.live&&caps.actions?'actions':'prospects';
  case 'prospects':return 'prospects';
  case 'search':case 'sources':return 'discovery';
  case 'activity':return caps.live&&caps.today&&caps.actions?'actions':'dashboard';
  case 'settings':return 'icp';
 }
}
// Which entry is current for a view. Two entries can lead to the same screen (e.g. Recherche / Sources): the one the
// user chose stays current; otherwise the first in navigation order. A screen no entry leads to (Bêta Analytics and
// Self-Outreach, reached from the account menu for the accounts allowed to see them) has no current entry.
export function navForView(view:AppView,caps:NavCaps,chosen:NavKey|null):NavKey|null{
 if(chosen&&viewForNav(chosen,caps)===view)return chosen;
 return NAV_ORDER.find(k=>viewForNav(k,caps)===view)??null;
}
// The screen a v2 session opens on: "Aujourd'hui" (or its closest screen), right under the top bar.
export function landingView(caps:NavCaps):AppView{return viewForNav('today',caps)}

// Accessible name of the current screen (visually hidden h1: the v2 shell drops the marketing page titles).
export function viewTitle(view:AppView,locale:Locale):string{
 const fr=locale==='fr';
 switch(view){
  case 'today':return NAV_LABEL[locale].today;
  case 'prospects':return NAV_LABEL[locale].prospects;
  case 'discovery':return NAV_LABEL[locale].search;
  case 'actions':return fr?'À faire':'To do';
  case 'dashboard':return NAV_LABEL[locale].activity;
  case 'icp':return fr?'Offre & cible':'Offer & target';
  case 'beta-analytics':return 'Bêta Analytics';
  case 'outreach':return fr?'Outreach ProspectOS':'ProspectOS outreach';
 }
}
