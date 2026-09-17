import Link from 'next/link';
import type {SeoPage} from '../domain/seo';

export function PublicSeoPage({page}:{page:SeoPage}){
  return <main className="seo-public">
    <header className="seo-public-nav">
      <Link href="/" className="seo-brand"><b className="logo">P</b> ProspectOS</Link>
      <Link href="/" className="text-button">Voir la démo</Link>
    </header>
    <section className="seo-hero">
      <p className="eyebrow">{page.eyebrow}</p>
      <h1>{page.h1}</h1>
      <p>{page.intro}</p>
      <div className="actions"><Link href="/" className="primary large">Explorer ProspectOS <span>↗</span></Link></div>
    </section>
    <section className="seo-section-grid">
      {page.sections.map(section=><article className="card" key={section.title}>
        <h2>{section.title}</h2>
        <p>{section.body}</p>
      </article>)}
    </section>
    <nav className="seo-related" aria-label="Ressources ProspectOS">
      <span>À découvrir</span>
      <Link href="/prospection-b2b">Prospection B2B</Link>
      <Link href="/prospection-ia">Prospection IA</Link>
      <Link href="/lead-scoring">Lead scoring</Link>
      <Link href="/prospection-restaurants">Restaurants</Link>
    </nav>
  </main>;
}
