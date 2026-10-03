import type {Metadata} from 'next';
import {seoPages} from './seo-content.ts';
export const SITE_URL=(process.env.NEXT_PUBLIC_SITE_URL??'https://prospectos-v0.vercel.app').replace(/\/$/,'');

export const siteMetadata={
  title:'ProspectOS — Logiciel de prospection B2B fondé sur des preuves',
  description:'ProspectOS est un logiciel de prospection B2B assisté par IA qui qualifie et score des prospects à partir de preuves vérifiables, puis prépare une approche personnalisée avec validation humaine.',
  canonical:SITE_URL,
};

// Inline text: plain string; `[anchor](/path)` marks an internal link (see renderRich in PublicSeoPage).
export type SeoBlock=
  |{type:'p';text:string}
  |{type:'h3';text:string}
  |{type:'ul'|'ol';items:string[]}
  |{type:'callout';title:string;text:string};

export type SeoPage={
  slug:string;
  navLabel:string;
  updated:string;
  keywords:{primary:string;secondary:string[]};
  title:string;
  description:string;
  eyebrow:string;
  h1:string;
  intro:string;
  sections:{h2:string;blocks:SeoBlock[]}[];
  faq:{q:string;a:string}[];
  cta:{title:string;text:string};
  related:string[];
};

export {seoPages};

// Social image shared by every public page: the root app/opengraph-image.tsx route (1200×630).
export const socialImage={url:`${SITE_URL}/opengraph-image`,width:1200,height:630,alt:'ProspectOS — prospection B2B fondée sur des preuves'};

export function seoPageMetadata(page:SeoPage):Metadata{
  const url=`${SITE_URL}/${page.slug}`;
  return {
    title:{absolute:page.title},
    description:page.description,
    alternates:{canonical:url},
    openGraph:{title:page.title,description:page.description,url,type:'article',locale:'fr_FR',siteName:'ProspectOS',images:[socialImage],modifiedTime:page.updated},
    twitter:{card:'summary_large_image',title:page.title,description:page.description,images:[socialImage]},
  };
}

// Last real change of the homepage content (landing copy in app/page.tsx + src/i18n, commit 1b02521).
// Update by hand when the landing copy changes.
export const HOME_LAST_MODIFIED='2026-10-03';

export const robotsPolicy={
  allow:'/',
  disallow:['/api/','/auth/'],
  sitemap:`${SITE_URL}/sitemap.xml`,
};

export const sitemapEntries=[
  {url:SITE_URL,lastModified:HOME_LAST_MODIFIED,changeFrequency:'weekly' as const,priority:1},
  ...seoPages.map(page=>({url:`${SITE_URL}/${page.slug}`,lastModified:page.updated,changeFrequency:'monthly' as const,priority:.8})),
];

export const softwareApplicationJsonLd={
  '@context':'https://schema.org',
  '@type':'SoftwareApplication',
  name:'ProspectOS',
  url:SITE_URL,
  applicationCategory:'BusinessApplication',
  operatingSystem:'Web',
  description:siteMetadata.description,
};

export const webSiteJsonLd={
  '@context':'https://schema.org',
  '@type':'WebSite',
  name:'ProspectOS',
  url:SITE_URL,
  description:siteMetadata.description,
  inLanguage:'fr-FR',
};

export function getSeoPage(slug:string){
  const page=seoPages.find(item=>item.slug===slug);
  if(!page)throw new Error(`Unknown SEO page: ${slug}`);
  return page;
}

// "À découvrir" links: the page's own related list, never the current page, unknown slugs dropped.
export function relatedPages(page:SeoPage):SeoPage[]{
  return page.related.filter(slug=>slug!==page.slug).flatMap(slug=>seoPages.filter(other=>other.slug===slug));
}
