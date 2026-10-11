// Public simulator V1 — plain wording for a first-time visitor, with correct singular / plural. Presentation only: every
// number is passed in unchanged (FIT, INTENT, counts come from the view); nothing is computed or rounded here.
import {fr} from '../i18n/fr.ts';
import {en} from '../i18n/en.ts';
import type {HeroView} from '../ux/cockpit-view.ts';

type Locale='fr'|'en';
const t=(locale:Locale,key:keyof typeof fr)=>(locale==='en'?en:fr)[key];
const count=(locale:Locale,n:number,none:keyof typeof fr,one:keyof typeof fr,many:keyof typeof fr)=>n===0?t(locale,none):n===1?t(locale,one):t(locale,many).replace('{n}',String(n));

// "1 source à confirmer · jusqu’à +18 points": the FIT points still to confirm (fitDisplay's toVerify / toVerifyPoints).
export function fitToConfirmLabel(sources:number,points:number,locale:Locale='fr'):string{
 const head=sources===1?t(locale,'sim.fit.toConfirm.one'):t(locale,'sim.fit.toConfirm.many').replace('{n}',String(sources));
 return head.replace('{p}',`${points} ${points===1?t(locale,'sim.points.one'):t(locale,'sim.points.many')}`);
}
const toConfirm=(locale:Locale,n:number)=>n>0?` · ${t(locale,'sim.toConfirm').replace('{n}',String(n))}`:'';
// "2 signaux vérifiés · 1 à confirmer": the reason card's counts (reasonView), as they are.
export function reasonCountsLabel(verified:number,pending:number,locale:Locale='fr'):string{
 return count(locale,verified,'sim.reason.verified.none','sim.reason.verified.one','sim.reason.verified.many')+toConfirm(locale,pending);
}
// "3 preuves vérifiées · 2 à confirmer": the proof lists' sizes, as they are.
export function proofsSummaryLabel(verified:number,pending:number,locale:Locale='fr'):string{
 return count(locale,verified,'sim.proofs.verified.none','sim.proofs.verified.one','sim.proofs.verified.many')+toConfirm(locale,pending);
}
// The compact state of "Pourquoi maintenant ?" (heroView's state): a verified signal, one to confirm, or none.
export function whyStateLabel(state:HeroView['state'],locale:Locale='fr'):string{
 return state==='verified'?t(locale,'sim.why.verified'):state==='to_confirm'?t(locale,'sim.why.toConfirm'):t(locale,'sim.why.none');
}
