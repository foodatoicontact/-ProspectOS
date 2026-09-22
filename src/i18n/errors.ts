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
} as const;
export function localizeApiErrorMessage(message:string,code:string|undefined,locale:Locale):string{
 const key=code?CODE_KEYS[code as keyof typeof CODE_KEYS]:undefined;
 if(!key)return message;
 return locale==='fr'?fr[key]:en[key];
}
