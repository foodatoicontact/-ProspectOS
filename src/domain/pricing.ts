// ProspectOS Bêta — the single commercial offer, and pure helpers to read the counters the server returns.
// The server is the source of truth: the limits below only mirror migration 016's defaults for the pricing
// copy and its tests; every quota decision is taken in the database (enforce_plan_limit) and the browser
// only DISPLAYS what get_commercial_usage() answers. Nothing here can grant or extend an action.
export const BETA_OFFER={
 priceEurExclVatPerMonth:49,
 trialDays:7,
 trial:{discovery:20,analysis:50,aiOffer:5},
 paid:{discovery:100,analysis:250,aiOffer:25},
} as const;

export type CommercialUsage={
 plan:'BETA'|'PAID'|'PRO'|'ENTERPRISE'|'INTERNAL'|null;status?:string;period_start?:string;period_end?:string;active?:boolean;
 discovery_used?:number;discovery_limit?:number;analysis_used?:number;analysis_limit?:number;ai_offer_used?:number;ai_offer_limit?:number;
};
export type Counter={used:number;limit:number;reached:boolean};
export type UsageView={kind:'trial'|'paid';active:boolean;periodEnd:string;daysLeft:number;discovery:Counter;analysis:Counter;aiOffer:Counter};

const DAY=86400000;
const count=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=0?v:null;
// Whole days left before `end` (rounded up, never negative): "ends in 3 days" until the last moment.
export function daysLeft(end:string,now=Date.now()):number{
 const t=new Date(end).getTime();return Number.isFinite(t)?Math.max(0,Math.ceil((t-now)/DAY)):0;
}
// null when there is nothing to show: no entitlement, INTERNAL (unlimited), or an answer that is not the
// expected shape (migration 016 not applied yet → the account route answers usage:null).
export function usageView(raw:unknown,now=Date.now()):UsageView|null{
 if(!raw||typeof raw!=='object')return null;
 const u=raw as CommercialUsage;
 if(u.plan!=='BETA'&&u.plan!=='PAID'&&u.plan!=='PRO'&&u.plan!=='ENTERPRISE')return null;
 const du=count(u.discovery_used),dl=count(u.discovery_limit),au=count(u.analysis_used),al=count(u.analysis_limit),ou=count(u.ai_offer_used),ol=count(u.ai_offer_limit);
 if(du===null||dl===null||au===null||al===null||ou===null||ol===null||typeof u.period_end!=='string'||!Number.isFinite(new Date(u.period_end).getTime()))return null;
 const active=u.active===true&&new Date(u.period_end).getTime()>now;
 return {
  kind:u.plan==='BETA'?'trial':'paid',active,periodEnd:u.period_end,daysLeft:daysLeft(u.period_end,now),
  discovery:{used:du,limit:dl,reached:du>=dl},analysis:{used:au,limit:al,reached:au>=al},aiOffer:{used:ou,limit:ol,reached:ou>=ol},
 };
}
// Supabase Auth refuses a new confirmation e-mail sent too soon (per-address cooldown, or the project's
// e-mail rate limit). That is not a failure of the user: the first e-mail is on its way.
export function isEmailRateLimitError(error:unknown):boolean{
 if(!error||typeof error!=='object')return false;
 const e=error as {code?:unknown;status?:unknown;message?:unknown};
 if(e.code==='over_email_send_rate_limit')return true;
 const message=typeof e.message==='string'?e.message:'';
 return /email rate limit|only request this after|over_email_send_rate_limit/i.test(message)||(e.status===429&&/e-?mail/i.test(message));
}
