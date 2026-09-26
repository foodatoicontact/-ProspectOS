import {createHash} from 'node:crypto';
import type {Observation} from '../types.ts';
import type {Criterion} from '../../domain/core.ts';
import type {ObservationContext} from './restaurant.ts';
// ICP evidence mapping: links an explicit sentence of a page to ONE criterion of the project's own ICP,
// as a PROPOSAL only. Sector-agnostic by construction:
//  - a concept is activated by the criterion's LABEL written by the user (never by a key, a project name,
//    a customer or a vertical). A label that names none of these concepts gets no proposal from here;
//  - a concept fires only on an explicit, deterministic pattern of the page (a count followed by a unit
//    the label itself names, an opening-hours range, the word "créneau" with a duration…) — never on a
//    lone keyword, never through an LLM, a similarity score or a synonym the label does not carry;
//  - a line carrying a negation is ambiguous and never proposed: the criterion stays "À confirmer".
// Every proposal is status INFERRED with value true: save_discovery_observations stores its evidence as
// INFERRED_UNCONFIRMED, which scoreProspect never counts. Only a human confirmation through
// review_discovery_observation turns it VERIFIED — the existing, unchanged workflow and scoring engine.
const norm=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’`]/g,"'").replace(/\s+/g,' ').trim();

// Countable units a label can name. Only the groups whose words appear in the criterion's own label are
// looked for on the page ("multi-terrains / multi-espaces" -> terrains and espaces, nothing else).
// "poste" / "bureau" are deliberately absent: a count of them is as often job openings as capacity.
const UNIT_GROUPS:{words:string[]}[]=[
 {words:['terrain','court','piste']},
 {words:['salle','espace','studio']},
 {words:['site','agence','etablissement','magasin','boutique','implantation','point de vente']},
 {words:['chambre','lit','logement']},
];
const NUMBER_WORDS:Record<string,number>={deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8,neuf:9,dix:10,onze:11,douze:12,quinze:15,vingt:20,two:2,three:3,four:4,five:5,seven:7,eight:8,nine:9,ten:10};
const NUMBER=`(\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})`;
const toNumber=(s:string)=>/^\d+$/.test(s)?Number(s):NUMBER_WORDS[s]??0;
const unitPlural=(w:string)=>w.split(' ').map((p,i,a)=>i===0||a.length===1?`${p}s?`:p).join(' ');

// A line is ambiguous when it negates something ("pas de", "sans", "aucun"…). The courtesy formula
// "n'hésitez pas" is not a negation of the facts it introduces.
const NEGATION=/(^|[^a-z])(pas|aucun|aucune|jamais|sans|ni|ne|n'|no|not|without)([^a-z]|$)/;
const isNegated=(n:string)=>NEGATION.test(n.replace(/n'hesitez pas|n'hesite pas/g,' '));

// `label` is always the NORMALIZED label (see norm); `reason` is the human explanation of what was seen.
type Proposal={line:string;reason:string;confidence:number};
// Each line is given with its normalized form, computed once per page (see normalizedLines).
type Line={raw:string;n:string};
type Concept={id:string;applies(label:string):boolean;detect(lines:Line[],label:string):Proposal|null};

function unitGroupsOf(label:string){return UNIT_GROUPS.filter(g=>g.words.some(w=>new RegExp(`(^|[^a-z])${unitPlural(w)}([^a-z]|$)`).test(label)))}

// 1. Multi-unit capacity: "Capacité multi-terrains / multi-espaces", "Plusieurs sites"…
const multiUnit:Concept={
 id:'MULTI_UNIT_CAPACITY',
 applies:label=>/(^|[^a-z])(multi|plusieurs|capacite|nombre de|several|multiple)/.test(label)&&unitGroupsOf(label).length>0,
 detect(lines,label){
  const unitWords=unitGroupsOf(label).flatMap(g=>g.words).map(unitPlural).join('|');
  const pattern=new RegExp(`(^|[^a-z0-9])${NUMBER}\\s+(?:[a-z-]+\\s+){0,2}?(${unitWords})(?=[^a-z]|$)`,'g');
  for(const {raw:line,n} of lines){
   let total=0;const units=new Set<string>();
   for(const m of n.matchAll(pattern)){const v=toNumber(m[2]);if(v>0&&v<=500){total+=v;units.add(m[3].replace(/s(?= |$)/,''))}}
   if(total<2||isNegated(n))continue;
   const plural=(u:string)=>/[sx]$/.test(u)?u:u.replace(/^(\S+)/,'$1s');
   return {line,reason:`Le site mentionne ${total} ${[...units].map(plural).join(' / ')} au total dans cet extrait`,confidence:.6};
  }
  return null;
 },
};

// 2. Extended opening hours: an explicit time range of at least 12 hours ("de 7h30 à 00h"), or 24h/24.
const HOURS_RANGE=/(?:^|[^0-9])([01]?\d|2[0-4])\s*(?:h|:)\s*([0-5]\d)?\s*(?:-|–|—|a|au|jusqu'a|jusqu'au|to)\s*([01]?\d|2[0-4])\s*(?:h|:)\s*([0-5]\d)?/g;
function longestRange(n:string):number{
 let best=0;
 for(const m of n.matchAll(HOURS_RANGE)){
  const start=Number(m[1])+Number(m[2]??0)/60;let end=Number(m[3])+Number(m[4]??0)/60;
  if(end<=start)end+=24; // "7h30 à 00h", "18h à 2h": the range ends after midnight
  const span=end-start;if(span>0&&span<=24)best=Math.max(best,span);
 }
 return best;
}
const extendedHours:Concept={
 id:'EXTENDED_OPENING_HOURS',
 // Days of opening ("7j/7") are another concept: a range of hours says nothing about them.
 applies:label=>/(^|[^a-z])(amplitude|horaires?|heures? d'ouverture|ouvert\w* (?:tard|tot|le soir|en soiree|jusqu)|nocturnes?|24 ?h|24 ?\/ ?24|opening hours|late opening)([^a-z]|$)/.test(label),
 detect(lines){
  for(const {raw:line,n} of lines){
   const span=longestRange(n);const allDay=/24 ?h ?\/ ?24|24 ?\/ ?24|24 ?h sur 24|ouvert 24/.test(n);
   if((span<12&&!allDay)||isNegated(n))continue;
   const everyDay=/tous les jours|7 ?j ?\/ ?7|7 ?\/ ?7|7 jours sur 7|every day/.test(n);
   const spanText=allDay?'24 h sur 24':`${Number.isInteger(span)?span:span.toFixed(1).replace('.',',')} h par jour`;
   return {line,reason:`Plage horaire explicite de ${spanText}${everyDay?', tous les jours':''}`,confidence:.6};
  }
  return null;
 },
};

// 3. Slot / hourly booking: the word "créneau" with a duration, or a booking offered by the hour.
const slotBooking:Concept={
 id:'SLOT_BOOKING',
 applies:label=>/(^|[^a-z])(creneaux?|a l'heure|par heure|a la demi-heure|time slots?|hourly)([^a-z]|$)/.test(label),
 detect(lines){
  for(const {raw:line,n} of lines){
   const slotWithDuration=/creneaux?\s+(?:de\s+|d'une?\s+)?(\d{1,2}\s*h\s*\d{0,2}|\d{1,3}\s*min|une heure|\d\s*heures?)/.test(n);
   const bookingByHour=/reserv\w*.{0,60}(creneaux?|a l'heure|par heure|de l'heure)|(creneaux?|a l'heure|par heure).{0,60}reserv\w*/.test(n);
   if(!(slotWithDuration||bookingByHour)||isNegated(n))continue;
   return {line,reason:slotWithDuration?'Le site mentionne des créneaux de durée définie':'Le site mentionne une réservation par créneau ou à l’heure',confidence:.55};
  }
  return null;
 },
};

// 4. Group / company / event offers. Each sub-vocabulary is looked for only when the label names it.
const OFFER_VOCABULARIES:{trigger:RegExp;pattern:RegExp;display:string}[]=[
 {trigger:/(^|[^a-z])(entreprises?|seminaires?|team ?building|corporate|comites? d'entreprise|b2b|professionnels?)([^a-z]|$)/,pattern:/seminaires?|team[ -]?building|(evenements?|soirees?|tournois?|offres?|tarifs?|formules?) (d'|d |pour les |pour )?entreprises?|comites? d'entreprise|afterworks?|offres? pro(fessionnelle)?s?/,display:'une offre entreprises'},
 {trigger:/(^|[^a-z])(groupes?|collectivites?)([^a-z]|$)/,pattern:/(offres?|tarifs?|formules?|accueil|reservations?|forfaits?) (de |pour |pour les |des )?groupes?|groupes? (de |d')?\d+|a partir de \d+ (personnes|joueurs|participants)/,display:'une offre groupes'},
 {trigger:/(^|[^a-z])(evenements?|evenementiel|privatisations?|anniversaires?|soirees?)([^a-z]|$)/,pattern:/privatis\w*|anniversaires?|evenements? (prives?|d'entreprise|sur mesure)|soirees? privees?|organis\w* (de |d'|votre |vos |un |une |des )?(evenement|soiree|anniversaire|tournoi)|enterrements? de vie/,display:'une offre événements'},
];
const groupOffers:Concept={
 id:'GROUP_EVENT_OFFERS',
 applies:label=>OFFER_VOCABULARIES.some(v=>v.trigger.test(label))&&/(^|[^a-z])(offres?|formules?|accueil|organisation|tarifs?|evenements?|privatisations?|seminaires?)([^a-z]|$)/.test(label),
 detect(lines,label){
  const active=OFFER_VOCABULARIES.filter(v=>v.trigger.test(label));
  for(const {raw:line,n} of lines){
   const hits=active.filter(v=>v.pattern.test(n));
   if(!hits.length||isNegated(n))continue;
   return {line,reason:`Le site mentionne ${hits.map(h=>h.display).join(' et ')}`,confidence:.55};
  }
  return null;
 },
};

// 5. Bookable physical facility: a booking/rental verb and a facility noun in the same sentence.
const FACILITY=/(^|[^a-z])(terrains?|courts?|pistes?|salles?|espaces?|studios?|installations?|equipements?|infrastructures?|locaux|local|lieux?)([^a-z]|$)/;
const bookableFacility:Concept={
 id:'BOOKABLE_FACILITY',
 applies:label=>/(^|[^a-z])(reservables?|a reserver|a louer|location|bookable|rentable)([^a-z]|$)/.test(label)&&FACILITY.test(label),
 detect(lines){
  for(const {raw:line,n} of lines){
   if(!(/(^|[^a-z])(reserv\w*|lou(ez|er|ons)|location|book\w*)([^a-z]|$)/.test(n)&&FACILITY.test(n))||isNegated(n))continue;
   return {line,reason:'Le site propose de réserver ou de louer un lieu ou un équipement',confidence:.55};
  }
  return null;
 },
};

export const ICP_CONCEPTS:Concept[]=[multiUnit,extendedHours,slotBooking,groupOffers,bookableFacility];
export const ICP_SIGNAL_PREFIX='ICP_SIGNAL:';
// One observation type per criterion, so that the proposals of one page (and one sentence proposed for
// two criteria) never share the (source_url, observation_type, content_hash) key and each stays
// separately reviewable. Bounded to the 60 characters the schema and the RPC accept.
export function icpSignalType(key:string):string{
 const t=ICP_SIGNAL_PREFIX+key;
 return t.length<=60?t:ICP_SIGNAL_PREFIX+createHash('sha256').update(key).digest('hex').slice(0,40);
}
// The dedup key of a proposal is its own sentence, not the whole page: a re-analysis of a page whose other
// content changed finds the SAME row (updated in place, or left untouched once a human reviewed it)
// instead of piling up a new proposal for an identical sentence.
export const icpSignalHash=(excerpt:string)=>createHash('sha256').update('icp-signal:v1\n'+norm(excerpt)).digest('hex');

export function conceptsForLabel(label:string):Concept[]{const l=norm(label);return ICP_CONCEPTS.filter(c=>c.applies(l))}

// Returns at most one proposal per criterion (the first concept of its label that fires, first matching
// sentence), for the criteria it is given. A criterion whose label names no concept gets nothing here.
const NORMALIZED=new WeakMap<string[],Line[]>();
function normalizedLines(lines:string[]):Line[]{let l=NORMALIZED.get(lines);if(!l){l=lines.map(raw=>({raw,n:norm(raw)}));NORMALIZED.set(lines,l)}return l}
export function extractIcpConceptProposals(ctx:ObservationContext,criteria:Criterion[]):Observation[]{
 const out:Observation[]=[];const lines=normalizedLines(ctx.lines);
 for(const criterion of criteria){
  for(const concept of conceptsForLabel(criterion.label)){
   const p=concept.detect(lines,norm(criterion.label));
   if(!p)continue;
   const excerpt=p.line.slice(0,500);
   const claim=`${p.reason} : cela peut correspondre au critère « ${criterion.label.trim()} ». Proposition à confirmer par un humain.`;
   out.push({...ctx.make(criterion.key,icpSignalType(criterion.key),excerpt,true,'INFERRED',claim.slice(0,1000),p.confidence),content_hash:icpSignalHash(excerpt)});
   break;
  }
 }
 return out;
}
