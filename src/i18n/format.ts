import type {Locale} from './locale.ts';
// A handful of strings need a value interpolated (a count, a date, a percentage) or a plural form
// that a flat dictionary can't express on its own. Kept here, separate from the static fr.ts/en.ts
// dictionaries, and each function is pure/testable — no ICU library, no runtime cost beyond a
// template literal.
export function trialRemainingLabel(locale:Locale,days:number):string{
 if(locale==='fr')return `Essai gratuit · ${days} jour${days>1?'s':''} restant${days>1?'s':''}`;
 return `Free trial · ${days} day${days===1?'':'s'} left`;
}
export function expiresOnLabel(locale:Locale,dateStr:string):string{
 const date=new Date(dateStr).toLocaleDateString(locale==='fr'?'fr-FR':'en-US');
 return locale==='fr'?`Expire le ${date}`:`Expires on ${date}`;
}
export function configuredEndsWithLabel(locale:Locale,last4:string):string{
 return locale==='fr'?`Configurée · se termine par ${last4}`:`Configured · ends with ${last4}`;
}
export function funnelSampleNote(locale:Locale,n:number):string{
 if(locale==='fr')return `Échantillon de ${n} compte(s) — pourcentages non statistiquement significatifs sur un si petit effectif, à lire uniquement comme un repère de pilotage.`;
 return `Sample of ${n} account(s) — percentages are not statistically significant at this small a size; read them only as a steering indicator.`;
}
export function pctOfSignupsLabel(locale:Locale,pct:number|null):string{
 if(pct===null)return '—';
 return locale==='fr'?`${pct}% des inscrits`:`${pct}% of signups`;
}
export function proposedEvidenceNotice(locale:Locale,count:number):string{
 if(locale==='fr')return `${count} observations proposées. Ouvrez les critères puis vérifiez les sources avant validation.`;
 return `${count} observations suggested. Open the criteria and verify the sources before validating.`;
}
export function searchDoneNote(locale:Locale,count:number,providerNote:string):string{
 return locale==='fr'?`Recherche terminée · ${count} résultats · ${providerNote}`:`Search complete · ${count} results · ${providerNote}`;
}
export function discoveryFoundNote(locale:Locale,confidencePct:number,discoveredSource:string):string{
 if(locale==='fr')return `Trouvé · Confiance de normalisation ${confidencePct} % · ${discoveredSource} · 1 source`;
 return `Found · Normalization confidence ${confidencePct}% · ${discoveredSource} · 1 source`;
}
export function observationMeta(locale:Locale,sourceType:string,dateStr:string,confidencePct:number,expiryStr:string):string{
 const date=new Date(dateStr).toLocaleDateString(locale==='fr'?'fr-FR':'en-US');
 const expiry=new Date(expiryStr).toLocaleDateString(locale==='fr'?'fr-FR':'en-US');
 if(locale==='fr')return `${sourceType} · ${date} · confiance ${confidencePct} % · expire le ${expiry}`;
 return `${sourceType} · ${date} · confidence ${confidencePct}% · expires on ${expiry}`;
}
