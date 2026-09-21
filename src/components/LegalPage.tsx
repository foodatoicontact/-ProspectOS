import Link from 'next/link';
import {LEGAL_PAGES} from '../domain/legal';

// Shared chrome for every public legal page: reuses the same nav/brand pattern as PublicSeoPage (no
// authentication, no client-side data fetch, no cookie/tracker of any kind — a static server-rendered
// page). A small cross-nav between the 4 legal pages plus "last updated" versioning makes each page's
// own date/version visible and auditable, never hidden in a footer alone.
export function LegalPage({title,updated,currentPath,children}:{title:string;updated:string;currentPath:string;children:React.ReactNode}){
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
