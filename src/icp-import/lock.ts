// ICP import — the lock of one import in progress per project (migration 041, start_icp_import): 2 minutes. The route
// stops at 60 s, so a PENDING row older than this is a dead run: every read reports it FAILED (IMPORT_STALE), the next
// start records it so in the database, and it can be erased.
export const IMPORT_LOCK_MS=2*60*1000;
export function isStale(row:{status?:unknown;created_at?:unknown},now:number):boolean{
 return row.status==='PENDING'&&typeof row.created_at==='string'&&now-Date.parse(row.created_at)>=IMPORT_LOCK_MS;
}
