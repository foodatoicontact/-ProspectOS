import type {Metadata} from 'next';
import {SITE_URL,siteMetadata,softwareApplicationJsonLd,webSiteJsonLd} from '../src/domain/seo';
import './globals.css';

export const metadata:Metadata={
  metadataBase:new URL(SITE_URL),
  title:{default:siteMetadata.title,template:'%s | ProspectOS'},
  description:siteMetadata.description,
  alternates:{canonical:siteMetadata.canonical},
  applicationName:'ProspectOS',
  category:'business',
  keywords:['prospection B2B','prospection IA','lead scoring','qualification prospects','sales intelligence'],
  openGraph:{
    type:'website',
    locale:'fr_FR',
    url:SITE_URL,
    siteName:'ProspectOS',
    title:siteMetadata.title,
    description:siteMetadata.description,
  },
  twitter:{card:'summary_large_image',title:siteMetadata.title,description:siteMetadata.description},
  robots:{
    index:true,
    follow:true,
    googleBot:{index:true,follow:true,'max-image-preview':'large','max-snippet':-1,'max-video-preview':-1},
  },
};

export default function Layout({children}:{children:React.ReactNode}){
  const jsonLd=JSON.stringify([softwareApplicationJsonLd,webSiteJsonLd]).replace(/</g,'\\u003c');
  return <html lang="fr"><body>
    {children}
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd}}/>
  </body></html>;
}
