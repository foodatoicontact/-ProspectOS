// Frozen NBA rows for the /ui-v2/today bench (Preview only) and the tests. "canary": the three 6XPOS recommendations as
// stored on staging (NBA v1.3, rule INCOMPLETE_FIT_FRESH_SIGNAL). "all": the same plus synthetic rows covering every
// ZF1.1 action (CONTACT, ENGAGE, WATCH with a signal to check, WATCH with nothing to do, WAIT) — clearly fictitious names.
import type {TodayRow} from '../../../nba/today.ts';
import type {Statement} from '../../../nba/engine.ts';

const MISSING=['Indépendant ou petit réseau : décision d’achat locale (pas une grande chaîne aux achats centralisés)',
 'Commande directe, click & collect, fidélité, moindre dépendance aux plateformes','Un canal de contact professionnel documenté'];
const SUPPORTING=['Restauration avec point de vente physique en Occitanie'];
const fact=(text:string,url:string|null=null,kind:'signal'|'evidence'='signal'):Statement=>({kind:'fact',text,refs:url?[{kind,id:`ref-${text.length}`,source_url:url}]:[]});

function row(o:{id:string;name:string;action:TodayRow['recommended_action'];type:string|null;place:string|null;age:number|null;status?:string|null;
 kind?:'signal'|'conversation'|null;opp:number;fit:number|null;intent:number;timing:number;fresh:number;eq:number;cov:number;state:string;
 supporting?:string[];missing?:string[];url?:string|null;rule:string;proof?:string}):TodayRow{
 const proof=o.proof??(o.type?`${o.name} : ${o.type==='EXPANSION'?'ouverture d’un nouveau restaurant':'nouvelle implantation'} annoncée.`:'');
 return {id:o.id,prospect_id:`p-${o.id}`,recommended_action:o.action,rule:o.rule,state:'PENDING',opportunity_score:o.opp,fit_score:o.fit,fit_basis:'mixed',
  intent_score:o.intent,timing_score:o.timing,freshness_score:o.fresh,evidence_quality_score:o.eq,primary_kind:o.kind===undefined?(o.type?'signal':null):o.kind,
  primary_signal_type:o.type,primary_evidence_status:o.status===undefined?'VERIFIED':o.status,signal_age_days:o.age,
  primary_detail:{signal_id:`s-${o.id}`,geo_relevance:o.place?'MATCH':undefined,place:o.place},
  scores:{fit:{profile:{state:o.state,coverage:o.cov,supporting:o.supporting??SUPPORTING,missing:o.missing??MISSING}}},target:null,
  explanation:{why_this_account:[fact('Restauration avec point de vente physique en Occitanie.',o.url??null,'evidence')],why_now:o.type?[fact(proof,o.url??null)]:[],
   why_this_action:[{kind:'rule',text:`Règle ${o.rule}.`,refs:[]}],inferred:[],unknown:[]},computed_at:'2026-10-17T08:00:00Z',prospects:{name:o.name}};
}

export const CANARY_ROWS:TodayRow[]=[
 row({id:'quick',name:'Quick',action:'WATCH',type:'EXPANSION',place:'Hérault (34)',age:25,opp:45,fit:35,intent:10,timing:64,fresh:68,eq:50,cov:35,state:'INCOMPLETE',
  url:'https://www.infoccitanie.fr/',rule:'INCOMPLETE_FIT_FRESH_SIGNAL'}),
 row({id:'mojo',name:'Mojo',action:'WATCH',type:'NEW_LOCATION',place:'Toulouse',age:6,opp:44,fit:35,intent:7,timing:55,fresh:91,eq:50,cov:35,state:'INCOMPLETE',
  url:'https://www.ladepeche.fr/',rule:'INCOMPLETE_FIT_FRESH_SIGNAL'}),
 row({id:'ocrousti',name:'O’Crousti Poulet',action:'WATCH',type:'NEW_LOCATION',place:'Carcassonne',age:6,opp:44,fit:35,intent:7,timing:55,fresh:91,eq:50,cov:35,state:'INCOMPLETE',
  url:'https://www.lindependant.fr/',rule:'INCOMPLETE_FIT_FRESH_SIGNAL'}),
];

export const ALL_STATES_ROWS:TodayRow[]=[
 row({id:'contact',name:'Exemple Contact (fictif)',action:'CONTACT',type:'NEW_LOCATION',place:'Montpellier',age:3,opp:78,fit:80,intent:40,timing:70,fresh:95,eq:80,cov:100,
  state:'SUFFICIENT',supporting:[...SUPPORTING,'Décision d’achat locale'],missing:[],url:'https://example.org/annonce',rule:'FRESH_SIGNAL_FIT_SUFFICIENT'}),
 ...CANARY_ROWS,
 row({id:'inferred',name:'Exemple Signal à vérifier (fictif)',action:'WATCH',type:'NEW_LOCATION',place:'Nîmes',age:2,status:'INFERRED',opp:40,fit:50,intent:5,timing:60,fresh:97,eq:20,cov:60,
  state:'PARTIAL',missing:[],url:'https://example.org/article',rule:'INFERRED_SIGNAL_NEEDS_REVIEW'}),
 row({id:'engage',name:'Exemple Conversation (fictif)',action:'ENGAGE',type:null,kind:'conversation',place:null,age:1,opp:50,fit:60,intent:30,timing:65,fresh:90,eq:60,cov:70,
  state:'PARTIAL',missing:[],rule:'PUBLIC_CONVERSATION_FIT'}),
 row({id:'watch',name:'Exemple Veille (fictif)',action:'WATCH',type:'PRODUCT_LAUNCH',place:'Perpignan',age:40,opp:20,fit:70,intent:3,timing:20,fresh:30,eq:60,cov:90,
  state:'SUFFICIENT',missing:[],url:'https://example.org/lancement',rule:'WEAK_TIMING_WATCH'}),
 row({id:'wait',name:'Exemple Attente (fictif)',action:'WAIT',type:null,place:null,age:null,opp:10,fit:20,intent:0,timing:0,fresh:0,eq:10,cov:20,state:'UNKNOWN',rule:'NO_TIMING'}),
];
