// Which website a prospect's analysis may fetch, decided on the server only — never from a URL sent by the
// browser. Two independent sources of authority, checked in this order:
//
//  1. dynamic_discovery — ProspectOS itself found the organization's own site and the user explicitly
//     accepted it: the prospect is linked to an ACCEPTED discovery result, from Brave, classified
//     COMPANY_CANDIDATE, whose company domain was resolved as the page's OWN site. The host comes from
//     discovery_results.website (written only by the server, migration 014) and must still be the host of
//     prospects.website (editable by members): a website changed after acceptance loses the capability.
//     Available only when DISCOVERY_DYNAMIC_ANALYSIS_ENABLED is exactly "true" (fail closed).
//  2. static_allowlist — DISCOVERY_ALLOWED_HOSTS, the operator override (manual prospects, sources the
//     operator reviewed, internal use). Unchanged semantics: host or subdomain of an allowed entry.
//
// An authorization only makes a site FETCHABLE. It is never an ICP match, never evidence, never a score:
// the fetch still goes through every SSRF, robots, size and time check of safe-fetch.ts, and whatever it
// extracts stays NOT_VERIFIED until a human confirms it.
import {registrableDomainOf} from './safe-fetch.ts';

export type AuthorizationMode = 'dynamic_discovery' | 'static_allowlist';
export type AuthorizationFailure = 'OFFICIAL_WEBSITE_REQUIRED' | 'SOURCE_POLICY_REQUIRED' | 'DYNAMIC_ANALYSIS_DISABLED' | 'DISCOVERY_CAPABILITY_INVALID' | 'WEBSITE_MISMATCH';
export type AnalysisAuthorization =
 | {ok: true; mode: AuthorizationMode; url: string; host: string; fetchPolicy: {allowedHosts: string[]; registrableDomain?: string; forbidHttpsDowngrade?: boolean}}
 | {ok: false; code: AuthorizationFailure; host: string | null};
// Only what the server reads back from discovery_results (never written by a member since migration 014).
export type AcceptedDiscoveryResult = {status: string; provider: string; source_class: string | null; website: string | null; source_url: string | null; raw_payload: unknown};

// The host a URL designates, compared across the prospect and the discovery result: lowercased, without
// a trailing dot, and without ONE leading "www." — the only variant treated as the same site
// ("bebureau.com" = "www.bebureau.com"; "shop.bebureau.com" and "evilbebureau.com" are other hosts).
export function canonicalHost(url: string | null | undefined): string | null {
 if (!url) return null;
 try {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  return host ? host.replace(/^www\./, '') : null;
 } catch { return null; }
}

// A discovery result that grants the dynamic capability, whatever the prospect's current website.
export function isEligibleDiscoveryResult(r: AcceptedDiscoveryResult): boolean {
 const method = (r.raw_payload as {company_domain_method?: unknown} | null)?.company_domain_method;
 const host = canonicalHost(r.website);
 return r.status === 'accepted' && r.provider === 'brave' && r.source_class === 'COMPANY_CANDIDATE' && method === 'own_site'
  && !!host && registrableDomainOf(host) !== null
  // Own site: the page Brave returned is on that very site.
  && !!r.source_url && registrableDomainOf(canonicalHost(r.source_url) ?? '') === registrableDomainOf(host);
}

const staticAllowed = (host: string, allowlist: string[]): boolean => allowlist.some(entry => { const e = entry.toLowerCase().replace(/\.$/, ''); return host === e || host.endsWith(`.${e}`); });

export function resolveAnalysisAuthorization(input: {prospectWebsite: string | null; acceptedResults: AcceptedDiscoveryResult[]; staticAllowlist: string[]; dynamicEnabled: boolean}): AnalysisAuthorization {
 if (!input.prospectWebsite) return {ok: false, code: 'OFFICIAL_WEBSITE_REQUIRED', host: null};
 let prospectHost: string | null = null;
 try { prospectHost = new URL(input.prospectWebsite).hostname.toLowerCase().replace(/\.$/, ''); } catch { /* invalid: nothing can be authorized */ }
 const prospectCanonical = canonicalHost(input.prospectWebsite);
 if (!prospectHost || !prospectCanonical) return {ok: false, code: 'SOURCE_POLICY_REQUIRED', host: null};

 const eligible = input.acceptedResults.filter(isEligibleDiscoveryResult);
 const matching = eligible.find(r => canonicalHost(r.website) === prospectCanonical);
 if (input.dynamicEnabled && matching) {
  // The destination is the server-written discovery website, never prospects.website itself.
  const url = new URL(matching.website!);
  const domain = registrableDomainOf(url.hostname)!;
  return {ok: true, mode: 'dynamic_discovery', url: url.origin + '/', host: prospectCanonical, fetchPolicy: {allowedHosts: [domain], registrableDomain: domain, forbidHttpsDowngrade: true}};
 }
 // Operator override, unchanged: the prospect's own website, on the configured hosts only.
 if (input.staticAllowlist.length && staticAllowed(prospectHost, input.staticAllowlist))
  return {ok: true, mode: 'static_allowlist', url: input.prospectWebsite, host: prospectCanonical, fetchPolicy: {allowedHosts: input.staticAllowlist}};

 // Refusals, most specific first — codes only, never a resolved address.
 if (eligible.length && !matching) return {ok: false, code: 'WEBSITE_MISMATCH', host: prospectCanonical};
 if (matching) return {ok: false, code: 'DYNAMIC_ANALYSIS_DISABLED', host: prospectCanonical};
 if (input.acceptedResults.length) return {ok: false, code: 'DISCOVERY_CAPABILITY_INVALID', host: prospectCanonical};
 return {ok: false, code: 'SOURCE_POLICY_REQUIRED', host: prospectCanonical};
}

// Exactly "true" enables the dynamic capability; anything else (absent, "1", "TRUE ", "yes"…) keeps it off.
export const dynamicAnalysisEnabled = (value: string | undefined): boolean => value === 'true';
