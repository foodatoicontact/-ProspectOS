// Signal-first Discovery V1, step 1: the search plan. It finds PAGES that may announce a business event
// (new_site, expansion) in a zone, before any prospect exists. Deterministic, no model, no network, no clock read:
// `now` is always passed in.
//
// The phrases below ("ouverture prochaine", "s'implante à"…) are SEARCH WORDS ONLY. A page found with them proves
// nothing: what counts is the sentence extract.ts reads in the result itself, and then a human review. A search
// query is never evidence, never a signal, never a point of score.
//
// Budget: at most 3 provider requests per run, the same ceiling as company Discovery (search-until-new.ts).
// Window: results published in the last 180 days (freshness), the max age of new_site / expansion (intent.ts DECAY).
import {DEPARTMENTS,foldPlace,locationTarget} from '../discovery/geo-fr.ts';
import type {SignalType} from '../signals/types.ts';

export const SIGNAL_DISCOVERY_TYPES=['new_site','expansion'] as const satisfies readonly SignalType[];
export type SignalDiscoveryType=typeof SIGNAL_DISCOVERY_TYPES[number];
export const MAX_SIGNAL_QUERIES=3;
export const FRESHNESS_DAYS=180;
export const MAX_RESULTS_CEILING=50;
// Brave refuses a query over 400 characters or 50 words; we stay well under both.
export const MAX_QUERY_CHARS=380;
export const MAX_QUERY_WORDS=45;
const MAX_SUBJECTS=4;

// Discovery phrases per event type (folded spelling is not needed: the search engine folds accents itself).
export const EVENT_PHRASES:Record<SignalDiscoveryType,readonly string[]>={
 new_site:['ouverture prochaine','nouvelle ouverture','nouveau restaurant','nouveau point de vente','ouvrira','ouverture prévue','s\'implante à','arrive à'],
 expansion:['deuxième établissement','nouvelle implantation','poursuit son développement'],
};

// The two main cities of each metropolitan region (regional capital first), used to reach local news when the zone
// is a whole region. Public facts, never a guess about where a company is.
const REGION_CITIES:Record<string,readonly string[]>={
 'Auvergne-Rhône-Alpes':['Lyon','Grenoble'],'Bourgogne-Franche-Comté':['Dijon','Besançon'],'Bretagne':['Rennes','Brest'],
 'Centre-Val de Loire':['Orléans','Tours'],'Corse':['Ajaccio','Bastia'],'Grand Est':['Strasbourg','Metz'],'Hauts-de-France':['Lille','Amiens'],
 'Île-de-France':['Paris'],'Normandie':['Rouen','Caen'],'Nouvelle-Aquitaine':['Bordeaux','Limoges'],'Occitanie':['Toulouse','Montpellier'],
 'Pays de la Loire':['Nantes','Angers'],'Provence-Alpes-Côte d’Azur':['Marseille','Nice'],
};

export type SignalQuery={q:string;signal_types:SignalDiscoveryType[];zone:string;purpose:'zone'|'cities'|'expansion'};
export type SignalQueryPlan={
 queries:SignalQuery[];
 subjects:string[];
 zone:{label:string;cities:string[]};
 // Brave's `freshness` parameter: a closed date range ending today (UTC).
 freshness:string;
 window:{from:string;to:string;days:number};
 max_results:number;
};
export type SignalPlanInput={subjects:string[];location:string;signal_types?:readonly string[];max_results?:number;now:Date};

const day=(d:Date)=>d.toISOString().slice(0,10);
const quote=(s:string)=>/\s|'/.test(s)?`"${s.replace(/"/g,'')}"`:s;
const anyOf=(terms:readonly string[])=>terms.map(quote).join(' OR ');
const clean=(s:string)=>s.replace(/["()]/g,' ').replace(/\s+/g,' ').trim();

// The zone as the user typed it, plus the cities used to reach local news. A whole region ("Occitanie") → its two
// main cities; a city or department → what was typed, nothing added.
function zoneOf(location:string):{label:string;cities:string[]}{
 const label=clean(location).split(' ').slice(0,5).join(' ');
 const target=locationTarget(location);
 const regionOnly=target.places.regions.size===1&&target.places.departments.size===0;
 if(regionOnly){const region=[...target.places.regions][0]!;return {label,cities:[...(REGION_CITIES[region]??[])]}}
 const cities=target.cityTokens.map(t=>DEPARTMENTS.find(d=>foldPlace(d.prefecture)===t)?.prefecture??location.split(/,|\bet\b/i).map(p=>p.trim()).find(p=>foldPlace(p).startsWith(t))??t);
 return {label,cities:[...new Set(cities)].slice(0,2)};
}

// Subjects: the activities the user prospects (project query words, ICP categories), deduplicated, at most 4.
function subjectsOf(raw:string[]):string[]{
 const seen=new Set<string>();const out:string[]=[];
 for(const s of raw.map(clean).filter(s=>s.length>=3&&s.split(' ').length<=4)){const k=foldPlace(s);if(seen.has(k))continue;seen.add(k);out.push(s)}
 return out.slice(0,MAX_SUBJECTS);
}
function fit(q:string):string{
 let words=q.split(' ');
 while(words.length>MAX_QUERY_WORDS||words.join(' ').length>MAX_QUERY_CHARS)words=words.slice(0,-1);
 // Never end on a dangling operator.
 while(words.length&&words[words.length-1]==='OR')words=words.slice(0,-1);
 return words.join(' ');
}

export function planSignalQueries(input:SignalPlanInput):SignalQueryPlan{
 const requested=(input.signal_types??SIGNAL_DISCOVERY_TYPES).filter((t):t is SignalDiscoveryType=>(SIGNAL_DISCOVERY_TYPES as readonly string[]).includes(t));
 const types=requested.length?[...new Set(requested)]:[...SIGNAL_DISCOVERY_TYPES];
 const subjects=subjectsOf(input.subjects);
 const zone=zoneOf(input.location);
 const subjectPart=subjects.length?anyOf(subjects):'';
 const queries:SignalQuery[]=[];
 const add=(q:SignalQuery)=>{const text=fit(q.q.replace(/\s+/g,' ').trim());if(text&&!queries.some(x=>x.q===text))queries.push({...q,q:text})};
 if(types.includes('new_site')){
  const opening=EVENT_PHRASES.new_site;
  add({q:`${subjectPart} ${anyOf(opening.slice(0,5))} ${zone.label}`,signal_types:['new_site'],zone:zone.label,purpose:'zone'});
  if(zone.cities.length)add({q:`${subjectPart} ${anyOf(opening.slice(4))} ${anyOf(zone.cities)}`,signal_types:['new_site'],zone:zone.cities.join(', '),purpose:'cities'});
 }
 if(types.includes('expansion'))add({q:`${subjectPart} ${anyOf(EVENT_PHRASES.expansion)} ${zone.label}`,signal_types:['expansion'],zone:zone.label,purpose:'expansion'});
 const to=day(input.now),from=day(new Date(input.now.getTime()-FRESHNESS_DAYS*86400000));
 const max=Math.max(1,Math.min(MAX_RESULTS_CEILING,Math.floor(input.max_results??20)));
 return {queries:queries.slice(0,MAX_SIGNAL_QUERIES),subjects,zone,freshness:`${from}to${to}`,window:{from,to,days:FRESHNESS_DAYS},max_results:max};
}
