import type {MetadataRoute} from 'next';
import {robotsPolicy} from '../src/domain/seo';

export default function robots():MetadataRoute.Robots{
  return {
    rules:{userAgent:'*',allow:robotsPolicy.allow,disallow:robotsPolicy.disallow},
    sitemap:robotsPolicy.sitemap,
  };
}
