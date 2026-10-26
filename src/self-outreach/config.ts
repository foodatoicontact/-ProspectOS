// Self-Outreach (docs/SELF_OUTREACH.md) — server-side configuration. Two flags, both OFF unless set to "true"/"1":
//   SELF_OUTREACH_ENABLED       the workflow (candidates, review, queue, mock / dry runs) is available;
//   SELF_OUTREACH_SEND_ENABLED  the real SMTP transport may be built. Without it NO code path can send an email.
// The SMTP / IMAP credentials are read here only, server-side; they are never returned, logged or put in an error: what
// leaves this module is a presence report (configured: true/false), never a value.
export type Env=Record<string,string|undefined>;
const on=(v:string|undefined)=>{const x=(v??'').trim().toLowerCase();return x==='true'||x==='1'};
const int=(v:string|undefined,def:number,min:number,max:number)=>{const n=Number.parseInt(v??'',10);return Number.isFinite(n)&&n>=min&&n<=max?n:def};
export const selfOutreachEnabled=(env:Env)=>on(env.SELF_OUTREACH_ENABLED);
// Sending needs BOTH flags: the send flag alone never enables anything.
export const selfOutreachSendEnabled=(env:Env)=>selfOutreachEnabled(env)&&on(env.SELF_OUTREACH_SEND_ENABLED);
export const outreachScoreThreshold=(env:Env)=>int(env.OUTREACH_SCORE_THRESHOLD,75,0,100);
export const maxNewOutreachPerDay=(env:Env)=>int(env.MAX_NEW_OUTREACH_PER_DAY,10,0,500);
// The only organizations whose campaigns the server works for (ProspectOS's own). Empty = none.
export const selfOutreachOrganizations=(env:Env)=>(env.SELF_OUTREACH_ORG_IDS??'').split(',').map(s=>s.trim().toLowerCase()).filter(s=>/^[0-9a-f-]{36}$/.test(s));
// What the account may show: the workflow flag AND the account's own organization in the list — the same test the routes
// apply (api.ts), so no other customer ever sees an entry the server would refuse.
export const selfOutreachEnabledFor=(env:Env,organizationId:string|null|undefined)=>selfOutreachEnabled(env)&&!!organizationId&&selfOutreachOrganizations(env).includes(organizationId.trim().toLowerCase());
// An account can belong to several organizations (its own, plus a team it joined): the entry is shown when ANY of them is
// served. Access itself is decided per project — the routes test the project's organization, the database its list.
export const selfOutreachEnabledForAny=(env:Env,organizationIds:readonly (string|null|undefined)[])=>organizationIds.some(id=>selfOutreachEnabledFor(env,id));

export type SmtpConfig={host:string;port:number;secure:boolean;user:string;password:string;fromEmail:string;fromName:string};
export type ImapConfig={host:string;port:number;user:string;password:string};
const EMAIL=/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
export function smtpConfig(env:Env):SmtpConfig|null{
 const host=env.OUTREACH_SMTP_HOST?.trim(),user=env.OUTREACH_SMTP_USER?.trim(),password=env.OUTREACH_SMTP_PASSWORD,from=env.OUTREACH_FROM_EMAIL?.trim().toLowerCase();
 if(!host||!user||!password||!from||!EMAIL.test(from))return null;
 const port=int(env.OUTREACH_SMTP_PORT,465,1,65535);
 // 465 = implicit TLS; any other port must upgrade with STARTTLS (required, never plaintext).
 return {host,port,secure:port===465,user,password,fromEmail:from,fromName:(env.OUTREACH_FROM_NAME??'').replace(/[\r\n"<>]/g,'').trim().slice(0,80)};
}
export function imapConfig(env:Env):ImapConfig|null{
 const host=env.OUTREACH_IMAP_HOST?.trim(),user=env.OUTREACH_IMAP_USER?.trim(),password=env.OUTREACH_IMAP_PASSWORD;
 if(!host||!user||!password)return null;
 return {host,port:int(env.OUTREACH_IMAP_PORT,993,1,65535),user,password};
}
// The domain of the RFC Message-IDs we generate: the sender's domain, never a secret.
export const messageDomain=(env:Env)=>{const f=env.OUTREACH_FROM_EMAIL?.trim().toLowerCase()??'';return EMAIL.test(f)?f.split('@')[1]!:'outreach.invalid'};
// What the API / UI may know about the configuration: presence only.
export function configurationReport(env:Env){
 return {enabled:selfOutreachEnabled(env),send_enabled:selfOutreachSendEnabled(env),smtp_configured:!!smtpConfig(env),imap_configured:!!imapConfig(env),
  threshold:outreachScoreThreshold(env),max_per_day:maxNewOutreachPerDay(env),organizations:selfOutreachOrganizations(env).length};
}
