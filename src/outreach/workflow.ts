// Outreach workflow (O1): GENERATE → DRAFT → (SAVE)* → APPROVED → COPY → USED, or DISCARDED. A person approves the text
// before it can be copied; an approved text is locked (database: migration 027). Copying a message marks it USED and
// never changes the prospect's status — "Contacté" stays a separate human decision.
export const OUTREACH_TRANSITIONS={SAVE:['DRAFT'],APPROVED:['DRAFT'],USED:['APPROVED'],DISCARDED:['DRAFT','APPROVED']} as const;
export type OutreachAction=keyof typeof OUTREACH_TRANSITIONS;
export const isOutreachAction=(v:unknown):v is OutreachAction=>typeof v==='string'&&Object.hasOwn(OUTREACH_TRANSITIONS,v);
// The statuses a message must currently have for this action to apply.
export const allowedFrom=(action:OutreachAction):string[]=>[...OUTREACH_TRANSITIONS[action]];
// Only saving and approving may carry a new text.
export const carriesContent=(action:OutreachAction)=>action==='SAVE'||action==='APPROVED';
// Migration 029: approving or copying a message whose cited public content or signal is no longer VERIFIED is refused by
// the database (token outreach_source_not_verified). The API answers 409 with this code and sentence; the message is left
// as it was — never regenerated, and no source is re-verified on the user's behalf.
export const SOURCE_NOT_VERIFIED={code:'OUTREACH_SOURCE_NOT_VERIFIED',error:'Une source utilisée par ce message n’est plus vérifiée. Régénérez le message avant de l’approuver ou de le copier.'} as const;
export const isSourceNotVerified=(e:unknown):boolean=>/\boutreach_source_not_verified\b/.test(String((e as {message?:unknown}|null|undefined)?.message??''));
