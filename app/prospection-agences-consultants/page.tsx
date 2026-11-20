import type {Metadata} from 'next';
import {PublicSeoPage} from '../../src/components/PublicSeoPage';
import {getSeoPage,seoPageMetadata} from '../../src/domain/seo';

const page=getSeoPage('prospection-agences-consultants');
export const metadata:Metadata=seoPageMetadata(page);
export default function Page(){return <PublicSeoPage page={page}/>}
