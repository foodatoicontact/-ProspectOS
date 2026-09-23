// Server-side diagnosis of a failed Discovery run. find_prospects still stores and throws the single
// generic DISCOVERY_FAILED (unchanged for the run row, the HTTP response and the browser); this only
// adds WHY to the server log. Every value returned is a fixed code, an HTTP status, a database error
// code or a schema field path: never an error message, a provider payload, a result's content, a URL,
// a key or a token.
export type DiscoveryStage='existing'|'provider_search'|'normalize'|'dedupe'|'save'|'finish';
type Diagnosis={stage:DiscoveryStage;cause:string;http_status:number|null;fields:string|null;db_code:string|null;error_name:string|null};
const KNOWN_PROVIDER_CODES=new Set(['BRAVE_EMPTY_RESPONSE','BRAVE_RESPONSE_TOO_LARGE']);
const KNOWN_REPOSITORY_CODES=new Set(['DATABASE_REQUEST_FAILED','CONFIGURATION_REQUIRED','QUOTA_EXCEEDED','MAX_RESULTS_EXCEEDED']);
const safeSegment=(s:unknown)=>typeof s==='number'?String(s):typeof s==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(s)?s:'?';
const safeCode=(s:unknown)=>typeof s==='string'&&/^[a-z_]{1,40}$/.test(s)?s:'?';
// Schema issues reduced to "path:code" pairs (e.g. "name:too_small") — the issue messages are dropped.
function issueFields(error:unknown):string|null{
 const issues=(error as {issues?:unknown})?.issues;if(!Array.isArray(issues))return null;
 return issues.slice(0,5).map(i=>`${(Array.isArray(i?.path)?i.path:[]).map(safeSegment).join('.')||'(root)'}:${safeCode(i?.code)}`).join(',')||null;
}
const nameOf=(error:unknown)=>{const n=(error as {name?:unknown})?.name;return typeof n==='string'&&/^[A-Za-z]{1,40}$/.test(n)?n:null};
const messageOf=(error:unknown)=>error instanceof Error?error.message:'';
export function diagnoseDiscoveryFailure(stage:DiscoveryStage,error:unknown):Diagnosis{
 const base:Diagnosis={stage,cause:'UNKNOWN',http_status:null,fields:null,db_code:null,error_name:nameOf(error)};
 const message=messageOf(error);const isSchema=Array.isArray((error as {issues?:unknown})?.issues);
 if(stage==='provider_search'){
  const http=/^BRAVE_HTTP_(\d{3})$/.exec(message);if(http)return {...base,cause:`BRAVE_HTTP_${http[1]}`,http_status:Number(http[1])};
  if(KNOWN_PROVIDER_CODES.has(message))return {...base,cause:message};
  if(base.error_name==='TimeoutError'||base.error_name==='AbortError')return {...base,cause:'PROVIDER_TIMEOUT'};
  if(base.error_name==='SyntaxError')return {...base,cause:'PROVIDER_RESPONSE_PARSE'};
  if(isSchema)return {...base,cause:'PROVIDER_RESPONSE_PARSE',fields:issueFields(error)};
  if(base.error_name==='TypeError')return {...base,cause:'PROVIDER_NETWORK'};
  return base;
 }
 if(stage==='normalize')return {...base,cause:isSchema?'NORMALIZATION_INVALID':'NORMALIZATION_FAILED',fields:issueFields(error)};
 if(stage==='dedupe')return {...base,cause:'DEDUPE_FAILED'};
 const code=(error as {cause?:{code?:unknown}})?.cause?.code;
 return {...base,cause:KNOWN_REPOSITORY_CODES.has(message)?message:'UNKNOWN',db_code:typeof code==='string'&&/^([0-9A-Z]{5}|PGRST\d{3})$/.test(code)?code:null};
}
