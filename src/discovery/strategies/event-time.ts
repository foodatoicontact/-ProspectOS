// When did the event a sentence reports happen — read from the sentence itself, never from the moment the page
// was collected. A page collected today can describe a recruitment of 2021: collected_at says when ProspectOS read
// it, the date written next to the event says when it happened. Nothing is ever guessed: no date written → unknown.
//
// Only an EVENT signal is concerned (a recruitment, an opening, an incident…): a headcount or a reference stays
// a fact whatever its age (see icp-intents.ts, pastIsProof).
const MONTHS=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’`]/g,"'");
const QUANTITY=/^\s*(?:salaries|employes|personnes|collaborateurs|clients|sites|magasins|points|eur|euros|€|k€|m€|m2|m²|km|tonnes|t |litres|unites|references|produits|%)/;
const SINCE=/(?:depuis(?: plus de)?|fondee? en|creee? en|nee? en|ne en|des) ?$/;
export type EventDate={year:number;month:number|null;text:string};
// The most recent date written in the sentence ("Mars 2021", "03/2021", "12/03/2021", "en 2020"), or null.
export function eventDateIn(line:string):EventDate|null{
 const n=fold(line);const found:EventDate[]=[];const keep=(d:EventDate)=>{found.push(d)};
 for(const m of n.matchAll(new RegExp(`(?:^|[^a-z])(${MONTHS.join('|')})\\s+((?:19|20)\\d{2})(?![0-9])`,'g')))keep({year:Number(m[2]),month:MONTHS.indexOf(m[1]!)+1,text:`${m[1]} ${m[2]}`});
 for(const m of n.matchAll(/(?:^|[^0-9])(?:\d{1,2}[/.-])?(0?[1-9]|1[0-2])[/.-]((?:19|20)\d{2})(?![0-9])/g))keep({year:Number(m[2]),month:Number(m[1]),text:m[0].replace(/^[^0-9]/,'')});
 // A bare year, unless it is a quantity ("2000 salariés") or a founding/start date ("depuis 1952", "fondée en 1990").
 for(const m of n.matchAll(/(?:^|[^0-9/.-])((?:19|20)\d{2})(?![0-9/])/g)){
  const after=n.slice((m.index??0)+m[0].length),before=n.slice(Math.max(0,(m.index??0)-24),(m.index??0)+m[0].length-4);
  if(QUANTITY.test(after)||SINCE.test(before))continue;
  keep({year:Number(m[1]),month:null,text:m[1]!});
 }
 // The latest date written; at equal year, the one that also gives the month.
 return found.reduce<EventDate|null>((best,d)=>!best||d.year>best.year||(d.year===best.year&&(d.month??0)>(best.month??0))?d:best,null);
}
// Historical: even the LATEST moment the written date allows (end of that month, or of that year) is more than
// HISTORICAL_AFTER_DAYS before the collection — an approximate date is never pushed back to make it look old.
export const HISTORICAL_AFTER_DAYS=365;
export function isHistorical(date:EventDate,collectedAt:Date):boolean{
 const latest=date.month?Date.UTC(date.year,date.month,1)-1:Date.UTC(date.year+1,0,1)-1;
 return collectedAt.getTime()-latest>HISTORICAL_AFTER_DAYS*86400000;
}
// The sentence says the event is over ("aujourd'hui résolu", "poste pourvu") — never a current need, whatever
// its date. A negation ("jamais", "aucun", "pas de") only counts right before the signal itself (negatedBefore):
// "pas de frais de service, commande à emporter disponible" does not negate "commande à emporter".
const RESOLVED=/(?:^|[^a-z])(?:resolue?s?|reglee?s?|corrigee?s?|terminee?s?|clos|close|cloturee?s?|pourvue?s?|maitrisee?s?)(?=[^a-z]|$)/;
const NEGATED=/(?:^|[^a-z])(?:jamais|aucun|aucune|plus de|n'avons pas|n'a pas|n'ont pas|pas de|pas d'|sans)(?=[^a-z]|$)/;
export const isResolved=(line:string)=>RESOLVED.test(fold(line));
export function negatedBefore(line:string,term:string):boolean{
 const n=fold(line),first=fold(term).split(/[^a-z0-9]+/).find(w=>w.length>=3);if(!first)return false;
 const at=n.search(new RegExp(`(?:^|[^a-z0-9])${first.slice(0,6)}`));if(at<0)return false;
 // The negation, then at most two words of the same clause ('jamais subi d'…', 'pas de …'), then the signal.
 return new RegExp(`${NEGATED.source}(?:\\s+[^\\s,;.:!?]+){0,2}\\s*$`).test(n.slice(0,at+1).replace(/[^a-z0-9']$/,''));
}
// How the date reads to a human, for a claim.
export const eventDateLabel=(d:EventDate|null)=>d?`date de l’événement : ${d.text}`:'date de l’événement non publiée';
