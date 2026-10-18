// Recherche 2.0 (UI-5B) — presentation only. Turns the facts DiscoveryPanel already computes for a result (factsOf) into
// the words of the v2 card. Nothing is scored, admitted, rejected or invented here:
//  - a result never carries a proof at discovery time: until it is added and documented it is "À documenter";
//  - an added result shows its prospect's FIT in words (Vérifié / Estimé / À documenter), from the existing fitDisplay;
//  - a source that names no company stays "Entreprise non identifiée" — never turned into a signal or a proof.
import type {FitDisplay} from '../../../domain/score-display.ts';
import type {Locale} from '../../../i18n/locale.ts';

export type VerificationKind='verified'|'estimated'|'document'|'unknown';
export type Verification={kind:VerificationKind;label:string;hint:string|null};
type FactsLike={state:'added'|'ignored'|'candidate'|'unresolved';score:FitDisplay|null};

const LABEL:Record<Locale,Record<VerificationKind,string>>={
 fr:{verified:'Vérifié',estimated:'Estimé',document:'À documenter',unknown:'Entreprise non identifiée'},
 en:{verified:'Verified',estimated:'Estimated',document:'To document',unknown:'Company not identified'},
};
export function verificationOf(f:FactsLike,locale:Locale):Verification{
 const fr=locale==='fr';
 if(f.state==='unresolved')return {kind:'unknown',label:LABEL[locale].unknown,hint:fr?'La source ne nomme pas d’entreprise vérifiable.':'The source names no verifiable company.'};
 const s=f.score;
 if(s?.kind==='verified')return {kind:'verified',label:LABEL[locale].verified,hint:null};
 if(s?.kind==='estimated')return {kind:'estimated',label:LABEL[locale].estimated,
  hint:s.toVerify?(fr?`${s.toVerify} source${s.toVerify>1?'s':''} à vérifier`:`${s.toVerify} source${s.toVerify>1?'s':''} to check`):null};
 return {kind:'document',label:LABEL[locale].document,hint:fr?'Aucune preuve vérifiée pour l’instant.':'No verified evidence yet.'};
}
// The numbers, for "Détails avancés" only.
export function scoreText(s:FitDisplay|null,locale:Locale):string|null{
 if(!s)return null;
 if(s.kind==='none')return locale==='fr'?'non établi':'not established';
 return `${s.main}/100${s.kind==='estimated'?(locale==='fr'?' (estimé)':' (estimated)'):''}`;
}

// The same review-priority reasons (src/discovery/review-priority.ts), said short for the card face. No reason is added,
// dropped or reordered; the full sentences stay in "Détails avancés".
import type {ReviewPriorityReason,ReviewPriorityLevel} from '../../../discovery/review-priority.ts';
export const SHORT_REASON:Record<Locale,Record<ReviewPriorityReason,string>>={
 fr:{official_site:'Site officiel identifié',named_by_third_party:'Citée par une source tierce',website_identified:'site identifié',query_terms_observed:'activité cohérente',
  single_query_term:'un seul terme observé',no_specific_query_term:'activité non confirmée',public_registry:'Registre public (SIREN)',registry_activity_code:'code NAF déclaré',
  location_mentioned:'zone mentionnée',several_sources:'plusieurs sources',business_site_shape:'page d’entreprise',job_ad_source:'via une offre d’emploi',
  content_source:'via un article',listing_or_editorial_shape:'page liste ou article',not_a_company_candidate:'pas une entreprise exploitable',
  cooperative_or_network:'coopérative ou réseau',public_body:'acteur public'},
 en:{official_site:'Official website found',named_by_third_party:'Named by a third-party source',website_identified:'website found',query_terms_observed:'matching activity',
  single_query_term:'one search term seen',no_specific_query_term:'activity not confirmed',public_registry:'Public registry (SIREN)',registry_activity_code:'NAF code declared',
  location_mentioned:'area mentioned',several_sources:'several sources',business_site_shape:'company page',job_ad_source:'via a job ad',
  content_source:'via an article',listing_or_editorial_shape:'list or article page',not_a_company_candidate:'not a usable company',
  cooperative_or_network:'cooperative or network',public_body:'public body'},
};
export function shortReasons(reasons:readonly ReviewPriorityReason[],locale:Locale,max=3):string{
 const list=reasons.slice(0,max).map(r=>SHORT_REASON[locale][r]);
 return list.length?list.join(' · '):'';
}
export function priorityChip(level:ReviewPriorityLevel,locale:Locale):string{
 const fr={HIGH:'Priorité élevée',MEDIUM:'Priorité moyenne',LOW:'Priorité faible'},en={HIGH:'High priority',MEDIUM:'Medium priority',LOW:'Low priority'};
 return (locale==='fr'?fr:en)[level];
}
