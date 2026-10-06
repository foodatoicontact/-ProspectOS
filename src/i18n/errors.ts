import type {Locale} from './locale.ts';
import {fr} from './fr.ts';
import {en} from './en.ts';
// The API (app/api/v1/[...path]/route.ts) always answers with a fixed FRENCH message string, plus a
// stable `code` for the handful of errors listed below — it never knows or needs to know the caller's
// UI locale (server responses stay locale-agnostic by design; see AGENTS/CLAUDE constraints on not
// touching the API contract). The client-side error surface (`error instanceof Error` messages shown
// via setNotice) re-localizes ONLY these known, stable codes; any other server message (validation
// errors, unexpected failures) is shown exactly as the server sent it, in French, rather than guessing
// a translation for text this module doesn't recognize.
const CODE_KEYS={
 ENTITLEMENT_REQUIRED:'error.entitlementRequired',
 BETA_ACCESS_EXPIRED:'error.betaAccessExpired',
 BYOK_CREDENTIAL_INVALID:'error.byokCredentialInvalid',
 ADMIN_ACCESS_REQUIRED:'error.adminAccessRequired',
 LAST_OWNER_BLOCKED:'error.lastOwnerBlocked',
 BETA_CAPACITY_REACHED:'error.betaCapacityReached',
 PLAN_LIMIT_REACHED:'error.planLimitReached',
 OFFER_LIMIT_REACHED:'error.offerLimitReached',
 OFFER_ANALYSIS_IN_PROGRESS:'error.offerAnalysisInProgress',
 CANDIDATE_NOT_ACCEPTABLE:'error.candidateNotAcceptable',
 ROBOTS_UNAVAILABLE:'error.analysis.ROBOTS_UNAVAILABLE',
 SITE_TIMEOUT:'error.analysis.SITE_TIMEOUT',
 SITE_NOT_FOUND:'error.analysis.SITE_NOT_FOUND',
 SITE_BLOCKED:'error.analysis.SITE_BLOCKED',
 SITE_HTTP_ERROR:'error.analysis.SITE_HTTP_ERROR',
 SITE_REDIRECT_REFUSED:'error.analysis.SITE_REDIRECT_REFUSED',
 SITE_NOT_HTML:'error.analysis.SITE_NOT_HTML',
 SITE_TOO_LARGE:'error.analysis.SITE_TOO_LARGE',
 ACTIVE_SUBSCRIPTION_BLOCKED:'error.activeSubscriptionBlocked',
 SUBSCRIPTION_EXISTS:'error.subscriptionExists',
 BILLING_UNAVAILABLE:'error.billingUnavailable',
 BETA_OFFER_CLOSED:'error.betaOfferClosed',
 BILLING_PROVIDER_ERROR:'error.billingProviderError',
 NO_BILLING_ACCOUNT:'error.noBillingAccount',
 ENTERPRISE_QUOTE_ONLY:'error.enterpriseQuoteOnly',
 TEAM_PLAN_REQUIRED:'error.team.planRequired',
 TEAM_OWNER_REQUIRED:'error.team.ownerRequired',
 TEAM_FULL:'error.team.full',
 TEAM_ALREADY_MEMBER:'error.team.alreadyMember',
 TEAM_ALREADY_IN_TEAM:'error.team.alreadyInTeam',
 TEAM_INVITATION_INVALID:'error.team.invitationInvalid',
 TEAM_INVITATION_EMAIL_MISMATCH:'error.team.emailMismatch',
 TEAM_EMAIL_NOT_CONFIRMED:'error.team.emailNotConfirmed',
 TEAM_UNAVAILABLE:'error.team.unavailable',
 TEAM_MEMBER_REQUIRED:'error.team.memberRequired',
} as const;
export function localizeApiErrorMessage(message:string,code:string|undefined,locale:Locale):string{
 const key=code?CODE_KEYS[code as keyof typeof CODE_KEYS]:undefined;
 if(!key)return message;
 return locale==='fr'?fr[key]:en[key];
}
