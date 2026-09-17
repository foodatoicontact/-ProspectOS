# ProspectOS SEO patch

Date: 2026-09-17

## Scope

This patch only changes public SEO/discovery surfaces. It does not alter the Discovery Engine, evidence states, scoring, RLS, authentication flows, or prospect data model.

## Added

- `app/robots.ts`
- `app/sitemap.ts`
- `app/opengraph-image.tsx`
- `src/domain/seo.ts`
- `src/components/PublicSeoPage.tsx`
- `/prospection-b2b`
- `/prospection-ia`
- `/lead-scoring`
- `/prospection-restaurants`
- SEO regression tests (`tests/seo.test.ts`, `tests/seo-routes.test.ts`)

## Updated

- Root metadata: title, description, canonical, Open Graph, Twitter, Googlebot directives.
- JSON-LD: `SoftwareApplication` and `WebSite` without invented pricing.
- Public homepage eyebrow and internal SEO links.
- Public styles for SEO landing pages.

## Canonical base URL

Default: `https://prospectos-v0.vercel.app`

Override in deployment with:

`NEXT_PUBLIC_SITE_URL=https://your-domain.example`

## Verification performed in this environment

- SEO regression suite: **10/10 passing**.
- Full `npm test` was attempted. SEO/core/relations tests that could load passed, but the full suite could not complete because dependency installation timed out in this execution environment, leaving packages such as `cheerio`, `zod`, and `ipaddr.js` unavailable.
- A full Next.js production build could therefore not be independently verified here. Run `npm ci && npm test && npm run typecheck && npm run build` in Vercel/CI before production promotion.
