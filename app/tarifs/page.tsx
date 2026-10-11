import type {Metadata} from 'next';
import {PublicSeoPage} from '../../src/components/PublicSeoPage';
import {PricingPage} from '../../src/components/PricingPage';
import {getSeoPage,seoPageMetadata} from '../../src/domain/seo';

const page=getSeoPage('tarifs');
export const metadata:Metadata=seoPageMetadata(page);
// The offers first (plans, quotas, free-trial call to action), then the factual detail of how quotas are counted.
export default function Page(){return <PublicSeoPage page={page}><PricingPage/></PublicSeoPage>}
