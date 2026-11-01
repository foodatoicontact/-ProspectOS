import type {MetadataRoute} from 'next';
import {SITE_URL,sitemapEntries} from '../src/domain/seo';
import {creationsSitemapEntries} from '../src/domain/company-creations';

// lastModified comes from each page's own `updated` date (real content edits), never from the build date.
// The company-creation barometer changes with its data: its date is the first day of the month in which the last
// complete month became available (src/domain/company-creations.ts), so the sitemap is regenerated daily too.
export const revalidate=86400;
export default function sitemap():MetadataRoute.Sitemap{
  // The "3 prospects de votre zone" offer page (static; dated by its own last edit).
  const offer={url:`${SITE_URL}/prospects-de-votre-zone`,lastModified:'2026-11-01',changeFrequency:'monthly' as const,priority:.8};
  return [...sitemapEntries,offer,...creationsSitemapEntries(SITE_URL,new Date())].map(entry=>({...entry,lastModified:new Date(entry.lastModified)}));
}
