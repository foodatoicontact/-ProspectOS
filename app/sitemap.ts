import type {MetadataRoute} from 'next';
import {sitemapEntries} from '../src/domain/seo';

// lastModified comes from each page's own `updated` date (real content edits), never from the build date.
export default function sitemap():MetadataRoute.Sitemap{
  return sitemapEntries.map(entry=>({...entry,lastModified:new Date(entry.lastModified)}));
}
