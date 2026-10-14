// Signal-first Discovery V1 (P4) — where an event happens, read from what the search result writes. Deterministic, no
// network. Extends the Discovery gazetteer (geo-fr: departments, regions, prefectures, postal codes) with the communes
// of 2,000 inhabitants or more (communes-fr.ts, INSEE via Etalab), read ONLY from a capitalized name the sentence
// introduces as a place ("à Coutances", "au Crès", "aux Ulis", "dans la commune de Castelnaudary") — never from a
// bare word anywhere in the text, so a company named like a town is never turned into a place.
//
// Canary #1 (Occitanie, "restaurant"): Coutances, Loudéac, Connerré, Le Crès, Castelnaudary, Les Ulis… were unknown
// to the prefecture-only gazetteer, so off-zone openings stayed UNKNOWN (shown for review) instead of OUT, and the
// same opening read "Crès" on one source and "Hérault (34)" on another was never grouped.
import {DEPARTMENTS,foldPlace,placesIn,type PlaceSet} from '../discovery/geo-fr.ts';
import {COMMUNES_FR} from './communes-fr.ts';

const COMMUNES=new Map<string,string>(COMMUNES_FR.split('\n').map(l=>{const [n,d]=l.split('|');return [n!,d!] as [string,string]}));
const REGION_OF=new Map(DEPARTMENTS.map(d=>[d.code,d.region]));

// The department of a commune written as a name, exactly as written (its article included: "Le Crès", "Les Ulis").
// No article is ever added here — only the contraction the text wrote is undone by the reader ("au Mans" → "Le
// Mans"): "dans le Val-d'Oise" must never become the commune "Le Val". null when unknown or ambiguous.
export function communeDepartment(name:string):string|null{
 const f=foldPlace(name);
 if(f.replace(/^(?:l|la|le|les) /,'').length<3)return null;
 return COMMUNES.get(f)??null;
}

// Adjectives of the main cities ("la métropole montpelliéraine", "l'agglomération toulousaine"): read only in the
// event's own clause, after the event verb — never "le groupe toulousain X ouvre à Lyon" (that is the head office).
const DEMONYMS:Array<[RegExp,string]>=[
 [/\btoulousain(?:e|s|es)?\b/,'31'],[/\bmontpellierain(?:e|s|es)?\b/,'34'],[/\bnimois(?:e|es)?\b/,'30'],[/\bperpignanais(?:e|es)?\b/,'66'],
 [/\bbiterrois(?:e|es)?\b/,'34'],[/\bcarcassonnais(?:e|es)?\b/,'11'],[/\balbigeois(?:e|es)?\b/,'81'],[/\bmontalbanais(?:e|es)?\b/,'82'],
 [/\blyonnais(?:e|es)?\b/,'69'],[/\bmarseillais(?:e|es)?\b/,'13'],[/\bbordelais(?:e|es)?\b/,'33'],[/\bnantais(?:e|es)?\b/,'44'],
 [/\blillois(?:e|es)?\b/,'59'],[/\brennais(?:e|es)?\b/,'35'],[/\bstrasbourgeois(?:e|es)?\b/,'67'],[/\bgrenoblois(?:e|es)?\b/,'38'],
 [/\bparisien(?:ne|s|nes)?\b/,'75'],[/\bnicois(?:e|es)?\b/,'06'],
];
// Only after a word of place ("la métropole montpelliéraine"), never "le chef toulousain".
const DEMONYM_CONTEXT=/\b(?:metropole|agglomeration|agglo|banlieue|region|peripherie|ville|cite|capitale|campagne|zone|centre ville)\s+(?:\w+\s+)?$/;

// Capitalized names introduced as a place. "de X" only after a word of place ("commune de", "près de", "aux portes
// de"), so "l'enseigne de Burger King" is never a place.
// A whole name: "Saint-Jean-de-Luz", "Val-d'Oise", "Le Crès"; it never stops in the middle of a hyphenated name.
const PLACE_NAME="[A-ZÀ-Ý][\\p{L}]*(?:['’][A-ZÀ-Ý][\\p{L}]*)?(?:[- ](?:(?:sur|sous|en|de|du|des|les|la|le|aux|et|lès|lez)[- ]|[dl]['’])?[A-ZÀ-Ý][\\p{L}]*(?:['’][A-ZÀ-Ý][\\p{L}]*)?)*";
const PLACE_WORD="commune|ville|village|bourg|cité|quartier|zone(?: commerciale| d'activités?| d’activités?)?|près|proche|portes|périphérie|centre-ville|agglomération|métropole|environs|banlieue";
const INTRODUCED=new RegExp(`(?:^|[\\s(])(?:(à|a|au|aux|en|sur|dans)\\s+|(?:${PLACE_WORD})\\s+(de|d'|d’|du|des)\\s*)(l'|l’|la |le |les )?(${PLACE_NAME})(?![\\p{L}'’-])`,'gu');

// Departments geo-fr never reads by name because the name is also a common word ("Eure", "Var", "Nord", "Lot"…):
// read here only as "dans" + the department's article + the capitalized name ("dans l'Eure", "dans le Var").
const ARTICLED_DEPARTMENTS:Record<string,string>={"l'Ain":'01',"l'Aube":'10','le Cher':'18',"l'Eure":'27','le Gard':'30',"l'Indre":'36','le Jura':'39',
 'le Lot':'46','la Manche':'50','la Marne':'51','la Meuse':'55','le Nord':'59',"l'Orne":'61','la Somme':'80','le Var':'83','la Vienne':'86'};
const ARTICLED=new RegExp(`(?:^|\\s)dans (${Object.keys(ARTICLED_DEPARTMENTS).map(k=>k.replace("'","['’]")).join('|')})(?![\\p{L}'’-])`,'gu');

export type EventPlaces=PlaceSet&{communes:string[]};

// Every place the text writes: geo-fr's (postal code, "(34)", department, region, prefecture) plus the communes it
// introduces as places. Departments and regions as codes / names, communes as written.
export function eventPlacesIn(text:string,opts:{demonyms?:boolean}={}):EventPlaces{
 // geo-fr reads a name only between spaces: "à Albi." or "le Val-d'Oise," would be missed. The punctuation is read
 // as a space here (parentheses kept: "(34)" is a department code), geo-fr itself is unchanged.
 const base=placesIn(text),spaced=placesIn(text.replace(/[.,;:!?…«»"“”]/g,' '));
 const out:EventPlaces={departments:new Set([...base.departments,...spaced.departments]),regions:new Set([...base.regions,...spaced.regions]),communes:[]};
 for(const m of text.normalize('NFC').matchAll(INTRODUCED)){
  const prep=(m[1]??m[2]??'').toLowerCase();
  const article=m[3]?m[3].replace(/’/,"'"):'';
  const raw=m[4]!;
  // A department or a region read by geo-fr is not a commune ("dans le Val-d'Oise", "en Haute-Garonne").
  if(placesIn(raw).departments.size||placesIn(raw).regions.size)continue;
  const written=article?`${article[0]!.toUpperCase()}${article.slice(1)}${article.endsWith("'")?'':' '}${raw}`.replace(/\s+/g,' '):raw;
  const name=article?written:prep==='au'||prep==='du'?`Le ${raw}`:prep==='aux'||prep==='des'?`Les ${raw}`:raw;
  const dep=communeDepartment(name);
  if(!dep)continue;
  out.departments.add(dep);const r=REGION_OF.get(dep);if(r)out.regions.add(r);
  if(!out.communes.includes(name))out.communes.push(name);
 }
 for(const m of text.normalize('NFC').matchAll(ARTICLED)){
  const dep=ARTICLED_DEPARTMENTS[m[1]!.replace('’',"'")];if(!dep)continue;
  out.departments.add(dep);const r=REGION_OF.get(dep);if(r)out.regions.add(r);
 }
 if(opts.demonyms){
  const f=` ${foldPlace(text)} `;
  for(const [re,dep] of DEMONYMS){const m=re.exec(f);if(!m||!DEMONYM_CONTEXT.test(f.slice(0,m.index)))continue;out.departments.add(dep);const r=REGION_OF.get(dep);if(r)out.regions.add(r)}
 }
 return out;
}

// A name that is a commune of the gazetteer (or a geo-fr place): never an organization's name ("Jonzac, 3 800
// habitants, … son deuxième fast-food").
export const isCommuneName=(name:string)=>communeDepartment(name)!==null;
export const regionOfDepartment=(code:string)=>REGION_OF.get(code)??null;
