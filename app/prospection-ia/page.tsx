import type {Metadata} from 'next';
import {PublicSeoPage} from '../../src/components/PublicSeoPage';
import {SITE_URL,getSeoPage} from '../../src/domain/seo';

const page=getSeoPage('prospection-ia');
export const metadata:Metadata={
  title:{absolute:page.title},
  description:page.description,
  alternates:{canonical:`${SITE_URL}/prospection-ia`},
  openGraph:{title:{absolute:page.title},description:page.description,url:`${SITE_URL}/prospection-ia`,type:'website',locale:'fr_FR',siteName:'ProspectOS'},
  twitter:{card:'summary_large_image',title:{absolute:page.title},description:page.description},
};
export default function Page(){return <PublicSeoPage page={page}/>}
