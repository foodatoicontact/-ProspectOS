// Notification centre — /api/v1/notifications (migration 044). Runs as the signed-in user: the notifications are read from
// the veille dédiée journal under its own RLS (a member sees its organizations; the administrator sees every contract),
// the read state from the user's own row. Nothing is copied or computed that the database does not hold.
//   GET  notifications        {items, unread} — the last 90 days, at most 50
//   POST notifications/seen   the centre was opened: everything up to now is read
import type {SupabaseClient} from '@supabase/supabase-js';
import {memberOrganizations} from '../dedicated/api.ts';
import {toNotification,CLIENT_KINDS,ADMIN_KINDS,type JournalEvent,type Notification} from './model.ts';
type Json=(value:unknown,status?:number)=>Response;
export type NotificationDeps={dedicatedEnabled:boolean;admin:boolean;now:()=>Date};
export async function handleNotifications(request:Request,path:string[],db:SupabaseClient,json:Json,deps:NotificationDeps):Promise<Response|null>{
 if(path[0]!=='notifications')return null;
 if(request.method==='POST'&&path[1]==='seen'&&!path[2]){
  // Best effort: a failure only leaves the bell « unread » (e.g. before migration 044 is applied).
  const {error}=await db.rpc('mark_notifications_seen');
  return json({seen:!error});
 }
 if(request.method!=='GET'||path[1])return json({error:'Route ou action non disponible'},404);
 if(!deps.dedicatedEnabled)return json({items:[],unread:0});
 const since=new Date(deps.now().getTime()-90*86400000).toISOString();
 const {data:state}=await db.from('user_notification_state').select('seen_at').maybeSingle();
 const seenAt=(state as {seen_at?:string}|null)?.seen_at??null;
 const orgs=await memberOrganizations(db);
 const read=async(kinds:readonly string[],own:boolean)=>{
  if(own&&!orgs.length)return [] as JournalEvent[];
  let q=db.from('dedicated_journal').select('id,kind,detail,created_at,contract_id,statement_id').in('kind',[...kinds]).gte('created_at',since);
  if(own)q=q.in('organization_id',orgs);
  const {data,error}=await q.order('id',{ascending:false}).limit(50);if(error)throw Error('DATABASE_REQUEST_FAILED');
  return (data??[]) as JournalEvent[];
 };
 const [mine,adminEvents]=await Promise.all([read(CLIENT_KINDS,true),deps.admin?read(ADMIN_KINDS,false):Promise.resolve([] as JournalEvent[])]);
 const contractIds=[...new Set([...mine,...adminEvents].map(e=>e.contract_id))];
 const statementIds=[...new Set(mine.map(e=>e.statement_id).filter((x):x is string=>!!x))];
 const [{data:contracts},{data:statements}]=await Promise.all([
  contractIds.length?db.from('dedicated_contracts').select('id,label,status').in('id',contractIds):Promise.resolve({data:[]}),
  statementIds.length?db.from('dedicated_statements').select('id,validated_at').in('id',statementIds):Promise.resolve({data:[]})]);
 const c=new Map(((contracts??[]) as {id:string;label:string;status:string}[]).map(x=>[x.id,x]));
 const st=new Map(((statements??[]) as {id:string;validated_at:string|null}[]).map(x=>[x.id,x]));
 const items=[...mine.map(e=>toNotification(e,{audience:'client',label:c.get(e.contract_id)?.label??'',seenAt,proposalPending:c.get(e.contract_id)?.status==='PROPOSED',
   statementPending:!!e.statement_id&&st.has(e.statement_id)&&!st.get(e.statement_id)!.validated_at})),
  ...adminEvents.map(e=>toNotification(e,{audience:'admin',label:c.get(e.contract_id)?.label??'',seenAt,proposalPending:false,statementPending:false}))]
  .filter((x):x is Notification=>!!x).sort((a,b)=>a.at<b.at?1:-1).slice(0,50);
 return json({items,unread:items.filter(i=>i.unread).length});
}
