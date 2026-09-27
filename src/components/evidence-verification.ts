// Human review of a proof — interface guards only. Nothing here verifies anything: each helper only decides
// whether a button may be shown or a click may reach the server. The server stays the only writer, and a
// proof is VERIFIED only after an explicit human click, exactly as before.
import type {Evidence} from '../domain/core.ts';
import type {ReviewSummary} from './evidence-presentation.ts';
import type {StoredObservation} from '../discovery/types.ts';

// "J'ai vérifié la source : valider" records the verification as a NEW evidence row (POST /evidence inserts;
// the original row is kept untouched). The original therefore stays NOT_VERIFIED forever: without this guard
// its button stayed visible, and every further click inserted one more VERIFIED copy and one more
// "preuve vérifiée" line in the history. Same criterion, value, source and excerpt = the same proof.
export function sameProof(a:Evidence,b:Evidence):boolean{
 return a.criterion===b.criterion&&a.value===b.value&&a.source_url===b.source_url&&a.excerpt.trim()===b.excerpt.trim();
}
export function hasVerifiedCopy(e:Evidence,all:Evidence[]):boolean{
 return e.status!=='VERIFIED'&&all.some(o=>o.id!==e.id&&o.status==='VERIFIED'&&sameProof(o,e));
}

// The ICP section tells apart evidence linked to an analysis proposal (reviewed with "Confirmer") from
// evidence added by hand (reviewed with "J'ai vérifié la source : valider") through the review summary.
// Until the observations of THIS prospect are loaded, that summary is empty or belongs to the previous
// prospect: analysis evidence then looked "manual" and showed a button the server-side check refuses —
// the click only raised a notice at the top of the page ("the button does nothing", timing dependent).
export function reviewSummaryReady(summary:ReviewSummary,prospectId:string):boolean{
 return summary.ready===true&&summary.prospectId===prospectId;
}

// One click = at most one request per key: a second click on the same proof while the first request is
// still running is ignored. The key is released after success AND after failure (the user can retry).
export function createInFlight(){
 const keys=new Set<string>();
 return {
  has:(key:string)=>keys.has(key),
  async run(key:string,fn:()=>Promise<void>):Promise<boolean>{
   if(keys.has(key))return false;
   keys.add(key);
   try{await fn()}finally{keys.delete(key)}
   return true;
  },
 };
}

// A review decision that would not change the stored state is not sent (the buttons are already disabled in
// that case; this keeps the handler itself idempotent).
export function reviewChangesState(row:Pick<StoredObservation,'review_status'>,decision:'confirm'|'contradict'|'unverify'):boolean{
 return decision==='confirm'?row.review_status!=='VERIFIED':decision==='contradict'?row.review_status!=='CONTRADICTED':row.review_status!=='NOT_VERIFIED';
}
