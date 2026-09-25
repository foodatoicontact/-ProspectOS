// "Analyser le site" for a real (non-fixture) prospect: authorize on the server, audit, then analyze.
//
//   1. resolveAnalysisAuthorization decides from server data only (the prospect read under RLS, its
//      accepted discovery results, the operator allowlist, the kill switch) — the request body is never read;
//   2. a refusal is recorded (best effort) and returned as its code, before any quota or network use;
//   3. an authorized attempt is recorded as STARTED before anything else — if that record cannot be
//      written, nothing is fetched (no unaudited fetch);
//   4. the analysis itself (quota for the user AND the organization, then at most 3 pages through
//      safeFetch with the authorization's host policy) runs, and the attempt is closed with its outcome.
// The audit carries codes, the canonical host and page counts only.
import type {DiscoveryRepository,SafeLogger} from './services.ts';
import {CompanyAnalysisService} from './services.ts';
import {createCompositePageFetcher} from './providers/fixture.ts';
import {resolveAnalysisAuthorization,type AcceptedDiscoveryResult,type AnalysisAuthorization,type AuthorizationMode} from './analysis-authorization.ts';

export type AuditOutcome = 'STARTED' | 'ANALYZED' | 'ANALYSIS_FAILED' | 'ROBOTS_DENIED' | 'QUOTA_EXCEEDED' | Exclude<AnalysisAuthorization, {ok: true}>['code'];
export interface AnalysisAudit {
 record(entry: {userId: string; prospectId: string; host: string | null; mode: AuthorizationMode | null; outcome: AuditOutcome}): Promise<string>;
 complete(id: string, userId: string, outcome: Exclude<AuditOutcome, 'STARTED'>, pages: number | null, failedPages: number | null): Promise<void>;
}
export type FetchPolicy = Extract<AnalysisAuthorization, {ok: true}>['fetchPolicy'];
export type PolicyFetcher = (url: string, policy: FetchPolicy) => Promise<{url: string; html: string}>;

// The production fetcher: the fixed limits of every analysis plus the authorization's host policy, and the
// fixture pages (.fixture.example) served without any network, as before.
type SafeFetchFn = (url: string, options: FetchPolicy & {respectRobots: boolean; maxBytes: number; timeoutMs: number; maxRedirects: number}) => Promise<{url: string; html: string}>;
export const createPolicyFetcher = (safeFetch: SafeFetchFn): PolicyFetcher => (url, policy) =>
 createCompositePageFetcher(u => safeFetch(u, {...policy, respectRobots: true, maxBytes: 500000, timeoutMs: 12000, maxRedirects: 3}))(url);

const SAFE_HOST = /^[a-z0-9.-]{1,253}$/;
const auditHost = (host: string | null): string | null => host && SAFE_HOST.test(host) ? host : null;
const CLOSING_CODES = new Set(['QUOTA_EXCEEDED', 'ROBOTS_DENIED']);

export async function analyzeProspectWebsite(d: {
 repo: DiscoveryRepository; prospectId: string; userId: string; acceptedResults: AcceptedDiscoveryResult[];
 staticAllowlist: string[]; dynamicEnabled: boolean; audit: AnalysisAudit; fetchPage: PolicyFetcher; log: SafeLogger;
}) {
 const prospect = await d.repo.prospect(d.prospectId);
 const auth = resolveAnalysisAuthorization({prospectWebsite: prospect.website, acceptedResults: d.acceptedResults, staticAllowlist: d.staticAllowlist, dynamicEnabled: d.dynamicEnabled});
 if (!auth.ok) {
  try { await d.audit.record({userId: d.userId, prospectId: d.prospectId, host: auditHost(auth.host), mode: null, outcome: auth.code}); }
  catch { d.log({provider: 'http_html', event: 'analysis_audit_failed', outcome: auth.code}); }
  throw Error(auth.code);
 }
 const auditId = await d.audit.record({userId: d.userId, prospectId: d.prospectId, host: auditHost(auth.host), mode: auth.mode, outcome: 'STARTED'});
 const close = async (outcome: Exclude<AuditOutcome, 'STARTED'>, pages: number | null, failed: number | null) => {
  try { await d.audit.complete(auditId, d.userId, outcome, pages, failed); }
  catch { d.log({provider: 'http_html', event: 'analysis_audit_failed', outcome}); }
 };
 const service = new CompanyAnalysisService(d.repo, url => d.fetchPage(url, auth.fetchPolicy), d.log);
 try {
  const result = await service.analyze_company(d.prospectId, 'official_website', {url: auth.url});
  await close('ANALYZED', result.pages_analyzed, result.failed_pages);
  return {...result, authorization_mode: auth.mode};
 } catch (error) {
  const code = error instanceof Error && CLOSING_CODES.has(error.message) ? error.message as 'QUOTA_EXCEEDED' | 'ROBOTS_DENIED' : 'ANALYSIS_FAILED';
  await close(code, null, null);
  throw error;
 }
}
