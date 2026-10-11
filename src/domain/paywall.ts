// The route to the offers when the server refuses an action for a commercial reason. Display only: every refusal
// is decided by the server (entitlement, quotas); this only says which refusal deserves a "Voir les offres"
// button. The button opens the offers — it never starts a payment by itself.
//  - 'expired': no active access (trial ended, paid period ended, no entitlement);
//  - 'limit':   a quota of the current plan is used up.
// An hourly anti-abuse limit (QUOTA_EXCEEDED) is not a plan matter: no offer is suggested for it.
export type PaywallReason='expired'|'limit';
const BY_CODE:Record<string,PaywallReason>={
 BETA_ACCESS_EXPIRED:'expired',
 ENTITLEMENT_REQUIRED:'expired',
 PLAN_LIMIT_REACHED:'limit',
 OFFER_LIMIT_REACHED:'limit',
 MONITORING_LIMIT_REACHED:'limit',
};
export const paywallReasonForCode=(code:unknown):PaywallReason|null=>typeof code==='string'&&Object.hasOwn(BY_CODE,code)?BY_CODE[code]:null;
// Shown without any refusal as soon as the account itself says access has ended — except for a team member,
// whose plan is the owner's to renew.
export function paywallReasonForAccount(i:{mode:string;active:boolean|null;role:string|null|undefined;plan:string|null|undefined}):PaywallReason|null{
 if(i.mode!=='live'||i.active!==false||i.role==='member'||i.plan==='INTERNAL'||i.plan==='ENTERPRISE')return null;
 return 'expired';
}
