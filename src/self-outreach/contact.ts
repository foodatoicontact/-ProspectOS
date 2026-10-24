// Self-Outreach contacts — an email is NEVER guessed. Accepted only with a stored provenance from a closed list:
// company_website / public_profile / public_document / press (a public page: its URL and an excerpt that writes the
// email literally) or direct_exchange (the person gave it). There is no "pattern" source: prenom.nom@ computed from a
// name is refused, and so is any address the excerpt does not contain. The person and the role need their own source.
// The database re-checks all of it (migration 035 outreach_contacts constraints).
export const EMAIL_SOURCES=['company_website','public_profile','public_document','press','direct_exchange'] as const;
export type EmailSource=typeof EMAIL_SOURCES[number];
export type ContactInput={prospect_id:string;contact_name:string;contact_role:string;role_source_url:string;email:string;email_source:string;email_source_url?:string|null;email_source_excerpt?:string|null};
export type ContactCheck={ok:true;contact:ContactInput&{email:string;email_source:EmailSource}}|{ok:false;reason:string};
const EMAIL=/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const httpUrl=(u:unknown)=>{try{const x=new URL(String(u));return (x.protocol==='https:'||x.protocol==='http:')&&!x.username&&!x.password}catch{return false}};
// Role mailboxes and free webmail are not a decision maker's professional address.
const ROLE_LOCAL=/^(contact|info|hello|bonjour|support|admin|noreply|no-reply|sales|commercial|marketing|jobs|rh|recrutement|careers|team|office)$/;
const FREE_MAIL=/@(gmail|yahoo|hotmail|outlook|live|orange|free|sfr|laposte|wanadoo|icloud|proton|protonmail|gmx)\./;

export function checkContact(c:ContactInput):ContactCheck{
 const email=String(c.email??'').trim().toLowerCase();
 if(!EMAIL.test(email)||email.length>254)return {ok:false,reason:'EMAIL_INVALID'};
 if(!(EMAIL_SOURCES as readonly string[]).includes(c.email_source))return {ok:false,reason:'EMAIL_SOURCE_NOT_ALLOWED'};
 if(FREE_MAIL.test(email))return {ok:false,reason:'EMAIL_NOT_PROFESSIONAL'};
 if(ROLE_LOCAL.test(email.split('@')[0]!))return {ok:false,reason:'EMAIL_ROLE_MAILBOX'};
 if(!String(c.contact_name??'').trim()||!String(c.contact_role??'').trim())return {ok:false,reason:'CONTACT_INCOMPLETE'};
 if(!httpUrl(c.role_source_url))return {ok:false,reason:'ROLE_SOURCE_REQUIRED'};
 if(c.email_source!=='direct_exchange'){
  if(!httpUrl(c.email_source_url))return {ok:false,reason:'EMAIL_SOURCE_URL_REQUIRED'};
  // The address must be WRITTEN in the stored excerpt: an address computed from a name pattern never is.
  if(!String(c.email_source_excerpt??'').toLowerCase().includes(email))return {ok:false,reason:'EMAIL_NOT_IN_SOURCE'};
 }
 return {ok:true,contact:{...c,email,email_source:c.email_source as EmailSource,contact_name:c.contact_name.trim(),contact_role:c.contact_role.trim()}};
}

// Decision-maker priority (indicative; a role the signal names first wins). Never used to invent a person: it only
// orders contacts that exist with a source.
const ROLE_RANK:[RegExp,number][]=[[/\b(cro|chief revenue|vp sales|vice.president.*sales|head of sales|directeur commercial|directrice commerciale|head of growth|revops|sales director)\b/i,1],
 [/\b(ceo|founder|fondat(eur|rice)|co-?fondat|g[ée]rant|dirigeant|pr[ée]sident)\b/i,2],[/\b(partnerships?|partenariats?|business development|bizdev|bdm)\b/i,3]];
export function roleRank(role:string,signalRoles:readonly string[]=[]):number{
 const r=role.toLowerCase();
 if(signalRoles.some(s=>s&&r.includes(s.toLowerCase())))return 0;
 return ROLE_RANK.find(([re])=>re.test(r))?.[1]??9;
}
