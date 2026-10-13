// Signal-first Discovery V1, step 2: one search result → at most one candidate EVENT (new_site or expansion), or a
// rejection with its reason. Deterministic, no model, no network, no clock read (`now` is always passed in).
//
// What a search result is: a title, a snippet and a URL returned by the search engine. The page itself is NOT read
// in V1. So every excerpt below is attributed to the SEARCH RESULT (source_type = search_snippet), never presented as
// something observed on the page: "found ≠ observed ≠ supposed ≠ verified".
//
// Rules (docs: the Signal-first Discovery V1 plan):
// - the event must be written in ONE sentence of the result (title or snippet): an opening/implantation verb or noun
//   tied to an ESTABLISHMENT (restaurant, point de vente, établissement, site…) or to a named place. A word alone
//   ("ouverture", "expansion", "développement") never suffices;
// - "ouverture des inscriptions / de la billetterie / d'un recrutement / horaires d'ouverture…" is never NEW_SITE;
// - an expansion of a range, an offer, an audience or a service is never EXPANSION: only a physical or
//   organizational one (a second establishment, a new implantation, a network of points of sale…);
// - dates: the PUBLICATION date comes only from the search result's own date field (page_age); the EVENT date only
//   from the event sentence itself. One never becomes the other. Absent → null, never guessed;
// - the place is the one the event sentence names, after the event verb ("Basée à Lyon, X ouvrira à Toulouse" →
//   Toulouse): a mention of where the event happens, never a head office.
import {fold,parseDay} from '../signals/extract.ts';
import {eventDateIn} from '../discovery/strategies/event-time.ts';
import {mentionedPlace,placesIn} from '../discovery/geo-fr.ts';
import {FRESHNESS_DAYS,type SignalDiscoveryType} from './plan.ts';

export const SIGNAL_DISCOVERY_SOURCE_TYPE='search_snippet' as const;
export const MAX_EXCERPT_CHARS=500;
const DAY_MS=86400000;

// One result as the search engine returns it. `page_age` is the engine's own date for the page (Brave: ISO), if any.
export type SearchHit={title:string;description:string;url:string;page_age?:string|null};
export type EventTense='FUTURE'|'PAST'|'UNKNOWN';
export type DateGranularity='DAY'|'MONTH'|'PERIOD'|'YEAR';
// The event date exactly as the sentence writes it. A day or a month without a year keeps year = null: a year is
// never added.
export type AnnouncedDate={text:string;year:number|null;month:number|null;day:number|null;granularity:DateGranularity;
 // A part of a year written as such ("printemps 2027" → months 3–6, "fin 2026" → 10–12): the months it covers.
 months:[number,number]|null};
export type EventLocation={text:string;departments:string[];regions:string[];basis:'EVENT_MENTION'|'HEADLINE_MENTION'};
export type ExtractedEvent={
 signal_type:SignalDiscoveryType;
 trigger:string;
 excerpt:string;
 excerpt_truncated:boolean;
 excerpt_origin:'search_result_title'|'search_result_snippet';
 // Always false in V1: the page was not fetched; the excerpt is the search engine's text.
 observed_on_page:false;
 source_type:typeof SIGNAL_DISCOVERY_SOURCE_TYPE;
 source_url:string;
 published_at:string|null;
 event_date:AnnouncedDate|null;
 event_tense:EventTense;
 location:EventLocation|null;
 // The words written before the event verb in the event sentence (where the subject is), and the headline: read by
 // entity.ts, never shown as a company name by themselves.
 subject_text:string;
 headline:string;
 snippet:string;
};
export type ExtractRejection='INVALID_URL'|'NO_EVENT'|'NON_ESTABLISHMENT_OPENING'|'NOT_PHYSICAL_EXPANSION'|'NEGATED'|'STALE_PUBLICATION'|'STALE_EVENT';
export type ExtractOutcome={ok:true;event:ExtractedEvent}|{ok:false;reason:ExtractRejection};

// Accents removed, case kept, same length as the NFC text: indexes found here are indexes in the raw sentence.
const keepCase=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’`]/g,"'");

// What can be opened: an establishment or a place of business. Sector-agnostic list, CHR terms included.
const ESTABLISHMENT='(?:restaurants?|etablissements?|points? de vente|boutiques?|magasins?|enseignes?|adresses?|cafes?|coffee[- ]shops?|brasseries?|bars?|boulangeries?|snacks?|fast[- ]?foods?|pizzerias?|creperies?|bistrots?|salons? de the|food[- ]?trucks?|dark[- ]kitchens?|cuisines? centrales?|traiteurs?|epiceries?|supermarches?|hypermarches?|hotels?|comptoirs?|corners?|kiosques?|concept[- ]stores?|franchises?|succursales?|agences?|sites?|locaux|usines?|entrepots?|ateliers?|showrooms?|bureaux|unites?|implantations?)';
const DETERMINERS="(?:(?:un|une|son|sa|ses|leur|leurs|notre|nos|votre|vos|le|la|les|l'|des|de|d'|du|nouveaux?|nouvelles?|nouvel|premier|premiere|deuxieme|second|seconde|troisieme|quatrieme|cinquieme|\\d+e(?:me)?|grand|grande|petit|petite|vaste|futur|future|prochain|prochaine|plus grand|plus grande|tout nouveau|toute nouvelle)\\s*)*";
const OPEN_FUTURE="(?:ouvrira|ouvriront|va ouvrir|vont ouvrir|devrait ouvrir|devraient ouvrir|prevoit d'ouvrir|prevoient d'ouvrir|projette d'ouvrir|s'apprete a ouvrir|s'appretent a ouvrir|compte ouvrir|inaugurera|inaugureront|va inaugurer|s'implantera|s'installera)";
const OPEN_PAST="(?:a ouvert|ont ouvert|vient d'ouvrir|viennent d'ouvrir|a inaugure|ont inaugure|s'est implantee?|se sont implante(?:e)?s|s'est installee?)";
const OPEN_PRESENT="(?:ouvre|ouvrent|inaugure|inaugurent)";
const SETTLE="(?:s'implante|s'implantent|s'installe|s'installent|debarque|debarquent|arrive|arrivent|s'implantera|s'installera|debarquera|arrivera|s'est implantee?|s'est installee?|a debarque|est arrivee?)";
// Adverbs that may sit between the verb and its object or place ("ouvrira bientôt à Toulouse").
const ADVERBS="(?:\\s+(?:bientot|prochainement|enfin|officiellement|desormais|aussi|egalement|ses portes|leurs portes|dans quelques (?:jours|semaines|mois)|cet (?:hiver|ete|automne)|ce printemps))*";
// Case-sensitive on purpose: a place is a capitalized name ("à Toulouse"), "à 10h" or "à deux pas" is not.
const PLACE_PREP=new RegExp(`^${ADVERBS}\\s+(?:a|au|aux|en|sur|dans)\\s+(?:l'|la |le |les )?[A-Z]`);

// Openings that are not an establishment opening.
const NON_ESTABLISHMENT="(?:inscriptions?|candidatures?|billetteries?|ventes? de billets|reservations?|recrutements?|postes?|saisons?|chasse|peche|plis|droits|capital|negociations?|debats?|concertations?|enquetes?|consultations?|marches? financiers?|comptes?|dossiers?|festivals?|expositions?|salons? (?:professionnels?|du|de la|des)|soldes|portes ouvertes|esprit|jeux|ceremonie|seance|session|conference|webinaire|concours|appels? (?:a|d')|souscriptions?|abonnements?|precommandes?|pre-commandes?|commandes?|parcs? aquatiques?|piscines?|stations?)";
const NON_ESTABLISHMENT_OPENING=new RegExp(`\\b(?:ouverture|ouvre|ouvrent|ouvrira|ouvriront|ouvert|ouverte)s?\\s+(?:(?:des|de la|du|de|d'|un|une|les|la|le|l'|ses|sa|son|leur|leurs|officiellement|ce|cette|aujourd'hui|demain)\\s*)*${NON_ESTABLISHMENT}\\b`);
const OPENING_HOURS=/\b(?:horaires?|heures?|jours?|creneaux?|plages?) d'ouverture\b|\bouvert(?:e|s|es)? (?:tous les jours|7 ?j ?\/ ?7|du lundi|le dimanche|en continu|non-stop|jusqu'a)\b|\bouverture (?:le dimanche|tardive|exceptionnelle|en continu|7 ?j ?\/ ?7)\b/;
// A subject that is an event or a service, not a business ("Le festival ouvre ses portes", "La billetterie ouvrira…").
const NON_ESTABLISHMENT_SUBJECT=new RegExp(`(?:^|[\\s,;:])(?:le|la|les|l')?\\s*${NON_ESTABLISHMENT}\\s*$`);

const NEW_SITE_RULES:Array<{re:RegExp;tense:EventTense|null;needs:'object'|'object_or_place'|'context'|null}>=[
 // "X ouvrira un restaurant", "a ouvert son deuxième établissement", "ouvre ses portes à Toulouse", "ouvrira à Blagnac".
 {re:new RegExp(`\\b${OPEN_FUTURE}\\b`,'gi'),tense:'FUTURE',needs:'object_or_place'},
 {re:new RegExp(`\\b${OPEN_PAST}\\b`,'gi'),tense:'PAST',needs:'object_or_place'},
 {re:new RegExp(`\\b${OPEN_PRESENT}\\b`,'gi'),tense:null,needs:'object_or_place'},
 // "s'implante à Toulouse", "arrive à Montpellier": only with a place AND an establishment word somewhere in the result.
 {re:new RegExp(`\\b${SETTLE}\\b`,'gi'),tense:null,needs:'context'},
 // Nouns: "ouverture d'un nouveau restaurant", "inauguration de sa boutique", "nouveau point de vente", "nouvelle adresse".
 {re:new RegExp(`\\b(?:ouverture|inauguration)s?\\s+(?:prochaine\\s+|prevue\\s+|officielle\\s+)?(?:d'|de |du |des )${DETERMINERS}${ESTABLISHMENT}\\b`,'gi'),tense:null,needs:null},
 {re:new RegExp(`\\b(?:nouvelle ouverture|ouverture prochaine|prochaine ouverture|ouverture prevue|future ouverture|ouverture imminente)\\b`,'gi'),tense:'FUTURE',needs:'context'},
 {re:new RegExp(`\\b(?:nouveau|nouvel|nouvelle|nouveaux|nouvelles) ${ESTABLISHMENT}\\b`,'gi'),tense:null,needs:'context'},
];
// Physical or organizational expansion only.
const ORDINAL='(?:deuxieme|2e|2eme|second|seconde|troisieme|3e|3eme|quatrieme|4e|4eme|cinquieme|5e|5eme|\\d{1,2}e(?:me)?)';
const EXPANSION_RULES:RegExp[]=[
 new RegExp(`\\b${ORDINAL} (?:${ESTABLISHMENT})\\b`,'gi'),
 /\bnouvelles? implantations?\b/gi,
 new RegExp(`\\b(?:s'agrandit|s'agrandissent|agrandissement (?:de |du |des |d')${DETERMINERS}(?:${ESTABLISHMENT}))\\b`,'gi'),
 new RegExp(`\\b(?:etend|developpe|densifie|renforce) (?:son|leur|sa) (?:reseau|maillage) (?:de |d')?(?:${ESTABLISHMENT})?`,'gi'),
 new RegExp(`\\b(?:poursuit|poursuivent|accelere|accelerent) (?:son|leur|sa) (?:developpement|expansion|deploiement|croissance)\\b`,'gi'),
];
// "poursuit son développement" counts only with a physical anchor in the same sentence.
const PHYSICAL_ANCHOR=new RegExp(`\\b(?:${ESTABLISHMENT}|ouvr\\w*|ouverture|implant\\w*|inaugur\\w*|franchis\\w*)`);
const NAMED_PLACE=/(?:^|\s)(?:a|au|en|dans|sur) [A-Z]/;
// A list or a guide ("les 10 nouveaux restaurants à tester", "notre sélection") is editorial content, never one event.
const LISTICLE=/\b(?:top \d+|\d+ (?:nouveaux|nouvelles|adresses|restaurants|bonnes adresses|lieux|spots)|les? meilleure?s?|guide|selection|notre liste|a tester|a decouvrir|ou manger|ou boire|bons plans)\b/;
const NON_PHYSICAL_EXPANSION=/\b(?:elargit|etend|developpe|enrichit|diversifie|renouvelle)\s+(?:sa|son|ses|leur|leurs)\s+(?:gamme|offre|carte|catalogue|menu|services?|clientele|audience|public|communaute|activite en ligne|presence en ligne|presence digitale)\b|\bs'etend (?:a|au|aux|vers) (?:un|une|de) (?:nouveaux?|nouvelles?) (?:public|clientele|audience|cible)s?\b|\bexpansion (?:de|du|des) (?:sa|son|ses|leur) (?:gamme|offre|catalogue|audience|carte)\b|\b(?:developpement|expansion) (?:commercial|digital|numerique|en ligne|international)\b/i;
const NEGATION=/\b(?:n'ouvrira pas|n'ouvre pas|n'a pas ouvert|ne va pas ouvrir|ne vont pas ouvrir|renonce a (?:ouvrir|s'implanter)|renoncent a|abandonne (?:son|le) projet|annule (?:l'ouverture|son ouverture)|ouverture (?:annulee|abandonnee|reportee sine die)|ferme (?:definitivement )?ses portes|fermeture definitive)\b/i;
const FUTURE_WORDS=/\b(?:prochainement|bientot|a venir|prevue?s?|d'ici|courant|attendue?s?|prochaine?s?)\b/i;

// Sentences of a text, as written. A snippet often starts with a date stamp ("12 mars 2026 — …"): that stamp is the
// search engine's PUBLICATION hint, never an event date, so it is cut off before any reading.
const LEADING_STAMP=/^\s*(?:\d{1,2}(?:er)?\s+[a-zA-Zéèêûôîç]+\.?\s+\d{4}|\d{1,2}[/.]\d{1,2}[/.]\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]+\.?\s+\d{1,2},\s+\d{4}|il y a \d+ \w+|\d+ \w+ ago)\s*(?:[-–—·:|]|\.\.\.|…)\s*/i;
export function sentencesOf(text:string):string[]{
 const t=text.normalize('NFC').replace(LEADING_STAMP,'').replace(/\s+/g,' ').trim();
 if(!t)return [];
 return t.split(/(?<=[.!?…])\s+(?=[«"“A-ZÀ-Ý0-9])|\s+(?:\.\.\.|…)\s+/).map(s=>s.trim()).filter(s=>s.length>=8);
}

type Match={type:SignalDiscoveryType;index:number;subjectEnd?:number;trigger:string;tense:EventTense|null};
const VERB_GROUP=/(?:^|\s)(?:(?:a|ont|vient d'|viennent d'|va|vont|devrait|devraient|s'est|se sont)\s*)?(?:ouvert|ouvre|ouvrent|ouvrira|ouvriront|ouvrir|inaugure\w*|annonce\w*|lance\w*|poursui\w*|s'agrandi\w*|agrandi\w*|implante\w*|s'implant\w*|s'install\w*|accelere\w*|etend\w*|developpe\w*|densifie\w*|renforce\w*|prevoit|prevoient|projette\w*)\b/;
// When the event word is a noun or an object ("Napolino annonce l'ouverture d'un restaurant", "Café Mira a ouvert son
// deuxième établissement"), the subject ends where the clause's verb starts; that verb also gives the tense.
function verbBefore(low:string,index:number):{subjectEnd:number;tense:EventTense|null}{
 const clauseFrom=Math.max(low.lastIndexOf(',',index),low.lastIndexOf(';',index))+1;
 const verb=VERB_GROUP.exec(low.slice(clauseFrom,index));
 if(!verb)return {subjectEnd:index,tense:null};
 const v=verb[0].trim();
 const tense:EventTense|null=/^(?:a |ont |vient|viennent|s'est|se sont)/.test(v)?'PAST':/ouvrira|ouvriront|^va |^vont |prevoit|prevoient|projette|devrai/.test(v)?'FUTURE':null;
 return {subjectEnd:clauseFrom+verb.index,tense};
}
function establishmentContext(text:string):boolean{return new RegExp(`\\b${ESTABLISHMENT}\\b`).test(keepCase(text).toLowerCase())}

// The event one sentence carries, or why not. `context` = the whole result (headline + snippet), folded.
function eventIn(sentence:string,context:string):Match|{reason:ExtractRejection}{
 const kc=keepCase(sentence),low=kc.toLowerCase();
 if(NEGATION.test(low))return {reason:'NEGATED'};
 for(const re of EXPANSION_RULES){
  re.lastIndex=0;const m=re.exec(low);if(!m)continue;
  const isPursuit=/poursui|accelere/.test(m[0]);
  const rest=kc.slice(0,m.index)+' '+kc.slice(m.index+m[0].length);
  if(isPursuit&&!(PHYSICAL_ANCHOR.test(rest.toLowerCase())||NAMED_PLACE.test(rest)))continue;
  const {subjectEnd,tense}=verbBefore(low,m.index);
  return {type:'expansion',index:m.index,subjectEnd,trigger:sentence.slice(m.index,m.index+m[0].length),tense};
 }
 let excluded:ExtractRejection|null=null;
 if(OPENING_HOURS.test(low)||NON_ESTABLISHMENT_OPENING.test(low))excluded='NON_ESTABLISHMENT_OPENING';
 for(const rule of NEW_SITE_RULES){
  rule.re.lastIndex=0;let m:RegExpExecArray|null;
  while((m=rule.re.exec(low))){
   const at=m.index,end=at+m[0].length,after=kc.slice(end);
   const before=low.slice(0,at).replace(/[\s,]+$/,'');
   if(NON_ESTABLISHMENT_SUBJECT.test(before))continue;
   // "Horaires d'ouverture du restaurant…" is about opening hours, not an opening.
   if(/(?:horaires?|heures?|jours?|creneaux?|plages?) d'$/.test(low.slice(0,at)))continue;
   // The verb's own object: an establishment right after it (determiners aside), or a named place.
   const object=new RegExp(`^${ADVERBS}\\s+${DETERMINERS}${ESTABLISHMENT}\\b`).test(after.toLowerCase());
   const place=PLACE_PREP.test(after);
   const portes=/^\s+(?:ses|leurs) portes\b/.test(after.toLowerCase());
   if(rule.needs==='object_or_place'&&!(object||place||(portes&&establishmentContext(context))))continue;
   if(rule.needs==='context'&&LISTICLE.test(keepCase(context).toLowerCase()))continue;
   if(rule.needs==='context'&&!(establishmentContext(context)&&(place||/\b(?:a|au|en|dans|sur) [A-Z]/.test(kc)||placesIn(sentence).departments.size>0||object)))continue;
   // A non-establishment opening right at this occurrence ("ouverture des inscriptions") is never an establishment.
   if(NON_ESTABLISHMENT_OPENING.test(low.slice(at,end+40))&&!object)continue;
   const v=verbBefore(low,at);
   return {type:'new_site',index:at,subjectEnd:v.subjectEnd,trigger:sentence.slice(at,end),tense:rule.tense??v.tense};
  }
 }
 if(excluded)return {reason:excluded};
 if(NON_PHYSICAL_EXPANSION.test(low)||/\b(?:expansion|s'etend|poursuit son developpement)\b/.test(low))return {reason:'NOT_PHYSICAL_EXPANSION'};
 return {reason:'NO_EVENT'};
}

const MONTHS_FR=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
const RELATIVE=/\b(?:aujourd'hui|hier|il y a \d{1,3} \w+|\d{1,3} \w+ ago|today|yesterday)\b/gi;
const PERIOD_QUALIFIER=/\b(?:(?:au |a la |en |d'ici (?:la |le |l')?)?(?:debut|fin|mi|courant|printemps|ete|automne|hiver|rentree|premier semestre|second semestre|deuxieme semestre|(?:premier|deuxieme|troisieme|quatrieme|1er|2e|3e|4e) trimestre)(?:[- ](?:de |d')?(?:l'annee )?)?\s*)((?:19|20)\d{2})\b/i;
// The event date as the sentence writes it — exact day, month and year, a period of a year, a year, or a day/month
// without year. Relative words ("il y a 3 jours", "hier") are about the publication, never the event: ignored.
export function announcedDateIn(sentence:string,now:Date):AnnouncedDate|null{
 const raw=sentence.normalize('NFC');const kc=keepCase(raw).replace(RELATIVE,m=>' '.repeat(m.length));
 const text=(m:RegExpExecArray)=>raw.slice(m.index,m.index+m[0].length).trim();
 // 1. A full day (with year).
 const dayRe=/\b(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+((?:19|20)\d{2})\b|\b(\d{1,2})[/.](\d{1,2})[/.]((?:19|20)\d{2})\b|\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/i;
 let m=dayRe.exec(kc);
 if(m){const iso=parseDay(raw.slice(m.index,m.index+m[0].length),now);if(iso){const [y,mo,d]=iso.split('-').map(Number);return {text:text(m),year:y!,month:mo!,day:d!,granularity:'DAY',months:null}}}
 // 2. A season / part of a year ("fin 2026", "printemps 2027").
 m=PERIOD_QUALIFIER.exec(kc);
 if(m)return {text:text(m).replace(/^(?:au|a la|à la|en|d'ici|d’ici)\s+(?:la |le |l'|l’)?/i,''),year:Number(m[1]),month:null,day:null,granularity:monthsOf(m[0])?'PERIOD':'YEAR',months:monthsOf(m[0])};
 // 3. Month + year, or a year (the latest one written; founding years and quantities excluded — event-time.ts).
 const d=eventDateIn(raw);
 if(d){
  const at=fold(raw).indexOf(d.text);
  return {text:at>=0?raw.slice(at,at+d.text.length):d.text,year:d.year,month:d.month,day:null,granularity:d.month?'MONTH':'YEAR',months:null};
 }
 // 4. A day or a month without a year: kept as written, the year stays unknown (never added).
 m=/\b(?:le\s+)?(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b(?!\s+\d)/i.exec(kc);
 if(m)return {text:text(m).replace(/^le\s+/i,''),year:null,month:MONTHS_FR.indexOf(m[2]!.toLowerCase())+1,day:Number(m[1]),granularity:'DAY',months:null};
 m=/\b(?:en|des|d'ici|courant|fin|debut|mi-)\s*(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b(?!\s+\d)/i.exec(kc);
 if(m)return {text:text(m),year:null,month:MONTHS_FR.indexOf(m[1]!.toLowerCase())+1,day:null,granularity:'MONTH',months:null};
 return null;
}

const SEASON_MONTHS:Array<[RegExp,[number,number]]>=[
 [/debut/,[1,3]],[/premier semestre/,[1,6]],[/(?:premier|1er) trimestre/,[1,3]],[/printemps/,[3,6]],[/(?:deuxieme|2e) trimestre/,[4,6]],[/\bmi\b/,[5,8]],
 [/ete/,[6,9]],[/(?:second|deuxieme) semestre/,[7,12]],[/(?:troisieme|3e) trimestre/,[7,9]],[/rentree/,[9,9]],[/automne/,[9,12]],[/fin/,[10,12]],
 [/(?:quatrieme|4e) trimestre/,[10,12]],
];
function monthsOf(qualifier:string):[number,number]|null{
 const q=qualifier.toLowerCase();
 // "hiver 2026" straddles two years, "courant 2026" is the whole year: no month range, the year only.
 for(const [re,range] of SEASON_MONTHS)if(re.test(q))return range;
 return null;
}
// The first and last day the written date can mean (UTC). null when the year is unknown.
export function periodOf(d:AnnouncedDate):{start:number;end:number}|null{
 if(d.year===null)return null;
 if(d.granularity==='DAY'&&d.month&&d.day){const t=Date.UTC(d.year,d.month-1,d.day);return {start:t,end:t+DAY_MS-1}}
 if(d.month)return {start:Date.UTC(d.year,d.month-1,1),end:Date.UTC(d.year,d.month,1)-1};
 if(d.months)return {start:Date.UTC(d.year,d.months[0]-1,1),end:Date.UTC(d.year,d.months[1],1)-1};
 return {start:Date.UTC(d.year,0,1),end:Date.UTC(d.year+1,0,1)-1};
}
// Tense: the written date first when it is entirely after or before today; else the verb; else unknown.
function tenseOf(date:AnnouncedDate|null,verb:EventTense|null,sentence:string,now:Date):EventTense{
 const p=date?periodOf(date):null;
 if(p&&p.start>now.getTime())return 'FUTURE';
 if(p&&p.end<now.getTime())return 'PAST';
 if(verb)return verb;
 if(FUTURE_WORDS.test(keepCase(sentence)))return 'FUTURE';
 return 'UNKNOWN';
}

// The place written in the event's own clause, after the event verb: never the head office named before it.
const MONTH_WORD=/^(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|janv|fevr|sept|oct|nov|dec)$/i;
function placeAfter(text:string):string|null{
 const re=/(?:^|\s)(?:à|a|au|aux|en|sur|dans)\s+((?:l'|l’|la |le |les )?[A-ZÀ-Ý][\p{L}'’]+(?:-[\p{L}'’]+)*(?:\s(?:[A-ZÀ-Ý][\p{L}'’]+(?:-[\p{L}'’]+)*)){0,2})/gu;
 for(const m of text.matchAll(re)){
  const name=m[1]!.trim();const first=keepCase(name.replace(/^(?:l'|l’|la |le |les )/i,'')).split(/[\s-]/)[0]!;
  if(MONTH_WORD.test(first))continue;
  return name;
 }
 return null;
}
function locationOf(clause:string,headline:string,basisFromHeadline:boolean):EventLocation|null{
 const read=(t:string,basis:EventLocation['basis']):EventLocation|null=>{
  const literal=placeAfter(t);const found=placesIn(literal??t);
  const text=literal??mentionedPlace(null,t);
  if(!text)return null;
  return {text:text.slice(0,80),departments:[...found.departments].sort(),regions:[...found.regions].sort(),basis};
 };
 return read(clause,'EVENT_MENTION')??(basisFromHeadline?read(headline,'HEADLINE_MENTION'):null);
}

function publishedAtOf(pageAge:string|null|undefined,now:Date):string|null{
 if(!pageAge||typeof pageAge!=='string')return null;
 const t=Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(pageAge)?`${pageAge}T00:00:00Z`:pageAge);
 if(!Number.isFinite(t)||t>now.getTime()+DAY_MS)return null;
 return new Date(t).toISOString();
}
const clip=(s:string)=>{if(s.length<=MAX_EXCERPT_CHARS)return {text:s,truncated:false};return {text:s.slice(0,MAX_EXCERPT_CHARS-1).replace(/\s+\S*$/,'')+'…',truncated:true}};
const isPublicHttpUrl=(u:string)=>{try{const x=new URL(u);return (x.protocol==='https:'||x.protocol==='http:')&&!x.username&&!x.password}catch{return false}};

export function extractEvent(hit:SearchHit,now:Date):ExtractOutcome{
 if(!isPublicHttpUrl(hit.url))return {ok:false,reason:'INVALID_URL'};
 const published_at=publishedAtOf(hit.page_age,now);
 if(published_at&&now.getTime()-Date.parse(published_at)>FRESHNESS_DAYS*DAY_MS)return {ok:false,reason:'STALE_PUBLICATION'};
 const headline=hit.title.normalize('NFC').replace(/\s+/g,' ').trim();
 const snippet=(hit.description??'').normalize('NFC').replace(/\s+/g,' ').trim();
 const context=`${headline} ${snippet}`;
 // The snippet's sentences first (they carry dates and places), then the headline.
 const candidates:Array<{sentence:string;origin:ExtractedEvent['excerpt_origin']}>=[
  ...sentencesOf(snippet).map(sentence=>({sentence,origin:'search_result_snippet' as const})),
  ...(headline?[{sentence:headline,origin:'search_result_title' as const}]:[]),
 ];
 const reasons:ExtractRejection[]=[];
 for(const {sentence,origin} of candidates){
  const found=eventIn(sentence,context);
  if('reason' in found){reasons.push(found.reason);continue}
  // The clause carrying the event: from the last comma/semicolon before the verb to the end of the sentence.
  const clauseStart=Math.max(sentence.lastIndexOf(',',found.index),sentence.lastIndexOf(';',found.index))+1;
  const clause=sentence.slice(clauseStart);
  let event_date=announcedDateIn(clause,now)??announcedDateIn(sentence.slice(found.index),now);
  // A date written before the event's clause ("En décembre 2026, X ouvrira…") counts only when it agrees with the
  // verb's tense: "son restaurant ouvert en 2023, X ouvrira…" never dates the new opening in 2023.
  if(!event_date){const whole=announcedDateIn(sentence,now);const p=whole?periodOf(whole):null;
   if(whole&&(!found.tense||!p||(found.tense==='FUTURE'?p.end>now.getTime():p.start<now.getTime())))event_date=whole}
  // The headline announcing the same kind of event may carry the date the snippet sentence omits.
  if(!event_date&&origin==='search_result_snippet'){const h=eventIn(headline,context);if(!('reason' in h)&&h.type===found.type)event_date=announcedDateIn(headline,now)}
  const event_tense=tenseOf(event_date,found.tense,clause,now);
  const p=event_date?periodOf(event_date):null;
  if(p&&event_tense==='PAST'&&now.getTime()-p.end>FRESHNESS_DAYS*DAY_MS)return {ok:false,reason:'STALE_EVENT'};
  const {text,truncated}=clip(sentence);
  return {ok:true,event:{
   signal_type:found.type,trigger:found.trigger,excerpt:text,excerpt_truncated:truncated,excerpt_origin:origin,observed_on_page:false,
   source_type:SIGNAL_DISCOVERY_SOURCE_TYPE,source_url:hit.url,published_at,event_date,event_tense,
   location:locationOf(sentence.slice(found.index),headline,origin==='search_result_snippet'),
   subject_text:sentence.slice(0,found.subjectEnd??found.index).trim(),headline,snippet,
  }};
 }
 const priority:ExtractRejection[]=['NEGATED','NON_ESTABLISHMENT_OPENING','NOT_PHYSICAL_EXPANSION','NO_EVENT'];
 return {ok:false,reason:priority.find(r=>reasons.includes(r))??'NO_EVENT'};
}
