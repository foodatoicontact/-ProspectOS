// Company-creation barometer: monthly counts of the creation notices published in the BODACC (Bulletin officiel des
// annonces civiles et commerciales, DILA — Licence Ouverte 2.0) for every French department, region and the whole country.
//  - Only TOTALS are ever published: never a name, an address or a registration number. The export asks for neither the
//    trader's name nor the register number; the activity text and the address are read in memory to count, then dropped.
//  - A commune is shown only when it gathers at least MIN_COMMUNE_NOTICES notices, so no row points at one person.
//  - The activity split is a deterministic keyword classification of the declared activity (first establishment), a
//    closed table published on the page itself: it is labelled "indicative", never presented as an official NAF code.
//  - One fixed host, bounded time and size, redirects refused. An unanswered or malformed answer is an error, never "0".
import {DEPARTMENTS} from '../discovery/geo-fr.ts';

export const BODACC_DATASET='https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales';
export const BODACC_PUBLIC_PAGE='https://www.bodacc.fr/';
export const BODACC_LICENSE='https://www.etalab.gouv.fr/licence-ouverte-open-licence/';
const RECORDS_TIMEOUT_MS=20000,EXPORT_TIMEOUT_MS=45000,MAX_RECORDS_BYTES=500_000,MAX_EXPORT_BYTES=12_000_000;
export const MIN_COMMUNE_NOTICES=5;
const TOP_COMMUNES=10,TREND_MONTHS=13;

// ── Zones: every department, and every region that has more than one ────────────────────────────────────────────────
// The French preposition differs by place ("en Haute-Garonne", "dans le Gers", "dans l’Aude", "à Paris"): written by hand.
const IN:Record<string,string>={
 '01':'dans l’Ain','02':'dans l’Aisne','03':'dans l’Allier','04':'dans les Alpes-de-Haute-Provence','05':'dans les Hautes-Alpes',
 '06':'dans les Alpes-Maritimes','07':'en Ardèche','08':'dans les Ardennes','09':'en Ariège','10':'dans l’Aube','11':'dans l’Aude',
 '12':'en Aveyron','13':'dans les Bouches-du-Rhône','14':'dans le Calvados','15':'dans le Cantal','16':'en Charente',
 '17':'en Charente-Maritime','18':'dans le Cher','19':'en Corrèze','2A':'en Corse-du-Sud','2B':'en Haute-Corse','21':'en Côte-d’Or',
 '22':'dans les Côtes-d’Armor','23':'dans la Creuse','24':'en Dordogne','25':'dans le Doubs','26':'dans la Drôme','27':'dans l’Eure',
 '28':'en Eure-et-Loir','29':'dans le Finistère','30':'dans le Gard','31':'en Haute-Garonne','32':'dans le Gers','33':'en Gironde',
 '34':'dans l’Hérault','35':'en Ille-et-Vilaine','36':'dans l’Indre','37':'en Indre-et-Loire','38':'en Isère','39':'dans le Jura',
 '40':'dans les Landes','41':'en Loir-et-Cher','42':'dans la Loire','43':'en Haute-Loire','44':'en Loire-Atlantique','45':'dans le Loiret',
 '46':'dans le Lot','47':'en Lot-et-Garonne','48':'en Lozère','49':'en Maine-et-Loire','50':'dans la Manche','51':'dans la Marne',
 '52':'en Haute-Marne','53':'en Mayenne','54':'en Meurthe-et-Moselle','55':'dans la Meuse','56':'dans le Morbihan','57':'en Moselle',
 '58':'dans la Nièvre','59':'dans le Nord','60':'dans l’Oise','61':'dans l’Orne','62':'dans le Pas-de-Calais','63':'dans le Puy-de-Dôme',
 '64':'dans les Pyrénées-Atlantiques','65':'dans les Hautes-Pyrénées','66':'dans les Pyrénées-Orientales','67':'dans le Bas-Rhin',
 '68':'dans le Haut-Rhin','69':'dans le Rhône','70':'en Haute-Saône','71':'en Saône-et-Loire','72':'dans la Sarthe','73':'en Savoie',
 '74':'en Haute-Savoie','75':'à Paris','76':'en Seine-Maritime','77':'en Seine-et-Marne','78':'dans les Yvelines','79':'dans les Deux-Sèvres',
 '80':'dans la Somme','81':'dans le Tarn','82':'dans le Tarn-et-Garonne','83':'dans le Var','84':'dans le Vaucluse','85':'en Vendée',
 '86':'dans la Vienne','87':'en Haute-Vienne','88':'dans les Vosges','89':'dans l’Yonne','90':'dans le Territoire de Belfort',
 '91':'dans l’Essonne','92':'dans les Hauts-de-Seine','93':'en Seine-Saint-Denis','94':'dans le Val-de-Marne','95':'dans le Val-d’Oise',
 '971':'en Guadeloupe','972':'en Martinique','973':'en Guyane','974':'à La Réunion','976':'à Mayotte',
};
const REGION_IN:Record<string,string>={
 'Auvergne-Rhône-Alpes':'en Auvergne-Rhône-Alpes','Bourgogne-Franche-Comté':'en Bourgogne-Franche-Comté','Bretagne':'en Bretagne',
 'Centre-Val de Loire':'en Centre-Val de Loire','Corse':'en Corse','Grand Est':'dans le Grand Est','Hauts-de-France':'dans les Hauts-de-France',
 'Île-de-France':'en Île-de-France','Normandie':'en Normandie','Nouvelle-Aquitaine':'en Nouvelle-Aquitaine','Occitanie':'en Occitanie',
 'Pays de la Loire':'dans les Pays de la Loire','Provence-Alpes-Côte d’Azur':'en Provence-Alpes-Côte d’Azur',
};
export const slugOf=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export type CreationsDepartment={code:string;name:string;prefecture:string;slug:string;in:string;region:string};
export type CreationsRegion={name:string;slug:string;in:string;departments:CreationsDepartment[]};
export const CREATIONS_DEPARTMENTS:readonly CreationsDepartment[]=DEPARTMENTS.map(d=>({code:d.code,name:d.name,prefecture:d.prefecture,slug:slugOf(d.name),in:IN[d.code]??`dans le département ${d.name}`,region:d.region}));
// A region of one department (the overseas ones) is that department's page: no second page with the same figures.
export const CREATIONS_REGIONS:readonly CreationsRegion[]=[...new Set(CREATIONS_DEPARTMENTS.map(d=>d.region))]
 .map(name=>({name,slug:slugOf(name),in:REGION_IN[name]??`en ${name}`,departments:CREATIONS_DEPARTMENTS.filter(d=>d.region===name)}))
 .filter(r=>r.departments.length>1)
 .sort((a,b)=>a.name.localeCompare(b.name,'fr'));
export const CREATIONS_HUB='creations-entreprises';
export const creationsPath=(z:{slug:string})=>`${CREATIONS_HUB}/${z.slug}`;
export const departmentBySlug=(slug:string)=>CREATIONS_DEPARTMENTS.find(d=>d.slug===slug)??null;
export const regionBySlug=(slug:string)=>CREATIONS_REGIONS.find(r=>r.slug===slug)??null;
export const regionOf=(d:CreationsDepartment)=>CREATIONS_REGIONS.find(r=>r.name===d.region)??null;
export type CreationsZone={kind:'department';department:CreationsDepartment}|{kind:'region';region:CreationsRegion};
export function zoneBySlug(slug:string):CreationsZone|null{
 const department=departmentBySlug(slug);if(department)return {kind:'department',department};
 const region=regionBySlug(slug);if(region)return {kind:'region',region};
 return null;
}

// ── Months ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A month is 'YYYY-MM' (UTC). The reported month is the last COMPLETE one: on 31 October, September.
const pad=(n:number)=>String(n).padStart(2,'0');
export const addMonths=(month:string,delta:number)=>{const [y,m]=month.split('-').map(Number) as [number,number];const d=new Date(Date.UTC(y,m-1+delta,1));return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}`};
export const reportMonth=(now:Date)=>addMonths(`${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}`,-1);
export const monthStart=(month:string)=>`${month}-01`;
export const monthLabel=(month:string)=>new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T00:00:00Z`));
export const shortMonthLabel=(month:string)=>new Intl.DateTimeFormat('fr-FR',{month:'short',timeZone:'UTC'}).format(new Date(`${month}-01T00:00:00Z`)).replace('.','');

// ── Activity classification (closed table, first match wins) ───────────────────────────────────────────────────────────
export type ActivityKey='DELIVERY'|'REAL_ESTATE'|'HOLDING'|'FOOD'|'CONSTRUCTION'|'TRANSPORT'|'ONLINE_RETAIL'|'DIGITAL'|'BEAUTY'|'HEALTH'|'SERVICES'|'RETAIL'|'OTHER'|'NO_ACTIVITY';
export const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’']/g,' ');
export const ACTIVITY_RULES:ReadonlyArray<{key:Exclude<ActivityKey,'OTHER'|'NO_ACTIVITY'>;label:string;words:string;match:RegExp}>=[
 {key:'DELIVERY',label:'Livraison et coursiers à vélo',words:'livraison ou coursier à vélo, livreur non motorisé',match:/(?:livr|coursier).{0,80}(?:velo|non motoris)|(?:velo|non motoris).{0,40}livr|livreur non motoris/},
 {key:'REAL_ESTATE',label:'Immobilier (sociétés civiles, gestion, transactions)',words:'immobilier, immeuble, location de biens, marchand de biens',match:/immobili|immeuble|marchand de biens|location de biens|biens et droits/},
 {key:'HOLDING',label:'Holdings et gestion de participations',words:'holding, prise de participations, valeurs mobilières, titres de sociétés',match:/holding|prises? de participation|valeurs mobilieres|titres de societes|gestion de portefeuille/},
 {key:'FOOD',label:'Restauration et métiers de bouche',words:'restauration, traiteur, snack, pizzeria, boulangerie, bar, food truck',match:/restaura|traiteur|snack|pizz|boulang|patiss|food ?truck|brasserie|kebab|burger|\bbar\b|debit de boissons|cuisin/},
 {key:'CONSTRUCTION',label:'Bâtiment et travaux',words:'travaux, bâtiment, maçonnerie, plomberie, électricité, peinture, menuiserie',match:/travaux|batiment|macon|plomb|electricit|peintur|menuis|renovation|couverture|platr|carrel|terrassement|charpent|isolation|chauffag|climatis|second oeuvre|gros oeuvre/},
 {key:'TRANSPORT',label:'Transport, logistique et véhicules',words:'transport, VTC, taxi, logistique, déménagement, véhicules',match:/transport|\bvtc\b|taxi|logistique|demenag|convoyage|vehicule|automobile|garage/},
 {key:'ONLINE_RETAIL',label:'Commerce en ligne',words:'vente ou commerce en ligne, sur internet, à distance, marketplace',match:/(?:vente|vendre|commerce|achat|revente|commercialisation|distribution).{0,120}(?:en ligne|internet|a distance|e-commerce|electronique|marketplace)|e-commerce|marketplace/},
 {key:'DIGITAL',label:'Informatique, web et numérique',words:'informatique, logiciel, site internet, application, numérique',match:/informatique|logiciel|sites? (?:internet|web)|applications?|developpement web|numerique|digital|\bsaas\b|intelligence artificielle/},
 {key:'BEAUTY',label:'Beauté, coiffure et bien-être',words:'coiffure, esthétique, onglerie, massage, bien-être',match:/coiff|esthet|beaute|ongl|massage|bien-etre|barbier|tatou/},
 {key:'HEALTH',label:'Santé et pharmacie',words:'pharmacie, santé, médical',match:/pharmac|\bsante\b|medical|paramedical/},
 {key:'SERVICES',label:'Conseil et services aux entreprises',words:'conseil, consulting, formation, courtage, assurance, marketing, communication, évènementiel',match:/conseil|consult|formation|courtage|courtier|assurance|marketing|communication|evenementiel|evenement|prospection|apport d affaires|accompagnement/},
 {key:'RETAIL',label:'Commerce (détail, gros, négoce)',words:'commerce, vente, achat-revente, négoce, import-export, brocante',match:/commerce|vente|achat|negoce|import|distribution|boutique|magasin|brocante|revente/},
];
export const ACTIVITY_LABEL:Record<ActivityKey,string>={
 ...Object.fromEntries(ACTIVITY_RULES.map(r=>[r.key,r.label])) as Record<Exclude<ActivityKey,'OTHER'|'NO_ACTIVITY'>,string>,
 OTHER:'Autres activités',NO_ACTIVITY:'Sociétés sans activité déclarée',
};
export function classifyActivity(activity:string|null|undefined):ActivityKey{
 const text=fold(activity??'').replace(/\s+/g,' ').trim();
 if(!text)return 'OTHER';
 return ACTIVITY_RULES.find(r=>r.match.test(text))?.key??'OTHER';
}

// ── Notices ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type LegalKind='INDIVIDUAL'|'COMPANY'|'COMPANY_NO_ACTIVITY'|'OTHER';
export type CreationNotice={kind:LegalKind;activity:ActivityKey;commune:string|null};
type BodaccRow={ville?:unknown;acte?:unknown;listeetablissements?:unknown};
const parse=(v:unknown):unknown=>{if(typeof v!=='string'||!v.trim())return null;try{return JSON.parse(v)}catch{return null}};
export function legalKind(category:string|null|undefined):LegalKind{
 const c=fold(category??'');
 if(c.includes('personne physique'))return 'INDIVIDUAL';
 if(c.includes('personne morale'))return c.includes('sans activite')?'COMPANY_NO_ACTIVITY':'COMPANY';
 return 'OTHER';
}
export function noticeOf(row:BodaccRow):CreationNotice{
 const acte=parse(row.acte) as {creation?:{categorieCreation?:unknown}}|null;
 const category=typeof acte?.creation?.categorieCreation==='string'?acte.creation.categorieCreation:null;
 const kind=legalKind(category);
 const list=parse(row.listeetablissements) as {etablissement?:unknown}|null;
 const raw=list?.etablissement;
 const sites=(Array.isArray(raw)?raw:raw?[raw]:[]) as Array<{activite?:unknown;adresse?:{codePostal?:unknown}}>;
 const activityText=sites.map(s=>typeof s?.activite==='string'?s.activite:'').find(a=>a.trim())??null;
 const activity:ActivityKey=kind==='COMPANY_NO_ACTIVITY'&&!activityText?'NO_ACTIVITY':classifyActivity(activityText);
 const ville=typeof row.ville==='string'&&row.ville.trim()?row.ville.trim().replace(/\s+/g,' '):null;
 const postal=sites.map(s=>typeof s?.adresse?.codePostal==='string'?s.adresse.codePostal.trim():'').find(Boolean)??null;
 return {kind,activity,commune:ville?arrondissement(ville,postal)??ville:null};
}

// Paris, Lyon and Marseille are one commune each in the register: their arrondissement, read from the postal code of the
// same notice, is what tells a reader where things happen. Any other postal code leaves the commune as written.
const ARRONDISSEMENTS:Array<{city:string;postal:RegExp;max:number}>=[
 {city:'paris',postal:/^75(?:0(\d\d)|1(16))$/,max:20},{city:'lyon',postal:/^6900(\d)$/,max:9},{city:'marseille',postal:/^130(\d\d)$/,max:16},
];
export function arrondissement(ville:string,postal:string|null):string|null{
 const city=fold(ville).replace(/[^a-z]+/g,' ').trim().replace(/ \d.*$/,'');
 const rule=ARRONDISSEMENTS.find(a=>a.city===city);
 const m=rule&&postal?rule.postal.exec(postal):null;
 if(!rule||!m)return null;
 const n=Number(m[1]??(m[2]==='16'?16:NaN));
 if(!Number.isInteger(n)||n<1||n>rule.max)return null;
 return `${ville.replace(/\s+\d.*$/,'').trim()} ${n}${n===1?'er':'e'}`;
}

// ── Aggregation ────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Count<K extends string=string>={key:K;label:string;count:number;share:number};
export type MonthCount={month:string;count:number};
export type DepartmentCreations={
 department:CreationsDepartment;month:string;total:number;
 previous:MonthCount|null;lastYear:MonthCount|null;trend:MonthCount[];
 kinds:{individual:number;company:number;companyNoActivity:number;other:number};
 activities:Count<ActivityKey>[];communes:Count[];communesHidden:number;
 source:{dataset:string;query:string;retrievedAt:string};
};
const share=(n:number,total:number)=>total?n/total:0;
export function aggregate(notices:CreationNotice[]){
 const total=notices.length;
 const kinds={individual:0,company:0,companyNoActivity:0,other:0};
 for(const n of notices){if(n.kind==='INDIVIDUAL')kinds.individual++;else if(n.kind==='COMPANY')kinds.company++;else if(n.kind==='COMPANY_NO_ACTIVITY')kinds.companyNoActivity++;else kinds.other++}
 const byActivity=new Map<ActivityKey,number>();
 for(const n of notices)byActivity.set(n.activity,(byActivity.get(n.activity)??0)+1);
 // Largest first; "other" and "no activity" always last, whatever their size.
 const tail=(k:ActivityKey)=>k==='OTHER'||k==='NO_ACTIVITY'?1:0;
 const activities=[...byActivity].map(([key,count])=>({key,label:ACTIVITY_LABEL[key],count,share:share(count,total)}))
  .sort((a,b)=>tail(a.key)-tail(b.key)||b.count-a.count||a.label.localeCompare(b.label,'fr'));
 const byCommune=new Map<string,{label:string;count:number}>();
 for(const n of notices){if(!n.commune)continue;const k=fold(n.commune).replace(/[^a-z0-9]+/g,' ').trim();const e=byCommune.get(k);if(e)e.count++;else byCommune.set(k,{label:n.commune,count:1})}
 const ranked=[...byCommune].map(([key,v])=>({key,label:v.label,count:v.count,share:share(v.count,total)})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'fr'));
 const eligible=ranked.filter(c=>c.count>=MIN_COMMUNE_NOTICES);
 const communes=eligible.slice(0,TOP_COMMUNES);
 return {total,kinds,activities,communes,communesHidden:ranked.length-communes.length};
}

// ── BODACC queries ─────────────────────────────────────────────────────────────────────────────────────────────────────
export class CreationsUnavailableError extends Error{}
type Fetch=typeof fetch;
const MONTH=/^\d{4}-(?:0[1-9]|1[0-2])$/;
const DEPT=/^(?:\d{2}|2[AB]|97\d)$/;
const creationWhere=(scope:string,from:string,to:string)=>`familleavis="creation" and ${scope} and dateparution>=date'${monthStart(from)}' and dateparution<date'${monthStart(to)}'`;
const deptScope=(code:string)=>{if(!DEPT.test(code))throw new CreationsUnavailableError('INVALID_DEPARTMENT');return `numerodepartement="${code}"`};
const MONTH_KEY="date_format(dateparution,'yyyy-MM')";

export function monthlyCountsUrl(code:string,from:string,to:string):string{
 const u=new URL(`${BODACC_DATASET}/records`);
 // The group_by aliases are returned as fields: the select names only the count (an alias declared twice is refused).
 u.searchParams.set('select','count(*) as n');
 u.searchParams.set('where',creationWhere(deptScope(code),from,to));
 u.searchParams.set('group_by',`${MONTH_KEY} as mois`);
 u.searchParams.set('limit','100');
 return u.href;
}
// Counts per department and month for a set of departments (an explicit list of exact, validated codes — never a region
// name matched as text), or for the whole country when no list is given.
export function zoneCountsUrl(codes:readonly string[]|null,from:string,to:string):string{
 const u=new URL(`${BODACC_DATASET}/records`);
 u.searchParams.set('select','count(*) as n');
 u.searchParams.set('where',creationWhere(codes?`(${codes.map(deptScope).join(' or ')})`:'numerodepartement is not null',from,to));
 u.searchParams.set('group_by',`numerodepartement as dep, ${MONTH_KEY} as mois`);
 u.searchParams.set('limit','2000');
 return u.href;
}
// The fields needed to count — and nothing else: no trader name (commercant), no register number (registre), no people list.
export const EXPORT_FIELDS='ville,acte,listeetablissements';
export function monthExportUrl(code:string,month:string):string{
 const u=new URL(`${BODACC_DATASET}/exports/json`);
 u.searchParams.set('select',EXPORT_FIELDS);
 u.searchParams.set('where',creationWhere(deptScope(code),month,addMonths(month,1)));
 return u.href;
}

async function readBounded(res:Response,max:number):Promise<string>{
 const reader=res.body?.getReader();if(!reader)throw new CreationsUnavailableError('EMPTY_BODY');
 let total=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max)throw new CreationsUnavailableError('TOO_LARGE');chunks.push(value)}}
 finally{await reader.cancel().catch(()=>{})}
 const bytes=new Uint8Array(total);let o=0;for(const c of chunks){bytes.set(c,o);o+=c.length}
 return new TextDecoder().decode(bytes);
}
// One retry on a network failure (the register answers fine most of the time); an HTTP error is not retried.
export async function getBodaccJson(url:string,fetchImpl:Fetch,{timeoutMs,maxBytes}:{timeoutMs:number;maxBytes:number}):Promise<unknown>{
 if(!url.startsWith(`${BODACC_DATASET}/`))throw new CreationsUnavailableError('HOST_NOT_ALLOWED');
 for(let attempt=0;;attempt++){
  let res:Response;
  try{res=await fetchImpl(url,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)})}
  catch{if(attempt<1)continue;throw new CreationsUnavailableError('UNREACHABLE')}
  if(!res.ok)throw new CreationsUnavailableError(`HTTP_${res.status}`);
  const text=await readBounded(res,maxBytes);
  try{return JSON.parse(text)}catch{throw new CreationsUnavailableError('MALFORMED')}
 }
}
const resultsOf=(data:unknown):Record<string,unknown>[]=>{const r=(data as {results?:unknown})?.results;if(!Array.isArray(r))throw new CreationsUnavailableError('MALFORMED');return r as Record<string,unknown>[]};
const countOf=(v:unknown)=>{if(typeof v!=='number'||!Number.isInteger(v)||v<0)throw new CreationsUnavailableError('MALFORMED');return v};

// Every month of [from, to) gets a value: a month the register returns no row for really had no notice (count 0).
export function monthlySeries(rows:Record<string,unknown>[],from:string,to:string):MonthCount[]{
 const counts=new Map<string,number>();
 for(const r of rows){const m=r.mois;if(typeof m!=='string'||!MONTH.test(m))throw new CreationsUnavailableError('MALFORMED');counts.set(m,countOf(r.n))}
 const out:MonthCount[]=[];for(let m=from;m<to;m=addMonths(m,1))out.push({month:m,count:counts.get(m)??0});
 return out;
}

export async function fetchDepartmentCreations(department:CreationsDepartment,{fetchImpl=fetch,now=new Date()}:{fetchImpl?:Fetch;now?:Date}={}):Promise<DepartmentCreations>{
 const month=reportMonth(now),from=addMonths(month,-(TREND_MONTHS-1)),to=addMonths(month,1);
 const countsUrl=monthlyCountsUrl(department.code,from,to),exportUrl=monthExportUrl(department.code,month);
 const [counts,rows]=await Promise.all([
  getBodaccJson(countsUrl,fetchImpl,{timeoutMs:RECORDS_TIMEOUT_MS,maxBytes:MAX_RECORDS_BYTES}),
  getBodaccJson(exportUrl,fetchImpl,{timeoutMs:EXPORT_TIMEOUT_MS,maxBytes:MAX_EXPORT_BYTES}),
 ]);
 if(!Array.isArray(rows))throw new CreationsUnavailableError('MALFORMED');
 const trend=monthlySeries(resultsOf(counts),from,to);
 const stats=aggregate((rows as BodaccRow[]).map(noticeOf));
 // Both answers describe the same month: if they disagree, one of them is incomplete — never publish it.
 const fromCounts=trend[trend.length-1]!.count;
 if(fromCounts!==stats.total)throw new CreationsUnavailableError('INCONSISTENT');
 const find=(m:string)=>trend.find(t=>t.month===m)??null;
 return {department,month,...stats,previous:find(addMonths(month,-1)),lastYear:find(addMonths(month,-12)),trend,
  source:{dataset:BODACC_PUBLIC_PAGE,query:exportUrl,retrievedAt:now.toISOString()}};
}

export type ZoneRow={department:CreationsDepartment;count:number;previous:number;lastYear:number};
export type ZoneCreations={month:string;total:number;previous:MonthCount|null;lastYear:MonthCount|null;trend:MonthCount[];rows:ZoneRow[];source:{dataset:string;query:string;retrievedAt:string}};
// A region or the whole country: one grouped query (departments × 13 months). A department code the list does not know
// is left out, so the total is always the sum of the rows shown.
async function fetchZoneCreations(departments:readonly CreationsDepartment[],codes:readonly string[]|null,{fetchImpl=fetch,now=new Date()}:{fetchImpl?:Fetch;now?:Date}):Promise<ZoneCreations>{
 const month=reportMonth(now),from=addMonths(month,-(TREND_MONTHS-1)),to=addMonths(month,1);
 const url=zoneCountsUrl(codes,from,to);
 const counts=new Map<string,number>();
 for(const r of resultsOf(await getBodaccJson(url,fetchImpl,{timeoutMs:RECORDS_TIMEOUT_MS,maxBytes:MAX_RECORDS_BYTES}))){
  if(typeof r.dep!=='string'||typeof r.mois!=='string'||!MONTH.test(r.mois))throw new CreationsUnavailableError('MALFORMED');
  counts.set(`${r.dep}|${r.mois}`,countOf(r.n));
 }
 const at=(code:string,m:string)=>counts.get(`${code}|${m}`)??0;
 const rows=departments.map(department=>({department,count:at(department.code,month),previous:at(department.code,addMonths(month,-1)),lastYear:at(department.code,addMonths(month,-12))}))
  .sort((a,b)=>b.count-a.count||a.department.name.localeCompare(b.department.name,'fr'));
 const trend:MonthCount[]=[];for(let m=from;m<to;m=addMonths(m,1))trend.push({month:m,count:departments.reduce((s,d)=>s+at(d.code,m),0)});
 const total=trend[trend.length-1]!.count;
 if(!total)throw new CreationsUnavailableError('EMPTY');
 const find=(m:string)=>trend.find(t=>t.month===m)??null;
 return {month,total,previous:find(addMonths(month,-1)),lastYear:find(addMonths(month,-12)),trend,rows,source:{dataset:BODACC_PUBLIC_PAGE,query:url,retrievedAt:now.toISOString()}};
}
export const fetchRegionCreations=(region:CreationsRegion,opts:{fetchImpl?:Fetch;now?:Date}={})=>fetchZoneCreations(region.departments,region.departments.map(d=>d.code),opts);
export const fetchFranceCreations=(opts:{fetchImpl?:Fetch;now?:Date}={})=>fetchZoneCreations(CREATIONS_DEPARTMENTS,null,opts);

// The last 12 complete months of a trend (the 13-month series minus its first month): the yearly figure people search for.
export function last12Months(trend:readonly MonthCount[]):{total:number;from:string;to:string}|null{
 const months=trend.slice(-12);
 if(months.length<12)return null;
 return {total:months.reduce((s,m)=>s+m.count,0),from:months[0]!.month,to:months[months.length-1]!.month};
}

export const percentChange=(now:number,before:number|null|undefined)=>before?Math.round((now-before)/before*100):null;

// Sitemap: the hub, every region page and every department page. Their content changes when a month closes, so their date is the first day
// of the current month — a real data change, never the build date.
export function creationsSitemapEntries(siteUrl:string,now:Date){
 const lastModified=`${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-01`;
 return [CREATIONS_HUB,...CREATIONS_REGIONS.map(creationsPath),...CREATIONS_DEPARTMENTS.map(creationsPath)].map(path=>({url:`${siteUrl}/${path}`,lastModified,changeFrequency:'monthly' as const,priority:path===CREATIONS_HUB?.7:.6}));
}

// Page title within 75 characters: with the brand when it fits, then without it, then without the department code.
export function creationsTitle(place:string,code:string|null,month:string|null):string{
 const tail=month?` : ${month}`:' par département';
 const bases=[...(code?[`Créations d’entreprises ${place} (${code})${tail}`]:[]),`Créations d’entreprises ${place}${tail}`];
 const candidates=[...bases.map(b=>`${b} | ProspectOS`),...bases];
 return candidates.find(t=>t.length<=75)??bases[bases.length-1]!;
}
