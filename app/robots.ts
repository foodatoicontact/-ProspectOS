import type {MetadataRoute} from 'next';
import {robotsPolicy} from '../src/domain/seo';
import {AI_CRAWLERS} from '../src/domain/geo';

// Everyone may read the public pages; AI assistants and their search crawlers are named explicitly so that an
// assistant asked about B2B prospecting can read and cite ProspectOS. Private paths stay closed to all.
export default function robots():MetadataRoute.Robots{
  return {
    rules:[{userAgent:'*',allow:robotsPolicy.allow,disallow:robotsPolicy.disallow},{userAgent:[...AI_CRAWLERS],allow:robotsPolicy.allow,disallow:robotsPolicy.disallow}],
    sitemap:robotsPolicy.sitemap,
  };
}
