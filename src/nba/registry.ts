// Next Best Action V1 — the commercial signal registry. ONE table drives classification, decay, timing weight, action
// affinity and target roles; nothing below is a per-type condition in the engine. Adding a type = adding an entry.
//
// A commercial type is a CLASSIFICATION of an existing signal (migration 024 — hiring_role, funding…), never a second
// storage: the stored signal, its status (PENDING_REVIEW / VERIFIED / REJECTED, decided by a person) and its source are
// unchanged. The classification reads only the signal's own words (title, excerpt, matched terms) and its source kind;
// a type that needs words (HIRING_SDR…) is "explicit" only when those words are written in the signal itself.
//
// Decay: when an entry gives none, the Intent Engine's own half-life / max age for the base type is used
// (src/domain/intent.ts DECAY) — one source of truth. Entries that override it say why, next to the numbers.
import {DECAY} from '../domain/intent.ts';
import type {SignalType} from '../signals/types.ts';

export const COMMERCIAL_SIGNAL_TYPES=['HIRING_FIRST_SALES','HIRING_HEAD_OF_SALES','HIRING_SDR','HIRING_BDR','HIRING_AE','PIPELINE_BUILDING',
 'COMMERCIAL_ACCELERATION','PUBLIC_COMMERCIAL_NEED','PROCUREMENT','FUNDRAISING','NEW_MARKET','NEW_EXECUTIVE','NEW_LOCATION','EXPANSION',
 'PRODUCT_LAUNCH','PARTNERSHIP_EXPANSION','MANUAL_SIGNAL','OTHER'] as const;
export type CommercialSignalType=typeof COMMERCIAL_SIGNAL_TYPES[number];
// contact: the signal can justify a direct approach; watch: worth following, never enough alone to contact.
export type Affinity='contact'|'watch';
export type Decay={halfLifeDays:number;maxAgeDays:number};

export type RegistryEntry={
 type:CommercialSignalType;
 // The 024 types this entry can classify; null = any base type (the words / source decide).
 base:readonly SignalType[]|null;
 // Words that must be written in the signal (folded: no accents, lower case). Absent = the base type is enough.
 terms?:RegExp;
 // Only signals from this kind of source (024 source_type).
 sourceTypes?:readonly string[];
 // Only signals a person added (024 provider user_provided).
 manualOnly?:boolean;
 // 'explicit' = the need is written (a job ad for an SDR); 'contextual' = a business event that may create one.
 need:'explicit'|'contextual';
 decay?:Decay;
 // How much this type, fresh and verified, says "now" (0–1). Read by TIMING only.
 timingWeight:number;
 affinity:Affinity;
 // Who usually owns the decision this signal opens — a recommendation of a ROLE, never a person.
 targetRoles:readonly string[];
 label:{fr:string;en:string};
};

// Folded text, the way every term below is written.
export const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’`]/g,"'").toLowerCase().replace(/\s+/g,' ').trim();

// Order = priority: the first entry that matches wins (the most specific first, the base-type fallbacks last).
// Hiring decays: a job ad is usually filled or closed within weeks (half-life 14–30 days, gone after 60–90), faster than
// the Intent Engine's generic hiring_role (21 / 90) for junior roles whose ads are short-lived.
export const REGISTRY:readonly RegistryEntry[]=[
 {type:'HIRING_FIRST_SALES',base:['hiring_role'],need:'explicit',decay:{halfLifeDays:21,maxAgeDays:75},timingWeight:1,affinity:'contact',
  terms:/\b(premier|premiere|1er|1ere)\s+(commercial|commerciale|sales|business developer|account executive|bizdev)\b|\bfirst sales\b|\bfounding (ae|account executive|sales)\b/,
  targetRoles:['Founder','CEO'],label:{fr:'Premier recrutement commercial',en:'First sales hire'}},
 {type:'HIRING_HEAD_OF_SALES',base:['hiring_role'],need:'explicit',decay:{halfLifeDays:30,maxAgeDays:90},timingWeight:0.9,affinity:'contact',
  terms:/\bhead of sales\b|\bvp sales\b|\bvice[- ]president sales\b|\bchief revenue officer\b|\bcro\b|\bdirect(eur|rice) commercial(e)?\b|\bresponsable commercial(e)?\b|\bsales director\b/,
  targetRoles:['Founder','CEO','CRO'],label:{fr:'Recrutement d’un responsable commercial',en:'Head of Sales hire'}},
 {type:'HIRING_SDR',base:['hiring_role'],need:'explicit',decay:{halfLifeDays:14,maxAgeDays:60},timingWeight:0.95,affinity:'contact',
  terms:/\bsdr\b|\bsales development\b|\bcharge(e)? de prospection\b|\bcharge(e)? de developpement commercial\b/,
  targetRoles:['Head of Sales','VP Sales','Founder'],label:{fr:'Recrutement SDR',en:'SDR hiring'}},
 {type:'HIRING_BDR',base:['hiring_role'],need:'explicit',decay:{halfLifeDays:14,maxAgeDays:60},timingWeight:0.95,affinity:'contact',
  terms:/\bbdr\b|\bbusiness developer\b|\bbusiness development representative\b|\bdeveloppeu(r|se) commercial(e)?\b/,
  targetRoles:['Head of Sales','VP Sales','Founder'],label:{fr:'Recrutement BDR',en:'BDR hiring'}},
 {type:'HIRING_AE',base:['hiring_role'],need:'explicit',decay:{halfLifeDays:21,maxAgeDays:75},timingWeight:0.85,affinity:'contact',
  terms:/\baccount executive\b|\bingenieu(r|re) commercial(e)?\b|\bkey account manager\b|\bcommercial(e)? (terrain|b2b|grands comptes)\b/,
  targetRoles:['Head of Sales','VP Sales'],label:{fr:'Recrutement Account Executive',en:'Account Executive hiring'}},
 {type:'PIPELINE_BUILDING',base:['hiring_role','headcount_growth','expansion','product_launch'],need:'explicit',decay:{halfLifeDays:21,maxAgeDays:75},timingWeight:0.9,affinity:'contact',
  terms:/\boutbound\b|\bgeneration de leads\b|\blead gen(eration)?\b|\bpipeline\b|\bprospection\b|\bcold (call|calling|email|emailing)\b/,
  targetRoles:['Head of Sales','RevOps','Head of Growth'],label:{fr:'Construction du pipeline commercial',en:'Pipeline building'}},
 {type:'COMMERCIAL_ACCELERATION',base:['hiring_role','headcount_growth'],need:'contextual',decay:{halfLifeDays:30,maxAgeDays:90},timingWeight:0.8,affinity:'contact',
  terms:/\bequipe commerciale\b|\bsales team\b|\bforce de vente\b|\bcommerciaux\b|\bsales reps\b/,
  targetRoles:['VP Sales','Head of Sales'],label:{fr:'Accélération commerciale',en:'Commercial acceleration'}},
 {type:'PUBLIC_COMMERCIAL_NEED',base:null,need:'explicit',decay:{halfLifeDays:14,maxAgeDays:45},timingWeight:1,affinity:'contact',
  terms:/\b(nous )?(recherch|cherch)(e|ons|ent) (un|une|des) (prestataire|fournisseur|partenaire|solution|outil)s?\b|\blooking for (a|an) (vendor|provider|partner|solution|tool)\b/,
  targetRoles:['Founder','CEO','Head of Sales'],label:{fr:'Besoin commercial exprimé publiquement',en:'Public commercial need'}},
 // A tender is open for weeks; past its deadline it is useless — short life on purpose.
 {type:'PROCUREMENT',base:null,need:'explicit',decay:{halfLifeDays:14,maxAgeDays:45},timingWeight:0.9,affinity:'contact',sourceTypes:['public_procurement'],
  terms:/\bappel d'offres?\b|\bavis de marche\b|\bconsultation\b|\bmarche public\b|\btender\b/,
  targetRoles:['Procurement'],label:{fr:'Appel d’offres',en:'Procurement'}},
 {type:'FUNDRAISING',base:['funding'],need:'contextual',timingWeight:0.8,affinity:'contact',targetRoles:['Founder','CEO'],label:{fr:'Levée de fonds',en:'Fundraising'}},
 {type:'NEW_MARKET',base:['expansion','new_site'],need:'contextual',timingWeight:0.7,affinity:'contact',
  terms:/\binternational\b|\bnouveaux? marches?\b|\bs'implante (en|aux|au)\b|\bexport\b|\bnew market\b|\bexpands? (to|into)\b/,
  targetRoles:['CEO','Head of Growth','Business Development'],label:{fr:'Nouveau marché',en:'New market'}},
 {type:'NEW_EXECUTIVE',base:['leadership_change'],need:'contextual',timingWeight:0.75,affinity:'contact',targetRoles:['CEO','CRO','VP Sales'],label:{fr:'Nouveau dirigeant',en:'New executive'}},
 {type:'NEW_LOCATION',base:['new_site'],need:'contextual',timingWeight:0.6,affinity:'contact',targetRoles:['CEO','Founder'],label:{fr:'Nouvelle implantation',en:'New location'}},
 {type:'EXPANSION',base:['expansion'],need:'contextual',timingWeight:0.65,affinity:'contact',targetRoles:['CEO','Head of Growth'],label:{fr:'Expansion',en:'Expansion'}},
 {type:'PRODUCT_LAUNCH',base:['product_launch'],need:'contextual',timingWeight:0.55,affinity:'watch',targetRoles:['Head of Growth','CEO'],label:{fr:'Lancement de produit',en:'Product launch'}},
 {type:'PARTNERSHIP_EXPANSION',base:['partnership'],need:'contextual',timingWeight:0.5,affinity:'watch',targetRoles:['Partnerships','Business Development'],label:{fr:'Nouveau partenariat',en:'Partnership'}},
 {type:'MANUAL_SIGNAL',base:null,need:'contextual',manualOnly:true,timingWeight:0.6,affinity:'watch',targetRoles:[],label:{fr:'Signal ajouté manuellement',en:'Manual signal'}},
 {type:'OTHER',base:null,need:'contextual',timingWeight:0.4,affinity:'watch',targetRoles:[],label:{fr:'Autre signal',en:'Other signal'}},
];
export const entryOf=(t:CommercialSignalType)=>REGISTRY.find(e=>e.type===t)!;
export function decayOf(entry:RegistryEntry,base:SignalType):Decay{return entry.decay??DECAY[base]}

// ------------------------------------------------------------
// Public conversations (ENGAGE). A VERIFIED public content (migration 027) is relevant when it speaks about one of
// these topics (or about one of the project's own intent terms). Each topic carries the ANGLE a person may take — an
// idea to contribute, never a compliment and never a claim about the author.
// A public post is answered within days: half-life 3 days, useless after 14.
// ------------------------------------------------------------
export const CONVERSATION_DECAY:Decay={halfLifeDays:3,maxAgeDays:14};
export const CONVERSATION_TIMING_WEIGHT=0.7;
export type ConversationTopic={key:string;terms:RegExp;label:{fr:string;en:string};angle:{fr:string;en:string};comment:{fr:string;en:string}};
export const CONVERSATION_TOPICS:readonly ConversationTopic[]=[
 {key:'call_volume',terms:/\bappels?\b|\bcold call(ing)?\b|\bcalls?\b|\bphoning\b/,label:{fr:'le volume d’appels',en:'call volume'},
  angle:{fr:'Intervenir sur la différence entre volume d’appels et qualité du ciblage.',en:'Contribute on the difference between call volume and targeting quality.'},
  comment:{fr:'Sur le volume d’appels : ce qui change souvent le résultat, c’est moins le nombre d’appels que le moment où chaque compte est appelé. Une raison concrète et récente de contacter donne plus de conversations utiles qu’une liste plus longue.',
   en:'On call volume: what often changes the outcome is less the number of calls than when each account is called. A concrete, recent reason to reach out tends to produce more useful conversations than a longer list.'}},
 {key:'pipeline',terms:/\bpipeline\b|\bpipe\b|\bleads?\b|\bprospection\b|\boutbound\b/,label:{fr:'la construction du pipeline',en:'pipeline building'},
  angle:{fr:'Partager ce qui alimente réellement un pipeline : le moment du contact plutôt que le volume de comptes.',en:'Share what actually feeds a pipeline: the timing of the contact rather than the number of accounts.'},
  comment:{fr:'Sur le pipeline : un critère simple aide à trier, se demander pour chaque compte s’il existe une raison datée de lui parler maintenant. Sans cette raison, le volume ajoute surtout du bruit.',
   en:'On pipeline: one simple filter helps, asking for each account whether there is a dated reason to talk to them now. Without that reason, volume mostly adds noise.'}},
 {key:'sales_hiring',terms:/\brecrut\w*|\bhiring\b|\bsdr\b|\bbdr\b|\baccount executive\b|\bonboarding\b/,label:{fr:'le recrutement commercial',en:'sales hiring'},
  angle:{fr:'Échanger sur ce qu’on confie aux nouveaux commerciaux : la liste de comptes et les raisons de les appeler.',en:'Discuss what new sales hires are given: the account list and the reasons to call each account.'},
  comment:{fr:'Sur l’arrivée de nouveaux commerciaux : la qualité de la liste qu’on leur confie compte autant que leur onboarding. Des comptes avec une raison récente de contact les font progresser plus vite.',
   en:'On onboarding new sales hires: the quality of the account list they receive matters as much as the onboarding itself. Accounts with a recent reason to reach out help them ramp faster.'}},
 {key:'targeting',terms:/\bciblage\b|\bicp\b|\bpersona\b|\bsegmentation\b|\btargeting\b/,label:{fr:'le ciblage',en:'targeting'},
  angle:{fr:'Apporter un point de vue sur la priorisation des comptes par signaux récents plutôt que par profil seul.',en:'Bring a view on prioritising accounts by recent signals rather than by profile alone.'},
  comment:{fr:'Sur le ciblage : un bon profil dit à qui parler, rarement quand. Croiser le profil avec un signal récent et vérifiable aide à choisir les comptes de la semaine.',
   en:'On targeting: a good profile tells you who to talk to, rarely when. Combining the profile with a recent, verifiable signal helps choose the accounts of the week.'}},
];
