import type {StorageLike} from './plan-intent.ts';
// A ProspectOS Pro team invitation link (?invite=…, migration 022) waiting for its account. Kept in THIS browser's
// storage — shared by its tabs, so the tab opened by the e-mail confirmation link finds it and the invitation is
// accepted before any free-trial claim — for at most the invitation's own 7 days. Only a well-formed token is kept;
// anything else is ignored and removed. The token proves nothing by itself: the database still requires the
// account's confirmed e-mail to be the invited one.
export const INVITE_KEY='prospectos-team-invite-v1';
export const INVITE_TTL_MS=7*24*3600*1000;
const isToken=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
export function savePendingInvite(storage:StorageLike|null|undefined,token:unknown,now=Date.now()):boolean{
 if(!storage||!isToken(token))return false;
 try{storage.setItem(INVITE_KEY,JSON.stringify({token,savedAt:now}));return true}catch{return false}
}
export function readPendingInvite(storage:StorageLike|null|undefined,now=Date.now()):string|null{
 if(!storage)return null;
 try{
  const raw=storage.getItem(INVITE_KEY);if(raw===null)return null;
  let v:unknown=null;try{v=JSON.parse(raw)}catch{}
  const ok=v&&typeof v==='object'&&isToken((v as {token?:unknown}).token)&&typeof (v as {savedAt?:unknown}).savedAt==='number'&&now-(v as {savedAt:number}).savedAt<INVITE_TTL_MS;
  if(!ok){storage.removeItem(INVITE_KEY);return null}
  return (v as {token:string}).token;
 }catch{return null}
}
export function clearPendingInvite(storage:StorageLike|null|undefined):void{try{storage?.removeItem(INVITE_KEY)}catch{}}
