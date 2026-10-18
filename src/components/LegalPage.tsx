import Link from 'next/link';
import {Children,cloneElement,isValidElement,type ReactElement,type ReactNode} from 'react';
import {LEGAL_PAGES} from '../domain/legal';
import {WEB_V2} from '../ui/v2/public/flag.ts';
import {PublicSiteShell,PublicHero} from '../ui/v2/public/PublicSite.tsx';

// Shared chrome for every public legal page: reuses the same nav/brand pattern as PublicSeoPage (no
// authentication, no client-side data fetch, no cookie/tracker of any kind — a static server-rendered
// page). A small cross-nav between the 4 legal pages plus "last updated" versioning makes each page's
// own date/version visible and auditable, never hidden in a footer alone.
export function LegalPage({title,updated,currentPath,children}:{title:string;updated:string;currentPath:string;children:React.ReactNode}){
 if(WEB_V2)return <LegalPageV2 title={title} updated={updated} currentPath={currentPath}>{children}</LegalPageV2>;
 return <main className="seo-public legal-page">
  <header className="seo-public-nav">
   <Link href="/" className="seo-brand"><b className="logo">P</b> ProspectOS</Link>
   <Link href="/" className="text-button">Retour à l’accueil</Link>
  </header>
  <p className="eyebrow">PROSPECTOS — INFORMATION LÉGALE</p>
  <h1>{title}</h1>
  <p className="muted legal-updated">Dernière mise à jour : {updated}</p>
  <nav className="legal-nav" aria-label="Pages légales">
   {LEGAL_PAGES.map(p=><Link key={p.href} href={p.href} className={p.href===currentPath?'active':''}>{p.label}</Link>)}
  </nav>
  {children}
 </main>;
}

// WEB-2 (docs/UI_V2.md): the same legal text in the ProspectOS 2.0 public envelope, only when the site is built with
// NEXT_PUBLIC_WEB_V2_ENABLED. Not a word of the text changes: the sections are the page's own nodes; each top-level <section>
// only gets an id so the table of contents (derived from its <h2> as written) can link to it.
type Part={id:string;title:string};
const textOf=(n:ReactNode):string=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(textOf).join(''):'';
function withAnchors(children:ReactNode):{nodes:ReactNode[];toc:Part[]}{
 const toc:Part[]=[];let i=0;
 const nodes=Children.toArray(children).map(child=>{
  if(!isValidElement(child)||child.type!=='section')return child;
  const el=child as ReactElement<{children?:ReactNode;id?:string}>;
  const h2=Children.toArray(el.props.children).find(c=>isValidElement(c)&&c.type==='h2') as ReactElement<{children?:ReactNode}>|undefined;
  const title=h2?textOf(h2.props.children).trim():'';
  if(!title)return child;
  const id=`section-${++i}`;toc.push({id,title});
  return cloneElement(el,{id});
 });
 return {nodes,toc};
}
function LegalPageV2({title,updated,currentPath,children}:{title:string;updated:string;currentPath:string;children:ReactNode}){
 const {nodes,toc}=withAnchors(children);
 return <PublicSiteShell>
  <main className="pos-public__main">
   <PublicHero eyebrow="PROSPECTOS — INFORMATION LÉGALE" title={title} meta={<>Dernière mise à jour : {updated}</>}>
    <nav className="pos-public__legal-nav" aria-label="Pages légales">
     {LEGAL_PAGES.map(p=><Link key={p.href} href={p.href} className={p.href===currentPath?'active':''} aria-current={p.href===currentPath?'page':undefined}>{p.label}</Link>)}
    </nav>
   </PublicHero>
   <div className="pos-public__section pos-public__section--reading"><div className="pos-public__wrap">
    {toc.length>2&&<details className="pos-public__toc"><summary>Sommaire</summary><ol>{toc.map(t=><li key={t.id}><a href={`#${t.id}`}>{t.title}</a></li>)}</ol></details>}
    <div className="pos-public__legal pos-public__prose">{nodes}</div>
   </div></div>
  </main>
 </PublicSiteShell>;
}
