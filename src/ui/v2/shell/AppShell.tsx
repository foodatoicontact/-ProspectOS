'use client';
// ProspectOS 2.0 app shell (UI-2, docs/UI_V2.md) — rendered by app/page.tsx only when UI_V2_ENABLED is on.
// ≤ 640 px and 641–1023 px: fixed TopBar (ProspectOS · [Projet ▼] · [Avatar]) + fixed BottomNav (4 entries, safe area).
// ≥ 1024 px: compact SideNav (project on top, 4 primary + 2 secondary entries, account at the bottom) + workspace.
// The existing screens are rendered unchanged inside `.pos-legacy` (their own styles, in every theme) until UI-3/UI-5
// migrates them. Theme, tokens and primitives come from UI-1; nothing is duplicated here.
import {useRef,useState,type ReactNode,type RefObject} from 'react';
import '../foundations.css';
import './shell.css';
import {ThemeProvider} from '../ThemeProvider.tsx';
import {Button,Icon} from '../primitives.tsx';
import {Sheet,useIsDesktop} from '../panels.tsx';
import {tokensCss} from '../tokens.ts';
import {Popover} from './Popover.tsx';
import {ProjectList,PROJECT_TEXT,type ProjectSwitcherProps} from './ProjectSwitcher.tsx';
import {UserMenuContent,MENU_TEXT,type UserMenuProps} from './UserMenu.tsx';
import {NAV_ICON,NAV_LABEL,PRIMARY_NAV,SECONDARY_NAV,type NavKey} from './nav.ts';
import type {IconName} from '../icons.ts';
import type {Locale} from '../../../i18n/locale.ts';

export type AppShellProps={
 locale:Locale;current:NavKey|null;onNavigate:(key:NavKey)=>void;
 project:ProjectSwitcherProps;account:Omit<UserMenuProps,'locale'>;
 title:string;actions?:ShellAction[];debug?:ReactNode;children:ReactNode;
};
// Actions that belong to the current screen (e.g. Prospects: export, add) — no longer global buttons of the envelope.
export type ShellAction={key:string;label:string;onClick:()=>void;primary?:boolean;disabled?:boolean;icon?:IconName};

const SHELL_TEXT:Record<Locale,{skip:string;primary:string;secondary:string;home:string}>={
 fr:{skip:'Aller au contenu',primary:'Navigation principale',secondary:'Configuration',home:'ProspectOS'},
 en:{skip:'Skip to content',primary:'Main navigation',secondary:'Configuration',home:'ProspectOS'},
};

function Mark(){
 return <span className="pos-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 19V5h5a4 4 0 0 1 0 8H8"/><circle cx="17.5" cy="17.5" r="1.6"/></svg></span>;
}
const initials=(s:string)=>s.split(/[\s@._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]!.toUpperCase()).join('')||'?';

function NavButton({k,current,locale,onNavigate,variant}:{k:NavKey;current:NavKey|null;locale:Locale;onNavigate:(k:NavKey)=>void;variant:'side'|'bottom'}){
 const on=current===k;
 return <button type="button" className={`pos-nav__item pos-nav__item--${variant}`} aria-current={on?'page':undefined} onClick={()=>onNavigate(k)}>
  <Icon name={NAV_ICON[k]} size={variant==='bottom'?22:19}/><span className="pos-nav__label">{NAV_LABEL[locale][k]}</span>
 </button>;
}

function ProjectTrigger({p,locale,open,onOpen,triggerRef,variant}:{p:ProjectSwitcherProps;locale:Locale;open:boolean;onOpen:()=>void;
 triggerRef:RefObject<HTMLButtonElement|null>;variant:'top'|'side'}){
 const name=p.projects.find(x=>x.id===p.currentId)?.name??PROJECT_TEXT[locale].none;
 return <button ref={triggerRef} type="button" className={`pos-project pos-project--${variant}`} aria-haspopup="dialog" aria-expanded={open}
  aria-label={PROJECT_TEXT[locale].trigger(name)} onClick={onOpen}>
  {variant==='side'&&<Icon name="project" size={18}/>}<span className="pos-project__name">{name}</span><Icon name="chevron-up-down" size={16}/>
 </button>;
}

export function TopBar({locale,project,account,projectOpen,menuOpen,onProject,onMenu,projectRef,menuRef}:{locale:Locale;project:ProjectSwitcherProps;
 account:Omit<UserMenuProps,'locale'>;projectOpen:boolean;menuOpen:boolean;onProject:()=>void;onMenu:()=>void;
 projectRef:RefObject<HTMLButtonElement|null>;menuRef:RefObject<HTMLButtonElement|null>}){
 return <header className="pos-topbar pos-glass">
  <span className="pos-brand"><Mark/><span className="pos-brand__name">ProspectOS</span></span>
  <ProjectTrigger p={project} locale={locale} open={projectOpen} onOpen={onProject} triggerRef={projectRef} variant="top"/>
  <button ref={menuRef} type="button" className="pos-avatar" aria-haspopup="dialog" aria-expanded={menuOpen} aria-label={MENU_TEXT[locale].trigger} onClick={onMenu}>
   {account.mode==='live'?initials(account.email):<Icon name="declared" size={18}/>}
  </button>
 </header>;
}

export function BottomNav({locale,current,onNavigate}:{locale:Locale;current:NavKey|null;onNavigate:(k:NavKey)=>void}){
 return <nav className="pos-bottomnav pos-glass" aria-label={SHELL_TEXT[locale].primary}>
  {PRIMARY_NAV.map(k=><NavButton key={k} k={k} current={current} locale={locale} onNavigate={onNavigate} variant="bottom"/>)}
 </nav>;
}

export function SideNav({locale,current,onNavigate,project,account,projectOpen,menuOpen,onProject,onMenu,projectRef,menuRef,onCloseProject,onCloseMenu}:{
 locale:Locale;current:NavKey|null;onNavigate:(k:NavKey)=>void;project:ProjectSwitcherProps;account:Omit<UserMenuProps,'locale'>;
 projectOpen:boolean;menuOpen:boolean;onProject:()=>void;onMenu:()=>void;onCloseProject:()=>void;onCloseMenu:()=>void;
 projectRef:RefObject<HTMLButtonElement|null>;menuRef:RefObject<HTMLButtonElement|null>}){
 const t=SHELL_TEXT[locale];
 return <aside className="pos-sidenav pos-glass">
  <span className="pos-brand"><Mark/><span className="pos-brand__name">ProspectOS</span></span>
  <div className="pos-sidenav__anchor">
   <ProjectTrigger p={project} locale={locale} open={projectOpen} onOpen={onProject} triggerRef={projectRef} variant="side"/>
   <Popover open={projectOpen} onClose={onCloseProject} label={PROJECT_TEXT[locale].title} anchor={projectRef} className="pos-popover--below">
    <ProjectList {...project} locale={locale} onDone={onCloseProject}/>
   </Popover>
  </div>
  <nav className="pos-sidenav__nav" aria-label={t.primary}>
   {PRIMARY_NAV.map(k=><NavButton key={k} k={k} current={current} locale={locale} onNavigate={onNavigate} variant="side"/>)}
  </nav>
  <div className="pos-sidenav__sep" role="presentation"/>
  <nav className="pos-sidenav__nav" aria-label={t.secondary}>
   {SECONDARY_NAV.map(k=><NavButton key={k} k={k} current={current} locale={locale} onNavigate={onNavigate} variant="side"/>)}
  </nav>
  <div className="pos-sidenav__anchor pos-sidenav__account">
   <Popover open={menuOpen} onClose={onCloseMenu} label={MENU_TEXT[locale].title} anchor={menuRef} className="pos-popover--above">
    <UserMenuContent {...account} locale={locale} onDone={onCloseMenu}/>
   </Popover>
   <button ref={menuRef} type="button" className="pos-account" aria-haspopup="dialog" aria-expanded={menuOpen} aria-label={MENU_TEXT[locale].trigger} onClick={onMenu}>
    <span className="pos-avatar pos-avatar--static" aria-hidden="true">{account.mode==='live'?initials(account.email):<Icon name="declared" size={18}/>}</span>
    <span className="pos-account__name">{account.mode==='live'?account.email:MENU_TEXT[locale].demo}</span>
    <Icon name="chevron-up-down" size={16}/>
   </button>
  </div>
 </aside>;
}

export function AppShell({locale,current,onNavigate,project,account,title,actions,debug,children}:AppShellProps){
 const desktop=useIsDesktop();
 const [projectOpen,setProjectOpen]=useState(false);
 const [menuOpen,setMenuOpen]=useState(false);
 const topProject=useRef<HTMLButtonElement>(null),topMenu=useRef<HTMLButtonElement>(null);
 const sideProject=useRef<HTMLButtonElement>(null),sideMenu=useRef<HTMLButtonElement>(null);
 const navigate=(k:NavKey)=>{setProjectOpen(false);setMenuOpen(false);onNavigate(k)};
 const t=SHELL_TEXT[locale];
 return <ThemeProvider className="pos-app">
  <style href="pos-ui-tokens" precedence="default">{tokensCss()}</style>
  <a className="pos-skip" href="#pos-main">{t.skip}</a>
  <TopBar locale={locale} project={project} account={account} projectOpen={projectOpen&&!desktop} menuOpen={menuOpen&&!desktop}
   onProject={()=>{setMenuOpen(false);setProjectOpen(true)}} onMenu={()=>{setProjectOpen(false);setMenuOpen(true)}} projectRef={topProject} menuRef={topMenu}/>
  <SideNav locale={locale} current={current} onNavigate={navigate} project={project} account={account}
   projectOpen={projectOpen&&desktop} menuOpen={menuOpen&&desktop} onProject={()=>{setMenuOpen(false);setProjectOpen(o=>!o)}} onMenu={()=>{setProjectOpen(false);setMenuOpen(o=>!o)}}
   onCloseProject={()=>setProjectOpen(false)} onCloseMenu={()=>setMenuOpen(false)} projectRef={sideProject} menuRef={sideMenu}/>
  <main id="pos-main" className="pos-app__main" tabIndex={-1}>
   <h1 className="pos-visually-hidden">{title}</h1>
   {debug}
   {actions&&actions.length>0&&<div className="pos-app__toolbar">{actions.map(a=><Button key={a.key} variant={a.primary?'primary':'secondary'} size="sm"
    iconStart={a.icon} disabled={a.disabled} onClick={a.onClick}>{a.label.replace(/^＋\s*/,'')}</Button>)}</div>}
   <div className="pos-legacy">{children}</div>
  </main>
  <BottomNav locale={locale} current={current} onNavigate={navigate}/>
  <Sheet open={projectOpen&&!desktop} onClose={()=>setProjectOpen(false)} title={PROJECT_TEXT[locale].title} locale={locale}>
   <ProjectList {...project} locale={locale} onDone={()=>setProjectOpen(false)}/>
  </Sheet>
  <Sheet open={menuOpen&&!desktop} onClose={()=>setMenuOpen(false)} title={MENU_TEXT[locale].title} locale={locale}>
   <UserMenuContent {...account} locale={locale} onDone={()=>setMenuOpen(false)}/>
  </Sheet>
 </ThemeProvider>;
}
