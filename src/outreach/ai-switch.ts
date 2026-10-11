// O1/O2 — the AI outreach kill switch, server side, AI outreach only (the offer analysis and every other AI or BYOK use
// ignore it). AI_OUTREACH_ENABLED must say "true" (or "1") to allow an AI outreach attempt; absent, empty, "false" or
// anything else = hard OFF: no attempt, no BYOK credential read, no unit reserved, no provider call — the rule-based
// message only — and the browser neither shows the "use AI" option nor an AI outreach counter.
export function aiOutreachEnabled(env:Record<string,string|undefined>):boolean{
 const v=env.AI_OUTREACH_ENABLED?.trim().toLowerCase();
 return v==='true'||v==='1';
}
// get_commercial_usage's answer without the AI outreach pair while the switch is off (the other counters untouched).
export function withAiOutreachUsage<T>(usage:T,enabled:boolean):T{
 if(enabled||!usage||typeof usage!=='object'||Array.isArray(usage))return usage;
 const {ai_outreach_used:_used,ai_outreach_limit:_limit,...rest}=usage as Record<string,unknown>;
 return rest as T;
}
