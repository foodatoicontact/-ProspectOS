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
