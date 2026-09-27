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
// The score line of an ICP proposal card: what it is worth today (always 0 until a human confirms it)
// and what confirming it would add under the ICP's own weight — never a new scoring rule.
export function proposalScoreNote(locale:Locale,weight:number,reviewStatus:string):string{
 if(reviewStatus==='VERIFIED')return locale==='fr'?`Compté dans le score : +${weight} points.`:`Counted in the score: +${weight} points.`;
 if(reviewStatus==='CONTRADICTED')return locale==='fr'?'Contredit : aucun point.':'Contradicted: no points.';
 return locale==='fr'?`0 point tant que vous ne l’avez pas confirmé. Après confirmation : +${weight} points.`:`0 points until you confirm it. Once confirmed: +${weight} points.`;
}
// Discovery history cards: when a run was started (the viewer's own clock) and what came out of it.
export function runDateLabel(locale:Locale,iso:string):string{
 const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
 const f=new Intl.DateTimeFormat(locale==='fr'?'fr-FR':'en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
 const t=new Intl.DateTimeFormat(locale==='fr'?'fr-FR':'en-GB',{hour:'2-digit',minute:'2-digit'}).format(d);
 return `${f} — ${t}`;
}
export function runCountsLabel(locale:Locale,results:number,accepted:number,ignored:number):string{
 if(locale==='fr')return [`${results} résultat${results>1?'s':''}`,accepted?`${accepted} ajouté${accepted>1?'s':''} au projet`:'',ignored?`${ignored} ignoré${ignored>1?'s':''}`:''].filter(Boolean).join(' · ');
 return [`${results} result${results===1?'':'s'}`,accepted?`${accepted} added to the project`:'',ignored?`${ignored} ignored`:''].filter(Boolean).join(' · ');
}
// "20 résultats · 1 ajouté · 1 ignoré · 5 non résolus ou écartés" — the one-line summary above the results.
export function resultsSummaryLabel(locale:Locale,total:number,added:number,ignored:number,unresolved:number):string{
 if(locale==='fr')return [`${total} résultat${total>1?'s':''}`,`${added} ajouté${added>1?'s':''}`,`${ignored} ignoré${ignored>1?'s':''}`,`${unresolved} non résolu${unresolved>1?'s':''} ou écarté${unresolved>1?'s':''}`].join(' · ');
 return [`${total} result${total===1?'':'s'}`,`${added} added`,`${ignored} ignored`,`${unresolved} unresolved or set aside`].join(' · ');
}

// Novelty (V2 P0-C): "7 nouveaux · 6 déjà vus · 4 déjà ajoutés · 3 ignorés" — zero parts are left out,
// except the new ones (0 nouveau is the information of a saturated market).
type NoveltyTotals={new_results:number;seen_results:number;already_added:number;ignored_results:number};
export function noveltySummaryLabel(locale:Locale,c:NoveltyTotals):string{
 const pl=(n:number,one:string,many:string)=>`${n} ${n>1?many:one}`;
 if(locale==='fr')return [pl(c.new_results,'nouveau','nouveaux'),c.seen_results?pl(c.seen_results,'déjà vu','déjà vus'):'',c.already_added?pl(c.already_added,'déjà ajouté','déjà ajoutés'):'',c.ignored_results?pl(c.ignored_results,'ignoré','ignorés'):''].filter(Boolean).join(' · ');
 return [`${c.new_results} new`,c.seen_results?`${c.seen_results} seen before`:'',c.already_added?`${c.already_added} already added`:'',c.ignored_results?`${c.ignored_results} ignored`:''].filter(Boolean).join(' · ');
}
// History row: "7 nouveaux · 6 déjà vus" — the two numbers that tell whether a market still yields new actors.
export function runNoveltyLabel(locale:Locale,c:NoveltyTotals):string{
 const seen=c.seen_results+c.already_added+c.ignored_results;
 if(locale==='fr')return `${c.new_results} nouveau${c.new_results>1?'x':''} · ${seen} déjà vu${seen>1?'s':''}`;
 return `${c.new_results} new · ${seen} seen before`;
}

// Search-Until-New (search-until-new.ts): why a deep search stopped, in plain words — never hidden.
export function deepStopLabel(locale:Locale,stop:string,found:number):string{
 const fr:Record<string,string>={TARGET_REACHED:`Objectif atteint : ${newActorsFoundLabel('fr',found)}`,NO_NEW_RESULTS:'Arrêt : aucun nouveau résultat supplémentaire',MAX_PROVIDER_CALLS:'Arrêt : limite de recherche atteinte',NO_MORE_VARIANTS:'Arrêt : plus de variante de recherche disponible',TIME_BUDGET:'Arrêt : budget temps atteint',PROVIDER_ERROR:'Arrêt : erreur fournisseur après résultats partiels'};
 const en:Record<string,string>={TARGET_REACHED:`Target reached: ${newActorsFoundLabel('en',found)}`,NO_NEW_RESULTS:'Stopped: no further new result',MAX_PROVIDER_CALLS:'Stopped: search limit reached',NO_MORE_VARIANTS:'Stopped: no other search variant available',TIME_BUDGET:'Stopped: time budget reached',PROVIDER_ERROR:'Stopped: provider error after partial results'};
 return (locale==='fr'?fr:en)[stop]??stop;
}
// Exploitable new actors only (COMPANY_CANDIDATE classified NEW) — the run's final count, never raw pages.
export function newActorsFoundLabel(locale:Locale,n:number):string{
 if(locale==='fr')return n===0?'aucun nouvel acteur trouvé':n===1?'1 nouvel acteur trouvé':`${n} nouveaux acteurs trouvés`;
 return n===0?'no new actor found':`${n} new actor${n===1?'':'s'} found`;
}
export function passesLabel(locale:Locale,n:number):string{return locale==='fr'?`${n} passe${n>1?'s':''} de recherche`:`${n} search pass${n===1?'':'es'}`}
// One pass: the provider results it returned and the exploitable new actors it brought (not cumulative).
export function deepPassLine(locale:Locale,index:number,results:number,newTotal:number,ms:number):string{
 const s=(ms/1000).toLocaleString(locale==='fr'?'fr-FR':'en-GB',{maximumFractionDigits:1});
 return locale==='fr'?`Passe ${index} : ${results} résultat${results>1?'s':''} · ${newTotal} nouvel${newTotal>1?'s':''} acteur${newTotal>1?'s':''} exploitable${newTotal>1?'s':''} · ${s} s`:`Pass ${index}: ${results} result${results===1?'':'s'} · ${newTotal} new exploitable actor${newTotal===1?'':'s'} · ${s} s`;
}
