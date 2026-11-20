// ICP import, step 2B — the browser side of the API (src/icp-import/api.ts), no React: every call answers a result,
// never throws (a lost network is a result too), so the screen can always render something readable.
import type {IcpProfile} from '../domain/icp/schema.ts';
import type {ImportRow} from './review.ts';

export type ApiResult<T>={ok:true;status:number;data:T}|{ok:false;status:number;code?:string;error?:string;network?:boolean};
export type ImportDetail={import:ImportRow;profile:IcpProfile|null;profile_state:'valid'|'unreadable'|'none';message?:string};
export type Source={kind:'file';file:Blob;name:string}|{kind:'text';text:string};
export type ValidateResult={status:'VALIDATED';offer:string|null;criteria:unknown[]|null;criteria_changed:string[];criteria_kept:string[]};
type Fetcher=(input:string,init?:RequestInit)=>Promise<Response>;

export function icpClient(token:string,fetcher:Fetcher=(i,init)=>fetch(i,init)){
 const base='/api/v1/icp-imports';
 async function call<T>(path:string,init:RequestInit={}):Promise<ApiResult<T>>{
  let res:Response;
  try{res=await fetcher(`${base}${path}`,{...init,headers:{Authorization:`Bearer ${token}`,...(init.headers as Record<string,string>|undefined)}})}
  catch{return {ok:false,status:0,network:true,code:'NETWORK'}}
  let data:unknown=null;try{data=await res.json()}catch{/* an empty or non-JSON answer */}
  if(res.ok)return {ok:true,status:res.status,data:data as T};
  const d=(data??{}) as {code?:string;error?:string};
  return {ok:false,status:res.status,code:d.code,error:d.error};
 }
 const send=(path:string,source:Source)=>source.kind==='file'
  ?call<ImportDetail>(path,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(source.name.slice(0,200))},body:source.file})
  :call<ImportDetail>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:source.text})});
 return {
  list:(projectId:string)=>call<ImportRow[]>(`?project_id=${encodeURIComponent(projectId)}`),
  get:(id:string)=>call<ImportDetail>(`/${id}`),
  create:(projectId:string,source:Source)=>source.kind==='file'
   ?send(`/file?project_id=${encodeURIComponent(projectId)}`,source)
   :call<ImportDetail>('/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:projectId,text:source.text})}),
  retry:(id:string,source:Source)=>send(`/${id}/retry`,source),
  validate:(id:string,profile:IcpProfile,keepOffer:boolean,keepCriteria:boolean)=>call<ValidateResult>(`/${id}/validate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile,keep_offer:keepOffer,keep_criteria:keepCriteria})}),
  discard:(id:string)=>call<{discarded:boolean}>(`/${id}/discard`,{method:'POST'}),
  erase:(id:string)=>call<{deleted:boolean}>(`/${id}`,{method:'DELETE'}),
 };
}
export type IcpClient=ReturnType<typeof icpClient>;

// The project's current import, as the database has it: the latest row, and its re-validated draft when there is one —
// or the draft the person chose to look at again (pinned) while it is still a draft. When the latest import failed (a
// retry that did not go through), previousDraft names the earlier draft that is still there to review.
export type Latest={row:ImportRow|null;detail:ImportDetail|null;previousDraft:string|null};
export async function loadLatest(client:IcpClient,projectId:string,pinned?:string|null):Promise<ApiResult<Latest>>{
 const list=await client.list(projectId);
 if(!list.ok)return list;
 const pinnedRow=pinned?list.data.find(r=>r.id===pinned&&r.status==='EXTRACTED'):undefined;
 const row=pinnedRow??list.data[0]??null;
 if(!row)return {ok:true,status:200,data:{row:null,detail:null,previousDraft:null}};
 const previousDraft=row.status==='FAILED'?list.data.find(r=>r.id!==row.id&&r.status==='EXTRACTED')?.id??null:null;
 if(row.status==='PENDING')return {ok:true,status:200,data:{row,detail:null,previousDraft}};
 const detail=await client.get(row.id);
 if(!detail.ok)return detail;
 return {ok:true,status:200,data:{row:detail.data.import,detail:detail.data,previousDraft}};
}

// Unvalidated edits survive a reload of this tab only (sessionStorage: gone when the tab closes, never shared with another
// tab or another person on the same computer). Cleared on validation, rejection, deletion and sign-out (clearAllDrafts,
// called by the account menu and on an expired session). The database stays the reference.
const DRAFT_PREFIX='prospectos.icp-review.';
const draftKey=(id:string)=>`${DRAFT_PREFIX}${id}`;
const store=():Storage|null=>{try{return typeof sessionStorage==='undefined'?null:sessionStorage}catch{return null}};
export function saveDraft(id:string,profile:IcpProfile){try{store()?.setItem(draftKey(id),JSON.stringify(profile))}catch{/* storage unavailable */}}
export function loadDraft(id:string):unknown{try{const v=store()?.getItem(draftKey(id));return v?JSON.parse(v):null}catch{return null}}
export function clearDraft(id:string){try{store()?.removeItem(draftKey(id))}catch{/* storage unavailable */}}
export function clearAllDrafts(){
 try{const s=store();if(!s)return;const keys:string[]=[];for(let i=0;i<s.length;i++){const k=s.key(i);if(k?.startsWith(DRAFT_PREFIX))keys.push(k)}for(const k of keys)s.removeItem(k)}catch{/* storage unavailable */}
 // Drafts kept by an earlier version (localStorage): removed too.
 try{if(typeof localStorage!=='undefined'){const keys:string[]=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(DRAFT_PREFIX))keys.push(k)}for(const k of keys)localStorage.removeItem(k)}}catch{/* storage unavailable */}
}
