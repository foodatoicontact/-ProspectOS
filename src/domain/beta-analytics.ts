// Pure derivation layer over the raw facts public.beta_analytics() returns. The SQL function is
// deliberately a thin fact source (see migration 013) — every interpretation (funnel stage, days
// remaining, percentages) lives here so it stays reviewable/testable without a database.
export type BetaAnalyticsUser={
 user_id:string; email:string|null; user_created_at:string; email_confirmed_at:string|null; last_sign_in_at:string|null;
 plan:string|null; status:string|null; entitlement_starts_at:string|null; expires_at:string|null;
 organization_id:string|null; organization_created_at:string|null;
 project_count:number; first_project_at:string|null;
 discovery_run_count:number; first_discovery_at:string|null;
 prospect_count:number; last_business_activity_at:string|null;
};
export type BetaAnalytics={capacity:number; beta_used:number; users:BetaAnalyticsUser[]};

// A milestone ever reached, not the CURRENT entitlement state — a user whose trial later expires still
// shows TRIAL_ACTIVE (or further) here; their current status/days-remaining is a separate, distinct
// column. This is schema-guaranteed monotonic: a project can't exist without its organization, a
// discovery_run can't exist without its project, a prospect can't exist without its project — so
// checking from the most advanced stage down is always correct, never a heuristic guess.
export const FUNNEL_STAGES=['SIGNED_UP','TRIAL_ACTIVE','ORGANIZATION_CREATED','PROJECT_CREATED','DISCOVERY_STARTED','PROSPECTS_CREATED'] as const;
export type FunnelStage=typeof FUNNEL_STAGES[number];
export function funnelStage(u:BetaAnalyticsUser):FunnelStage{
 if(u.prospect_count>0)return 'PROSPECTS_CREATED';
 if(u.discovery_run_count>0)return 'DISCOVERY_STARTED';
 if(u.project_count>0)return 'PROJECT_CREATED';
 if(u.organization_id)return 'ORGANIZATION_CREATED';
 if(u.plan==='BETA')return 'TRIAL_ACTIVE';
 return 'SIGNED_UP';
}

// Never negative, never fabricated for a user with no entitlement at all (null, not 0 — 0 would falsely
// read as "expires today").
export function daysRemaining(expiresAt:string|null,now=Date.now()):number|null{
 if(!expiresAt)return null;
 return Math.max(0,Math.ceil((new Date(expiresAt).getTime()-now)/86400000));
}

// "Dernière activité observable" per the brief: the most recent REAL business event (see migration
// 013's comment — sourced from the append-only `events` table), never last_sign_in_at (an
// authentication fact, shown separately). Returns null — rendered as "Aucune activité métier" by the
// UI — rather than ever falling back to a login timestamp.
export function lastBusinessActivity(u:BetaAnalyticsUser):string|null{return u.last_business_activity_at}

// Cumulative funnel: each stage counts every user who has reached AT LEAST that stage (funnel
// semantics), so a user further along is counted at every earlier stage too.
export function funnelCounts(users:BetaAnalyticsUser[]):Record<FunnelStage,number>{
 const counts=Object.fromEntries(FUNNEL_STAGES.map(s=>[s,0])) as Record<FunnelStage,number>;
 for(const u of users){const idx=FUNNEL_STAGES.indexOf(funnelStage(u));for(let i=0;i<=idx;i++)counts[FUNNEL_STAGES[i]]++}
 return counts;
}

export type FunnelRow={stage:FunnelStage; count:number; pct_of_signups:number|null; pct_of_previous:number|null};
// Percentages are pilotage aids for a ~10-person beta, never a statistically significant figure — the
// caller/UI must present them as such (see the "small sample" note the brief requires), not as PASS/FAIL.
export function funnelWithPercentages(users:BetaAnalyticsUser[]):FunnelRow[]{
 const counts=funnelCounts(users);
 const total=users.length;
 return FUNNEL_STAGES.map((stage,i)=>{
  const count=counts[stage];
  const prevCount=i===0?total:counts[FUNNEL_STAGES[i-1]];
  return {stage,count,pct_of_signups:total>0?Math.round(count/total*1000)/10:null,pct_of_previous:prevCount>0?Math.round(count/prevCount*1000)/10:null};
 });
}

export const FUNNEL_STAGE_LABELS:Record<FunnelStage,string>={
 SIGNED_UP:'Inscrits',
 TRIAL_ACTIVE:'Trial activé',
 ORGANIZATION_CREATED:'Organisation créée',
 PROJECT_CREATED:'Projet créé',
 DISCOVERY_STARTED:'Discovery lancée',
 PROSPECTS_CREATED:'Prospects obtenus',
};
// English UI labels for the same funnel stages — added for the FR/EN interface switcher (i18n bloc).
// The FunnelStage identifiers themselves (SIGNED_UP, TRIAL_ACTIVE, …) are the actual, already-English
// internal values used everywhere else (funnelStage(), funnelCounts()) and are never touched here.
export const FUNNEL_STAGE_LABELS_EN:Record<FunnelStage,string>={
 SIGNED_UP:'Signed up',
 TRIAL_ACTIVE:'Trial activated',
 ORGANIZATION_CREATED:'Organization created',
 PROJECT_CREATED:'Project created',
 DISCOVERY_STARTED:'Discovery started',
 PROSPECTS_CREATED:'Prospects obtained',
};
