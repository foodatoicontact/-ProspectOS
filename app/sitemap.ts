import type {MetadataRoute} from 'next';
import {sitemapEntries} from '../src/domain/seo';

export default function sitemap():MetadataRoute.Sitemap{
  const lastModified=new Date('2026-09-17');
  return sitemapEntries.map(entry=>({...entry,lastModified}));
}
