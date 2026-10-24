// WEB-2 — the shared envelope of the ProspectOS 2.0 public site (docs/UI_V2.md): one header, one footer and a few layout
// pieces used by the homepage, /tarifs, the SEO pages and the legal pages. No hooks and no client directive: the server pages
// render it as static HTML with no client JavaScript; the homepage (a client page) renders the same markup.
// Styles: tokens (tokens.ts) and PUBLIC_CSS (styles.ts) are inlined as <style> elements only when this envelope renders, so a
// page that does not use it (flag off) ships exactly the CSS it had before.
import Link from 'next/link';
import type {ReactNode} from 'react';
import {tokensCss} from '../tokens.ts';
import {PUBLIC_CSS} from './styles.ts';
import {LEGAL_PAGES} from '../../../domain/legal.ts';
import {CONTACT_MAILTO} from '../../../domain/contact.ts';
import {seoPages} from '../../../domain/seo.ts';

const cx=(...c:(string|false|null|undefined)[])=>c.filter(Boolean).join(' ');

export function Mark(){
 return <span className="pos-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 19V5h5a4 4 0 0 1 0 8H8"/><circle cx="17.5" cy="17.5" r="1.6"/></svg></span>;
}

// FR | EN on the French-only server pages: plain links (no client code). English lives on the homepage, so EN leads there
// and asks it to switch (/?lang=en); FR is the current page.
export function StaticLocaleSwitch(){
 return <div className="locale-switch" role="group" aria-label="FR / EN">
  <a className="active" aria-current="true" href="#top" lang="fr">FR</a>
  <a href="/?lang=en" lang="en" hrefLang="en" aria-label="EN — English (home page)">EN</a>
 </div>;
}

export type HeaderLabels={nav:string;home:string;pricing:string;menu:string;login:string};
export const HEADER_FR:HeaderLabels={nav:'Navigation principale',home:'ProspectOS — accueil',pricing:'Tarifs',menu:'Menu',login:'Me connecter'};

// One header for every public page: ProspectOS · Tarifs · FR | EN · Me connecter. Phones: the brand and "Me connecter" stay in
// the bar, Tarifs and the language go into a native <details> menu (works without JavaScript).
export function PublicHeader({labels=HEADER_FR,locale,login}:{labels?:HeaderLabels;locale?:ReactNode;login?:ReactNode}){
 const loc=locale??<StaticLocaleSwitch/>;
 return <header className="pos-public__top" id="top">
  <div className="pos-public__wrap pos-public__bar">
   <Link className="pos-public__brand" href="/" aria-label={labels.home}><Mark/><span>ProspectOS</span></Link>
   <nav className="pos-public__nav" aria-label={labels.nav}>
    <Link className="pos-public__navlink" href="/tarifs">{labels.pricing}</Link>
    <div className="pos-public__locale">{loc}</div>
   </nav>
   <div className="pos-public__login">{login??<a className="pos-pbtn pos-pbtn--secondary pos-pbtn--sm" href="/#connexion">{labels.login}</a>}</div>
   <details className="pos-public__menu">
    <summary><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span className="pos-public__sr">{labels.menu}</span></summary>
    <div className="pos-public__menu-panel">
     <Link className="pos-public__navlink" href="/tarifs">{labels.pricing}</Link>
     <div className="pos-public__locale">{loc}</div>
    </div>
   </details>
  </div>
 </header>;
}

export type FooterLabels={discover:string;legal:string;contact:string};
export const FOOTER_FR:FooterLabels={discover:'Découvrir ProspectOS',legal:'Informations légales',contact:'Contact'};

// One footer: every public content page (internal links help readers and search engines), the legal pages, contact.
export function PublicFooter({labels=FOOTER_FR}:{labels?:FooterLabels}){
 return <footer className="pos-public__footer">
  <div className="pos-public__wrap pos-public__footer-grid">
   <div className="pos-public__footer-brand"><Link className="pos-public__brand" href="/"><Mark/><span>ProspectOS</span></Link></div>
   <nav aria-label={labels.discover}><p className="pos-public__footer-h">{labels.discover}</p>
    <ul>{seoPages.map(p=><li key={p.slug}><Link href={`/${p.slug}`}>{p.navLabel}</Link></li>)}</ul></nav>
   <nav aria-label={labels.legal}><p className="pos-public__footer-h">{labels.legal}</p>
    <ul>{LEGAL_PAGES.map(p=><li key={p.href}><Link href={p.href}>{p.label}</Link></li>)}<li><a href={CONTACT_MAILTO}>{labels.contact}</a></li></ul></nav>
  </div>
  <div className="pos-public__wrap pos-public__copy"><span>© 2026 ProspectOS</span></div>
 </footer>;
}

// The page root: light canvas with the static halos, tokens and public styles inlined (deduplicated by React via `href`).
export function PublicSiteShell({className,lang,header,footer,children}:{className?:string;lang?:string;header?:ReactNode;footer?:ReactNode;children:ReactNode}){
 return <div className={cx('pos-ui pos-canvas pos-public',className)} data-theme="light" lang={lang} data-testid="public-site-shell">
  <style href="pos-ui-tokens" precedence="default">{tokensCss()}</style>
  <style href="pos-public" precedence="default">{PUBLIC_CSS}</style>
  {header??<PublicHeader/>}
  {children}
  {footer??<PublicFooter/>}
 </div>;
}

export function PublicSection({className,width='wide',children,...rest}:{className?:string;width?:'wide'|'reading';children:ReactNode}&React.HTMLAttributes<HTMLElement>){
 return <section {...rest} className={cx('pos-public__section',width==='reading'&&'pos-public__section--reading',className)}><div className="pos-public__wrap">{children}</div></section>;
}

export function PublicHero({eyebrow,title,intro,meta,children}:{eyebrow:string;title:ReactNode;intro?:ReactNode;meta?:ReactNode;children?:ReactNode}){
 return <header className="pos-public__hero"><div className="pos-public__wrap">
  <p className="pos-public__eyebrow">{eyebrow}</p>
  <h1 className="pos-public__h1">{title}</h1>
  {intro&&<p className="pos-public__lead">{intro}</p>}
  {meta&&<p className="pos-public__meta">{meta}</p>}
  {children}
 </div></header>;
}

export function PublicCard({as:Tag='div',className,children}:{as?:'div'|'article'|'aside'|'li';className?:string;children:ReactNode}){
 return <Tag className={cx('pos-public__card',className)}>{children}</Tag>;
}

export function PublicCTA({title,text,href,label,className}:{title:string;text:string;href:string;label:string;className?:string}){
 return <section className={cx('pos-public__cta',className)}><div className="pos-public__wrap"><div className="pos-public__cta-panel">
  <h2>{title}</h2><p>{text}</p>
  <Link href={href} className="pos-pbtn pos-pbtn--primary pos-pbtn--lg">{label} <span aria-hidden="true">↗</span></Link>
 </div></div></section>;
}
