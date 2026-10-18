import Link from 'next/link';
import {Fragment,type ReactNode} from 'react';
import {relatedPages,faqJsonLd,breadcrumbJsonLd,type SeoBlock,type SeoPage} from '../domain/seo';
import {WEB_V2} from '../ui/v2/public/flag.ts';
import {PublicSiteShell,PublicHero,PublicCTA} from '../ui/v2/public/PublicSite.tsx';

// Server component (no client directive): the whole article is in the prerendered HTML, readable without JS.

// `[anchor](/path)` → internal <Link>; everything else stays plain text.
function renderRich(text:string):ReactNode{
  const parts=text.split(/(\[[^\]]+\]\(\/[^)]*\))/g);
  return parts.map((part,i)=>{
    const m=/^\[([^\]]+)\]\((\/[^)]*)\)$/.exec(part);
    return m?<Link key={i} href={m[2]}>{m[1]}</Link>:<Fragment key={i}>{part}</Fragment>;
  });
}

function Block({block}:{block:SeoBlock}){
  switch(block.type){
    case 'p':return <p>{renderRich(block.text)}</p>;
    case 'h3':return <h3>{block.text}</h3>;
    case 'ul':return <ul>{block.items.map((item,i)=><li key={i}>{renderRich(item)}</li>)}</ul>;
    case 'ol':return <ol>{block.items.map((item,i)=><li key={i}>{renderRich(item)}</li>)}</ol>;
    case 'callout':return <aside className="seo-callout"><p className="seo-callout-title">{block.title}</p><p>{renderRich(block.text)}</p></aside>;
  }
}

const updatedLabel=(iso:string)=>new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(iso));

// `children`: an optional block rendered right after the hero (the offers on /tarifs).
export function PublicSeoPage({page,children}:{page:SeoPage;children?:ReactNode}){
  // The page's questions and its place in the site, for search engines and AI assistants (escaped like layout.tsx).
  const jsonLd=JSON.stringify([faqJsonLd(page),breadcrumbJsonLd(page)]).replace(/</g,'\\u003c');
  if(WEB_V2)return <SeoPageV2 page={page} jsonLd={jsonLd}>{children}</SeoPageV2>;
  return <main className="seo-public seo-article-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd}}/>
    <header className="seo-public-nav">
      <Link href="/" className="seo-brand"><b className="logo">P</b> ProspectOS</Link>
      <Link href="/" className="text-button">Voir la démo</Link>
    </header>
    <article className="seo-article">
      <header className="seo-hero">
        <p className="eyebrow">{page.eyebrow}</p>
        <h1>{page.h1}</h1>
        <p className="seo-intro">{page.intro}</p>
        <p className="seo-updated">Mis à jour le <time dateTime={page.updated}>{updatedLabel(page.updated)}</time></p>
      </header>
      {children}
      {page.sections.map(section=><section key={section.h2}>
        <h2>{section.h2}</h2>
        {section.blocks.map((block,i)=><Block key={i} block={block}/>)}
      </section>)}
      {page.faq.length>0&&<section className="seo-faq">
        <h2>Questions fréquentes</h2>
        {page.faq.map(item=><div key={item.q}><h3>{item.q}</h3><p>{renderRich(item.a)}</p></div>)}
      </section>}
      <section className="seo-cta">
        <h2>{page.cta.title}</h2>
        <p>{page.cta.text}</p>
        <Link href={page.cta.href??'/'} className="primary large">{page.cta.label??'Explorer la démonstration'} <span aria-hidden="true">↗</span></Link>
      </section>
    </article>
    <nav className="seo-related" aria-label="Ressources liées">
      <span>À découvrir</span>
      {relatedPages(page).map(other=><Link key={other.slug} href={`/${other.slug}`}>{other.navLabel}</Link>)}
    </nav>
  </main>;
}

// WEB-2 (docs/UI_V2.md): the same article in the ProspectOS 2.0 public envelope, rendered instead of the page above only when
// the site is built with NEXT_PUBLIC_WEB_V2_ENABLED. Same H1, sections, H2/H3, blocks, FAQ, call to action, related links and
// structured data — only the presentation changes.
function SeoPageV2({page,jsonLd,children}:{page:SeoPage;jsonLd:string;children?:ReactNode}){
  return <PublicSiteShell>
    <main className="pos-public__main" data-seo-page={page.slug}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd}}/>
      <article>
        <PublicHero eyebrow={page.eyebrow} title={page.h1} intro={page.intro}
          meta={<>Mis à jour le <time dateTime={page.updated}>{updatedLabel(page.updated)}</time></>}/>
        {children&&<div className="pos-public__offers"><div className="pos-public__wrap">{children}</div></div>}
        <div className="pos-public__section pos-public__section--reading"><div className="pos-public__wrap pos-public__prose">
          {page.sections.map(section=><section key={section.h2}>
            <h2>{section.h2}</h2>
            {section.blocks.map((block,i)=><Block key={i} block={block}/>)}
          </section>)}
          {page.faq.length>0&&<section className="seo-faq">
            <h2>Questions fréquentes</h2>
            <div className="pos-public__faq">{page.faq.map(item=><div key={item.q} className="pos-public__card"><h3>{item.q}</h3><p>{renderRich(item.a)}</p></div>)}</div>
          </section>}
        </div></div>
        <PublicCTA title={page.cta.title} text={page.cta.text} href={page.cta.href??'/'} label={page.cta.label??'Explorer la démonstration'} className="seo-cta"/>
      </article>
      <nav className="pos-public__related" aria-label="Ressources liées"><div className="pos-public__wrap">
        <span className="pos-public__related-h">À découvrir</span>
        <div className="pos-public__related-list">{relatedPages(page).map(other=><Link key={other.slug} href={`/${other.slug}`} className="pos-public__related-link">{other.navLabel} <span aria-hidden="true">→</span></Link>)}</div>
      </div></nav>
    </main>
  </PublicSiteShell>;
}
