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
