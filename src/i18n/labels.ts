import type {Locale} from './locale.ts';
import {fr} from './fr.ts';
import {en} from './en.ts';
// Display-only mapping for internal enum/status values. The internal value itself (what's persisted,
// sent to the API, or compared in business logic — e.g. prospects.status='Contacté', evidence.status=
// 'VERIFIED') is NEVER renamed or touched anywhere in this module or its callers; only what a human
// reads on screen changes with locale. Every <select>/<option> that uses these keeps `value={original}`
// and only localizes the child text node, so a submitted form/PATCH body is always the original,
// untranslated internal string.
const STATUS_LABELS:Record<string,{fr:string;en:string}>={
 'À analyser':{fr:'À analyser',en:'To analyze'},
 'Qualifié':{fr:'Qualifié',en:'Qualified'},
 'À contacter':{fr:'À contacter',en:'To contact'},
 'Contacté':{fr:'Contacté',en:'Contacted'},
 'Réponse':{fr:'Réponse',en:'Replied'},
 'Gagné':{fr:'Gagné',en:'Won'},
 'Perdu':{fr:'Perdu',en:'Lost'},
};
export function statusLabel(status:string,locale:Locale):string{
 return STATUS_LABELS[status]?.[locale]??status;
}
const EVIDENCE_STATUS_LABELS:Record<string,{fr:string;en:string}>={
 VERIFIED:{fr:'Vérifiée',en:'Verified'},
 NOT_VERIFIED:{fr:'À confirmer',en:'To review'},
 CONTRADICTED:{fr:'Contredite',en:'Contradicted'},
 INFERRED_UNCONFIRMED:{fr:'Supposée',en:'Inferred'},
};
// The demo-only "human declared it" nuance (verified_by==='demo-human') is a presentation detail on
// top of the VERIFIED status, never a distinct internal status value.
export function evidenceStatusLabel(status:string,verifiedBy:string|null|undefined,locale:Locale):string{
 if(status==='VERIFIED'&&verifiedBy==='demo-human')return locale==='fr'?fr['detail.evidenceVerifiedDemo']:en['detail.evidenceVerifiedDemo'];
 return EVIDENCE_STATUS_LABELS[status]?.[locale]??status;
}
const OUTREACH_STATUS_LABELS:Record<string,{fr:string;en:string}>={
 DRAFT:{fr:'BROUILLON',en:'DRAFT'},
 USED:{fr:'UTILISÉ',en:'USED'},
 APPROVED:{fr:'APPROUVÉ',en:'APPROVED'},
 DISCARDED:{fr:'ABANDONNÉ',en:'DISCARDED'},
};
export function outreachStatusLabel(status:string,locale:Locale):string{
 return OUTREACH_STATUS_LABELS[status]?.[locale]??status;
}
// Mirrors the exact branch order ObservationsReview.tsx used before i18n: review_status wins over
// status, and the fallback is "observed, unverified" — never a new precedence rule.
export function observationBadgeLabel(reviewStatus:string,status:string,locale:Locale):string{
 const d=locale==='fr'?fr:en;
 if(reviewStatus==='VERIFIED')return d['evidence.badgeVerified'];
 if(reviewStatus==='CONTRADICTED')return d['evidence.badgeContradicted'];
 if(status==='UNKNOWN')return d['evidence.badgeToReview'];
 if(status==='INFERRED')return d['evidence.badgeInferred'];
 return d['evidence.badgeObservedUnverified'];
}
