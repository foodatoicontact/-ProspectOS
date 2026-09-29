import {createHash} from 'node:crypto';
import type {Observation} from '../types.ts';
import type {Criterion} from '../../domain/core.ts';
import type {ObservationContext} from './restaurant.ts';
import {icpSignalType,icpSignalHash,conceptsForLabel,NEGATION,withoutNegationExemptions} from './icp-concepts.ts';
// Semantic ICP mapping, deterministic: what a criterion ASKS FOR (its intent, read from the label the user
// wrote) against what a sentence of the page SAYS (an explicit construction, not a lone keyword).
//
//  - RULE ENGINE (icp-concepts.ts) keeps precedence: a label one of its concepts applies to is owned by it.
//  - INTENTS (this module) cover the other labels. Families are generic — activity/service, booking,
//    schedule, capacity, events/community, contact, pricing/offers, physical presence — and are activated
//    only by the label's own words. No sector, customer, project or place is known here: an activity the
//    label names ("Discipline : X ou Y") is taken from the label itself and must appear in an activity
//    context on the page ("cours de X", "studio de Y").
//  - HUMAN REVIEW decides. A positive mapping is an INFERRED proposal (value true → evidence
//    INFERRED_UNCONFIRMED, 0 point) on the same ICP_SIGNAL:<key> type the review flow already handles; only
//    review_discovery_observation turns it VERIFIED, and only the existing scoreProspect scores it.
//
// Conservative by construction. A sentence that negates the intent ("pas de réservation", "aucun cours") is
// NEGATIVE; a tentative, past or price-only mention ("bientôt disponibles", "tournoi 2022", "10 parties
// achetées = 1 offerte") is INSUFFICIENT. Neither is ever proposed as a fact: both are kept as contextual
// notes (value null, stored without criterion — see toStorageSafeObservation) so the reviewer sees why the
// criterion stays "À confirmer". Contact data (phone, e-mail) only ever supports a contact criterion.
export type IntentId='ACTIVITY_OR_SERVICE'|'BOOKING_OR_REGISTRATION'|'SCHEDULE_OR_REGULARITY'|'CAPACITY'|'EVENT_OR_COMMUNITY'|'CONTACTABILITY'|'DECISION_MAKER'|'PRICING_OR_OFFER'|'LOCATION_OR_PHYSICAL_PRESENCE';
export type Polarity='positive'|'negative'|'insufficient';
export const INTENT_NOTE_TYPES={negative:'ICP_INTENT_NEGATIVE',insufficient:'ICP_INTENT_INSUFFICIENT'} as const;

export const normText=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’`]/g,"'").replace(/\s+/g,' ').trim();
const W='(?:^|[^a-z0-9])',E='(?=[^a-z0-9]|$)';
const words=(list:string)=>new RegExp(`${W}(?:${list})${E}`);

// ---------------------------------------------------------------- contact data never supports anything else
const PHONE=/(?:\+33\s*(?:\(0\)\s*)?|(?:^|[^0-9])0)[1-9](?:[ .-]?\d{2}){4}/;
const EMAIL=/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/;
const hasContactData=(n:string)=>PHONE.test(n)||EMAIL.test(n);
// A label asking for an identifiable decision-maker (see decisionMaker below). Shared with contact-channel.ts.
export const DECISION_MAKER_LABEL=/(decisionnaire|decideur|decision[- ]?maker|dirigeant|interlocuteur|nominati)/;

// ---------------------------------------------------------------- guards (all on the normalized line)
// NEGATION / withoutNegationExemptions: the single definition shared with the rule engine (icp-concepts.ts).
const NEGATED_CUE=/(?:^|[^a-z])(?:pas de|pas d'|aucun|aucune|sans|jamais de|plus aucun|ni)\s+(?:\S+\s+)?$/;
const TENTATIVE=words("bientot|prochainement|coming soon|en construction|en projet|ouverture prochaine|sera disponible|seront disponibles|a venir");
const PAST_WORDS=words("retour sur|ancien|ancienne|anciens|anciennes|archives?|a eu lieu|s'est deroule|s'est deroulee|edition precedente|derniere edition");
// An amount or a promotion — not the mere word "tarifs" (a "Tarifs & planning" heading is not a price).
const PRICE_OR_PROMO=/€|\d\s*euros?(?=[^a-z]|$)|(?:^|[^a-z])(?:achete\w*|offert\w*|promo\w*|remise|reduction)(?=[^a-z]|$)/;
function pastYear(n:string,year:number):boolean{for(const m of n.matchAll(/(?:^|[^0-9])((?:19|20)\d{2})(?=[^0-9]|$)/g))if(Number(m[1])<year)return true;return false}

// ---------------------------------------------------------------- intent families
type Support={reason:string;confidence:number};
type Intent={
 id:IntentId;
 // A label names this intent. `blockedBy` keeps a label that only looks like it out (e.g. "Liste de contacts
 // marketing" is not about reaching the prospect; "l'offre" in "Besoin correspondant à l'offre" is ours).
 label:RegExp;blockedBy?:RegExp;
 // Words of a sentence that make it ABOUT the intent (a guard can then turn it negative/insufficient).
 cue:RegExp;
 // An explicit construction that supports the intent, given how the criterion was interpreted.
 support(n:string,criterion:Interpretation):Support|null;
 // Promotional wording is not proof of this intent (it is proof of an offer).
 priceIsNotProof?:boolean;
 // Internal page names worth fetching for this intent (path + link text, normalized).
 page:RegExp;
};

const ACT_NOUN="cours|seances?|lecons?|ateliers?|stages?|entrainements?|sessions?|parties|classes?|initiations?|coachings?|trainings?|workshops?|lessons?";
const ACTIVITY_CONTEXT=words(`${ACT_NOUN}|pratique\\w*|studio|club|discipline|terrains?|salles?`);
// "cours" also means course/price/flow: "au cours de", "en cours", "cours de bourse", "cours d'eau"… — never an activity.
const NOT_AN_ACTIVITY=/(?:^|[^a-z])(?:au cours (?:de|du|des)|en cours|cours d'eau|cours (?:de|du|des) (?:la |l')?(?:bourse|change|actions?|action|marche|matieres?|or|devises?|eau|validite|route))(?=[^a-z]|$)/g;
const DAYS='lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday';
// Activity names ("which disciplines?") are never guessed from the words of a label: a word of a label may
// be an adjective ("physique" in "Lieu physique"), a qualifier ("exploitable") or any other ordinary word.
// They come only from a structured source — see interpretCriterion.

const escapeRe=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const namedPattern=(names:string[])=>new RegExp(`${W}(${names.map(n=>escapeRe(n)+'s?').join('|')})${E}`);
const activity:Intent={
 id:'ACTIVITY_OR_SERVICE',
 label:words(`${ACT_NOUN}|activites?|activite|activity|activities|prestations?|disciplines?|pratique\\w*`),
 cue:words(ACT_NOUN),priceIsNotProof:true,
 support(n,criterion){
  if(criterion.named.length){
   // A target activity from a structured source must appear, in an activity context of the sentence.
   const m=namedPattern(criterion.named).exec(n);
   return m&&ACTIVITY_CONTEXT.test(n.replace(namedPattern(criterion.named),' '))?{reason:`Le site présente une activité cible (« ${m[1].trim()} », ${criterion.namedSource==='label'?'nommée dans le critère':'catégorie de la règle ICP'})`,confidence:.55}:null;
  }
  if(new RegExp(`${W}(premier|premiere|1er|1ere) (cours|seance|lecon|session|entrainement|partie|atelier)`).test(n))return {reason:'Le site invite à un premier cours ou une première séance',confidence:.55};
  if(new RegExp(`${W}(prenez|reservez|essayez|decouvrez|rejoignez|inscrivez-vous a|inscrivez vous a) (votre |vos |un |une |nos |le |la |les |des )?(${ACT_NOUN})${E}`).test(n))return {reason:'Le site invite à suivre un cours ou une séance',confidence:.55};
  if(new RegExp(`${W}(cours|seances?|lecons?|sessions?) d'(essai|initiation|decouverte)`).test(n))return {reason:'Le site propose un cours ou une séance d’essai',confidence:.55};
  if(new RegExp(`${W}(${ACT_NOUN}) (collectifs?|collectives?|individuel\\w*|particuliers?|prives?|privees?|coache\\w*|hebdomadaires?|quotidien\\w*|en groupe|en petits? groupes?|tous les|chaque|de [a-z]{3,}|d'[a-z]{3,})`).test(n))return {reason:'Le site décrit des cours ou séances proposés',confidence:.5};
  if(new RegExp(`${W}(nos|des) (${ACT_NOUN})${E}`).test(n))return {reason:'Le site mentionne ses cours ou séances',confidence:.45};
  return null;
 },
 page:words(`activites?|activities|cours|classes?|prestations?|services?|disciplines?|ateliers?|stages?|seances?|entrainements?|programmes?|lessons?|training|premier cours`),
};

const booking:Intent={
 id:'BOOKING_OR_REGISTRATION',
 label:words('reserv\\w*|booking|book|inscri\\w*|register|registration|rendez-vous|rendez vous|rdv|prise de rendez-vous'),
 cue:words('reserv\\w*|booking|book\\w*|inscri\\w*|register\\w*|rendez-vous|rendez vous|rdv'),
 support(n,criterion){
  const label=criterion.label;
  const channel=new RegExp(`${W}(en ligne|online|via|sur (notre |l'|le |votre )?(site|application|appli|app|plateforme)|application|appli|app|plateforme|internet)${E}`).test(n);
  if(channel)return {reason:'Le site indique une réservation ou une inscription par un canal en ligne',confidence:.55};
  // A label asking for an online booking is not supported by a booking without a stated channel.
  if(new RegExp(`${W}(en ligne|online|application|appli|app|web|digital|internet)${E}`).test(label))return null;
  if(new RegExp(`${W}(reservez|reserver|book|inscrivez[- ]vous|prenez rendez-vous|prendre rendez-vous)\\s+(votre|vos|un|une|des|le|la|les|en)\\s+[a-z]`).test(n))return {reason:'Le site invite à réserver ou à s’inscrire',confidence:.5};
  return null;
 },
 page:words('reserv\\w*|booking|book|inscri\\w*|register|rendez-vous|rendez vous|rdv|adhesion|adherer'),
};

const schedule:Intent={
 id:'SCHEDULE_OR_REGULARITY',
 label:words('planning|plannings|horaires?|calendrier|agenda|emploi du temps|regulier|reguliere|reguliers|regulieres|regularite|hebdomadaires?|recurrent\\w*|frequence|schedule|timetable|weekly'),
 cue:words(`planning|horaires?|calendrier|agenda|hebdomadaires?|tous les jours|chaque|${DAYS}|\\d{1,2}\\s*h`),priceIsNotProof:true,
 support(n){
  if(new RegExp(`${W}planning (de |d'|du |des )?(livraison|production|fabrication|chantiers?|travaux|projets?|maintenance|expedition)`).test(n))return null; // operational planning, not an activity's
  if(new RegExp(`${W}planning (des|de la|du|de|hebdo\\w*)${E}|${W}planning\\s*:`).test(n))return {reason:'Le site publie un planning',confidence:.55};
  if(new RegExp(`${W}(${DAYS})\\s*[:,]?\\s*(de\\s+)?\\d{1,2}\\s*h`).test(n))return {reason:'Le site indique des jours et des horaires',confidence:.55};
  if(new RegExp(`${W}\\d{1,2}\\s*h\\s*\\d{0,2}\\s*,\\s*\\d{1,2}\\s*h`).test(n))return {reason:'Le site indique plusieurs horaires récurrents',confidence:.5};
  if(new RegExp(`${W}(tous les jours|toutes les semaines|chaque (jour|semaine|${DAYS})|hebdomadaires?|du (${DAYS}) au (${DAYS}))${E}`).test(n))return {reason:'Le site indique une activité régulière',confidence:.5};
  if(new RegExp(`${W}(horaires|calendrier|agenda)\\s*(:|des|de la|du)${E}`).test(n))return {reason:'Le site publie des horaires ou un calendrier',confidence:.5};
  if(new RegExp(`${W}planning${E}`).test(n)&&n.length<=60)return {reason:'Le site comporte une rubrique planning',confidence:.4};
  return null;
 },
 page:words('planning|horaires?|calendrier|agenda|emploi du temps|schedule|timetable|programme'),
};

const UNIT_WORDS='terrains?|courts?|pistes?|salles?|espaces?|studios?|sites?|agences?|etablissements?|magasins?|boutiques?|chambres?|lits?|logements?';
const NUMBER_WORDS:Record<string,number>={deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8,neuf:9,dix:10,douze:12,quinze:15,vingt:20,two:2,three:3,four:4,five:5};
const capacity:Intent={
 id:'CAPACITY',
 label:words("capacite|capacites|multi|plusieurs|nombre de|taille|grande structure|several|multiple|capacity"),
 cue:words(UNIT_WORDS),
 support(n){
  let total=0;
  for(const m of n.matchAll(new RegExp(`(?:^|[^a-z0-9])(\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})\\s+(?:[a-z-]+\\s+){0,2}?(${UNIT_WORDS})(?=[^a-z]|$)`,'g'))){const v=/^\d+$/.test(m[1])?Number(m[1]):NUMBER_WORDS[m[1]]??0;if(v>0&&v<=500)total+=v}
  return total>=2?{reason:`Le site mentionne ${total} unités (terrains, salles, espaces…) au total dans cet extrait`,confidence:.55}:null;
 },
 page:words('installations?|equipements?|infrastructures?|terrains?|salles?|espaces?|le club|le lieu|nos locaux|facilities'),
};

const MONTHS='janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre';
const EVENT_NOUN='tournois?|competitions?|championnats?|evenements?|evenementiel|communaute|ligues?|challenges?|rencontres|animations?|soirees?|events?|tournaments?|community|meetups?';
const events:Intent={
 id:'EVENT_OR_COMMUNITY',
 label:words(`${EVENT_NOUN}|evenementielle`),
 cue:words(EVENT_NOUN),
 support(n){
  if(!new RegExp(`${W}(${EVENT_NOUN})${E}`).test(n))return null;
  if(new RegExp(`${W}(tous les (mois|week-ends?|samedis|dimanches|ans)|chaque (mois|semaine|annee|week-end|saison)|toute l'annee|toute la saison|regulierement|prochain\\w*|le \\d{1,2}(er)? (${MONTHS})|\\d{1,2}(er)? (${MONTHS})|organis\\w*)${E}`).test(n))return {reason:'Le site annonce des tournois, compétitions ou événements',confidence:.55};
  if(new RegExp(`${W}(rejoignez|\\d+ (membres|adherents|licencies|joueurs|participants))${E}`).test(n))return {reason:'Le site décrit une communauté active',confidence:.5};
  return null;
 },
 page:words(`${EVENT_NOUN}|agenda`),
};

const contact:Intent={
 id:'CONTACTABILITY',
 label:/(joignab|coordonnees|canal de contact|moyens? de contact|contact (pro|professionnel|direct|documente|joignable)|contactab|reachab|telephone (pro|professionnel|joignable|de contact)|e-?mail (pro|professionnel|de contact)|^contacts?$|^contacts? )/,
 blockedBy:new RegExp(`(liste|fichier|base de|campagne|marketing|commande|order|vente|achat|paiement)|${DECISION_MAKER_LABEL.source}`),
 cue:/[a-z0-9]|\d/,
 support(n){
  if(PHONE.test(n))return {reason:'Le site affiche un numéro de téléphone',confidence:.55};
  if(EMAIL.test(n))return {reason:'Le site affiche une adresse e-mail de contact',confidence:.55};
  if(words("contactez[- ]nous|contactez|appelez[- ]nous|ecrivez[- ]nous|nous contacter|formulaire de contact").test(n))return {reason:'Le site invite à prendre contact',confidence:.45};
  return null;
 },
 page:words('contact\\w*|nous joindre|nous ecrire'),
};

// A decision-maker contact ("Contact décisionnaire identifiable") asks for a PERSON or a precise decision
// role. A company's switchboard number, a contact@ address or a contact form never identifies one: such a
// label is kept out of the contact-channel intent above (blockedBy) and only an explicit role supports it.
// Contact data never supports it either (evaluateLine): a named role is proposed, the phone is not.
const DECISION_ROLE="directeur\\w*|directrice\\w*|dirigeant\\w*|dirigeante\\w*|gerant\\w*|gerante\\w*|president\\w*|presidente\\w*|pdg|ceo|cto|cfo|coo|dsi|fondateur\\w*|fondatrice\\w*|co-?fondat\\w*|chef d'entreprise|responsable (?:des |du |de la )?(?:achats?|commercial\\w*|ventes?|recrutement|rh|ressources humaines|it|informatique|systemes? d'information|technique|marketing|developpement|d'agence|d'exploitation)";
const decisionMaker:Intent={
 id:'DECISION_MAKER',
 label:DECISION_MAKER_LABEL,
 cue:words(DECISION_ROLE),
 support(n){return words(DECISION_ROLE).test(n)?{reason:'Le site nomme un dirigeant ou un rôle décisionnaire',confidence:.5}:null},
 page:words('equipe|notre equipe|qui sommes[- ]nous|a propos|direction|contact\\w*|mentions legales'),
};

const pricing:Intent={
 id:'PRICING_OR_OFFER',
 label:words("tarifs?|tarifaires?|prix|pricing|abonnements?|formules?|forfaits?|fidelisation|fidelite|promotions?|offres commerciales|offre commerciale|offres? (tarifaires?|promotionnelles?|speciales?|de fidelite)|carte de fidelite|loyalty"),
 cue:/[a-z0-9]/,
 support(n){
  if(/\d+\s+[a-z-]+\s+achete\w*\s*=\s*\d+\s*(?:[a-z-]+\s+)?offert\w*/.test(n)||words('offert\\w*|parrainage|carte de fidelite|programme de fidelite').test(n))return {reason:'Le site décrit une offre promotionnelle ou de fidélité',confidence:.55};
  if(/\d+(?:[,.]\d+)?\s*(?:€|euros?)(?=[^a-z]|$)|€\s*\d+/.test(n))return {reason:'Le site affiche des tarifs',confidence:.5};
  if(words('abonnements?\\s*(mensuel\\w*|annuel\\w*|:|\\d)|forfaits?\\s*(:|\\d|de \\d)|carte (de )?\\d+|a partir de \\d+').test(n))return {reason:'Le site décrit des formules ou abonnements',confidence:.5};
  return null;
 },
 page:words('tarifs?|prix|pricing|offres?|abonnements?|formules?|forfaits?|cartes?|pass|fidelite|promotions?|adhesion'),
};

const location:Intent={
 id:'LOCATION_OR_PHYSICAL_PRESENCE',
 label:words("adresse|implantation|presence physique|lieux?|locaux|local|sur place|physical|address|premises|place of business"),
 cue:/[a-z0-9]/,
 support(n){
  if(/(?:^|[^0-9])\d{1,4}\s*(?:bis |ter )?,?\s*(?:rue|avenue|av\.?|boulevard|bd|chemin|route|place|allee|impasse|quai|zone|za|zi|zac)\s+[a-z]/.test(n))return {reason:'Le site indique une adresse physique',confidence:.55};
  if(words('situe (a|au|en|dans)|situee (a|au|en|dans)|nous trouver|adresse\\s*:').test(n)&&/\d{5}|rue|avenue|boulevard|chemin|route|place/.test(n))return {reason:'Le site indique où se trouve l’établissement',confidence:.5};
  return null;
 },
 page:words('acces|plan d acces|nous trouver|adresse|localisation|venir'),
};

export const INTENTS:Intent[]=[activity,booking,schedule,capacity,events,contact,decisionMaker,pricing,location];

// ---------------------------------------------------------------- reading a criterion label
// A label is a set of ALTERNATIVES ("Cours / séances / réservation active", "Lieu physique ou activité
// exploitable localement"): any one of them is enough. Intents are read per alternative (segment) and
// united; a qualifier only narrows its own segment:
//  - regularity ("activité régulière") or a booking ("réservation de cours") → that intent, not a bare activity;
//  - local presence ("activité exploitable localement", "sur place") → physical presence, not a bare activity.
// A requirement stated once for the whole label ("Réservation ou inscription EN LIGNE") keeps applying to
// the whole label (see booking.support).
// Target activities ("discipline cible", "activité ciblée") are only ever taken from a structured source —
// an enumeration written in the label ("Discipline : X ou Y", "Activités (X, Y)") or the categories of the
// ICP's own target_fit rule. Without one, such a segment asks for something unknowable: it stays unmapped.
export type Interpretation={label:string;intents:Intent[];named:string[];namedSource:'label'|'target_fit'|null;understood:boolean};
const ALTERNATIVES=/\s*(?:\/|\||;|,|(?:^|\s)ou(?:\s|$)|(?:^|\s)or(?:\s|$))\s*/;
const LOCAL_QUALIFIER=words('localement|sur place|en local|de proximite|local|locale|locaux');
// The segment asks for a TARGET activity ("discipline cible", "activité ciblée", "correspondant à…"): only a
// structured source can say which one.
const TARGET_REQUIREMENT=words("disciplines?|cibles?|ciblees?|target\\w*|correspondant\\w*");
const listItems=(s:string)=>s.split(ALTERNATIVES).map(x=>x.replace(/^(le|la|les|l'|du|de la|des)\s+/,'').trim()).filter(x=>x.length>=2&&x.length<=40);
function targetFitCategories(criteria:Criterion[]):string[]{
 const out:string[]=[];
 for(const c of criteria)if(c.rules?.type==='target_fit')for(const v of c.rules.config.categories??[])out.push(normText(v));
 return [...new Set(out.filter(v=>v.length>=2))];
}
function segmentIntents(segment:string,label:string):Intent[]{
 let found=INTENTS.filter(i=>i.label.test(segment)&&!(i.blockedBy?.test(label)));
 if(LOCAL_QUALIFIER.test(segment)&&!found.includes(location))found=[...found,location];
 if(found.some(i=>i.id!=='ACTIVITY_OR_SERVICE'&&i.id!=='CAPACITY'&&i.id!=='EVENT_OR_COMMUNITY'&&i.id!=='CONTACTABILITY'&&i.id!=='PRICING_OR_OFFER'))found=found.filter(i=>i.id!=='ACTIVITY_OR_SERVICE');
 return found;
}
export function interpretCriterion(rawLabel:string,criteria:Criterion[]=[]):Interpretation{
 const label=normText(rawLabel);
 // "Discipline : X ou Y" / "Activités (X, Y)": a head naming activities, then their structured list.
 const enumeration=/^([^:()]+?)\s*(?::\s*(.+)|\((.+)\)\s*)$/.exec(label);
 const head=enumeration?enumeration[1]:label;
 const enumerated=enumeration&&activity.label.test(head)?listItems(enumeration[2]??enumeration[3]):[];
 const segments=enumerated.length?[head]:label.split(ALTERNATIVES).filter(Boolean);
 const ids=new Set<IntentId>();let genericActivity=false,namedRequired=false;
 for(const segment of segments){
  for(const i of segmentIntents(segment,label)){
   if(i.id!=='ACTIVITY_OR_SERVICE'){ids.add(i.id);continue}
   if(enumerated.length||TARGET_REQUIREMENT.test(segment))namedRequired=true;else genericActivity=true;
  }
 }
 const fromRule=namedRequired&&!enumerated.length?targetFitCategories(criteria):[];
 const named=genericActivity?[]:enumerated.length?enumerated:fromRule;
 if(genericActivity||named.length)ids.add('ACTIVITY_OR_SERVICE');
 return {label,intents:INTENTS.filter(i=>ids.has(i.id)),named,namedSource:named.length?(enumerated.length?'label':'target_fit'):null,understood:ids.size>0||namedRequired};
}
// Intents a label asks for (without the ICP's structured sources — used for display and page selection).
export function intentsForLabel(label:string):Intent[]{return interpretCriterion(label).intents}

// ---------------------------------------------------------------- one criterion, one page
type Candidate={polarity:Polarity;line:string;reason:string;confidence:number;intent:IntentId};
function evaluateLine(intent:Intent,raw:string,n:string,criterion:Interpretation,year:number):Candidate|null{
 if(intent.id!=='CONTACTABILITY'&&hasContactData(n))return null; // contact data only ever supports a contact criterion
 if(intent.id==='ACTIVITY_OR_SERVICE')n=n.replace(NOT_AN_ACTIVITY,m=>' '.repeat(m.length));
 const cue=intent.id==='ACTIVITY_OR_SERVICE'&&criterion.named.length?namedPattern(criterion.named):intent.cue;
 const cueMatch=cue.exec(n);if(!cueMatch)return null;
 const plain=withoutNegationExemptions(n); // same length: cue positions stay valid
 const support=intent.support(n,criterion);
 if(intent.id==='CONTACTABILITY'||intent.id==='PRICING_OR_OFFER'||intent.id==='LOCATION_OR_PHYSICAL_PRESENCE'){if(!support)return null} // cue = any text: only a supported line counts
 if(NEGATED_CUE.test(plain.slice(0,cueMatch.index+1)))return {polarity:'negative',line:raw,reason:'Le site indique explicitement l’absence de cet élément',confidence:.3,intent:intent.id};
 if(NEGATION.test(plain))return support?{polarity:'insufficient',line:raw,reason:'Formulation négative ou ambiguë : ne permet pas de conclure',confidence:.3,intent:intent.id}:null;
 if(TENTATIVE.test(n))return {polarity:'insufficient',line:raw,reason:'Mention future ou incertaine (« bientôt », « à venir »…) : pas une activité actuelle établie',confidence:.3,intent:intent.id};
 if(PAST_WORDS.test(n)||pastYear(n,year))return {polarity:'insufficient',line:raw,reason:'Mention passée (année ou édition antérieure) : ne prouve pas une activité actuelle',confidence:.3,intent:intent.id};
 if(intent.priceIsNotProof&&PRICE_OR_PROMO.test(n))return {polarity:'insufficient',line:raw,reason:'Mention tarifaire ou promotionnelle : ne suffit pas à établir ce critère',confidence:.3,intent:intent.id};
 return support?{polarity:'positive',line:raw,reason:support.reason,confidence:Math.min(.6,support.confidence),intent:intent.id}:null;
}

// Normalized once per page, whatever the number of criteria. A "sentence" longer than MAX_LINE is not one
// (minified text, a whole page without punctuation): never evaluated — an excerpt is 500 characters at most,
// and no pattern here ever runs on unbounded input.
const MAX_LINE=1000;
const NORMALIZED=new WeakMap<string[],Array<{raw:string;n:string}>>();
function normalizedLines(lines:string[]){let l=NORMALIZED.get(lines);if(!l){l=lines.filter(raw=>raw.length<=MAX_LINE).map(raw=>({raw,n:normText(raw)}));NORMALIZED.set(lines,l)}return l}
// The strongest positive sentence of the page for this criterion; otherwise the first negative, then the
// first insufficient one; otherwise nothing (the criterion keeps its existing fallback).
// When a rule-engine concept owns a label (icp-concepts.ts) it runs first; only if it finds nothing may an
// intent answer — never one that would be a weaker version of the concept's own claim (any opening hours
// are not "extended" hours, any booking is not a booking by slot, any count is not the one the label names).
const CONCEPT_BLOCKS:Record<string,IntentId[]>={
 MULTI_UNIT_CAPACITY:['CAPACITY'],EXTENDED_OPENING_HOURS:['SCHEDULE_OR_REGULARITY'],SLOT_BOOKING:['BOOKING_OR_REGISTRATION','SCHEDULE_OR_REGULARITY'],
 BOOKABLE_FACILITY:['BOOKING_OR_REGISTRATION','CAPACITY'],GROUP_EVENT_OFFERS:['PRICING_OR_OFFER'],
};
// `now`: the analysis date (the real clock in production — an analysis always reads the page as it is today).
// `criteria`: the project's whole ICP (the structured sources of target activities).
export function evaluateCriterionIntents(ctx:ObservationContext,criterion:Criterion,now=new Date(),criteria:Criterion[]=[criterion]):Candidate|null{
 const blocked=new Set(conceptsForLabel(criterion.label).flatMap(c=>CONCEPT_BLOCKS[c.id]??[]));
 const interpretation=interpretCriterion(criterion.label,criteria);
 const intents=interpretation.intents.filter(i=>!blocked.has(i.id));if(!intents.length)return null;
 const year=now.getUTCFullYear();
 let best:Candidate|null=null,negative:Candidate|null=null,insufficient:Candidate|null=null;
 for(const {raw,n} of normalizedLines(ctx.lines)){
  for(const intent of intents){
   const c=evaluateLine(intent,raw,n,interpretation,year);if(!c)continue;
   if(c.polarity==='positive'){if(!best||c.confidence>best.confidence)best=c}
   else if(c.polarity==='negative')negative??=c;else insufficient??=c;
  }
 }
 return best??negative??insufficient;
}

// The intent layer understood what this criterion asks for (or knows it cannot be answered without a
// structured source): when it found no evidence, no weaker keyword guess is made for it either.
export function intentLayerUnderstands(criterion:Criterion,criteria:Criterion[]=[criterion]):boolean{
 const blocked=new Set(conceptsForLabel(criterion.label).flatMap(c=>CONCEPT_BLOCKS[c.id]??[]));
 const i=interpretCriterion(criterion.label,criteria);
 return i.intents.some(x=>!blocked.has(x.id))||(i.understood&&!i.intents.length);
}
// Called only when no rule-engine concept produced a proposal for this criterion (strategies/generic.ts).
export function extractIntentObservation(ctx:ObservationContext,criterion:Criterion,now=new Date(),criteria:Criterion[]=[criterion]):{observation:Observation;polarity:Polarity;intent:IntentId}|null{
 const c=evaluateCriterionIntents(ctx,criterion,now,criteria);if(!c)return null;
 const excerpt=c.line.slice(0,500);const label=criterion.label.trim();
 if(c.polarity==='positive'){
  const claim=`${c.reason} : cela peut correspondre au critère « ${label} ». Proposition à confirmer par un humain.`;
  return {observation:{...ctx.make(criterion.key,icpSignalType(criterion.key),excerpt,true,'INFERRED',claim.slice(0,1000),c.confidence),content_hash:icpSignalHash(excerpt)},polarity:'positive',intent:c.intent};
 }
 const claim=`${c.reason}. Critère « ${label} » : à confirmer, aucune proposition faite (0 point).`;
 const hash=createHash('sha256').update(`icp-intent-note:v1\n${criterion.key}\n${normText(excerpt)}`).digest('hex');
 return {observation:{...ctx.make(criterion.key,INTENT_NOTE_TYPES[c.polarity],excerpt,null,'INFERRED',claim.slice(0,1000),c.confidence),content_hash:hash},polarity:c.polarity,intent:c.intent};
}

// ---------------------------------------------------------------- internal pages worth analyzing
// Which intents a set of criteria asks for — concept-owned labels included (a label about slot booking
// still makes a booking page worth reading).
export function pageIntentsFor(criteria:Criterion[]):Intent[]{
 const ids=new Set<IntentId>();
 for(const c of criteria){
  for(const i of interpretCriterion(c.label,criteria).intents)ids.add(i.id);
  for(const concept of conceptsForLabel(c.label))for(const id of CONCEPT_PAGE_INTENTS[concept.id]??[])ids.add(id);
 }
 return INTENTS.filter(i=>ids.has(i.id));
}
const CONCEPT_PAGE_INTENTS:Record<string,IntentId[]>={
 MULTI_UNIT_CAPACITY:['CAPACITY'],EXTENDED_OPENING_HOURS:['SCHEDULE_OR_REGULARITY'],SLOT_BOOKING:['BOOKING_OR_REGISTRATION','SCHEDULE_OR_REGULARITY'],
 GROUP_EVENT_OFFERS:['EVENT_OR_COMMUNITY','PRICING_OR_OFFER'],BOOKABLE_FACILITY:['BOOKING_OR_REGISTRATION','CAPACITY'],
};
// Never worth one of the few pages an analysis may read.
const NEVER_FETCH=words('mentions? legales?|cgv|cgu|conditions generales|confidentialite|privacy|cookies?|panier|cart|checkout|connexion|login|mon compte|account|wp-admin|wp-login|feed|rss|plan du site|sitemap');
// Score of an internal link for the intents still missing: 3 per intent it names, +1 when it is one of the
// generic pages any organization publishes (base). 0 = not worth fetching.
export function internalLinkScore(pathAndText:string,intents:Intent[],generic:boolean):number{
 const n=normText(pathAndText.replace(/[-_/.+&]+/g,' '));
 if(NEVER_FETCH.test(n))return 0;
 return intents.filter(i=>i.page.test(n)).length*3+(generic?1:0);
}
