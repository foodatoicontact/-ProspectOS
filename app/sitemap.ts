import type {MetadataRoute} from 'next';
import {SITE_URL,sitemapEntries} from '../src/domain/seo';
import {creationsSitemapEntries,fetchRecent} from '../src/domain/company-creations';

// lastModified comes from each page's own `updated` date (real content edits), never from the build date.
// The company-creation pages change with their data: their date is that of the newest creation notice published for the
// zone (one grouped register query); if the register does not answer, the first day of the current month. Regenerated daily.
export const revalidate=86400;
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
  // The "3 prospects de votre zone" offer page (static; dated by its own last edit).
  const offer={url:`${SITE_URL}/prospects-de-votre-zone`,lastModified:'2026-11-01',changeFrequency:'monthly' as const,priority:.8};
  const now=new Date();
  const recent=await fetchRecent(null,{now}).catch(()=>null);
  return [...sitemapEntries,offer,...creationsSitemapEntries(SITE_URL,now,recent)].map(entry=>({...entry,lastModified:new Date(entry.lastModified)}));
}
