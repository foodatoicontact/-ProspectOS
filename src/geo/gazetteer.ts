// Resolving what a person typed (an ICP location) into generic places. Exact names only — a whole part of the label
// equal to a known name, never a word found inside a longer text. A name borne by two different places is ambiguous:
// nothing is resolved (UNKNOWN later), never a guess.
//
// Coverage today: every country name below (ISO 3166-1), all of France through the France adapter (regions,
// departments, prefectures), and a small seed of foreign areas and towns. This seed is reference data, not a provider:
// nothing here searches, calls a registry or activates a country. A future country adapter adds its own names the
// same way France does (src/geo/fr.ts).
import {foldName,type GeoPlace} from './model.ts';
import {frGazetteer} from './fr.ts';

type Entry={names:string[];place:GeoPlace};
const COUNTRIES:Entry[]=([
 ['FR',['France']],['BE',['Belgique','Belgium','België','Belgien']],['ES',['Espagne','Spain','España']],['MA',['Maroc','Morocco','المغرب']],
 ['CH',['Suisse','Switzerland','Schweiz','Svizzera']],['LU',['Luxembourg']],['DE',['Allemagne','Germany','Deutschland']],['IT',['Italie','Italy','Italia']],
 ['PT',['Portugal']],['GB',['Royaume-Uni','United Kingdom','Grande-Bretagne']],['NL',['Pays-Bas','Netherlands','Nederland']],['IE',['Irlande','Ireland']],
 ['US',['États-Unis','United States','USA']],['CA',['Canada']],['TN',['Tunisie','Tunisia']],['DZ',['Algérie','Algeria']],['SN',['Sénégal','Senegal']],
 ['CI',['Côte d’Ivoire','Cote d’Ivoire','Ivory Coast']],['MC',['Monaco']],
] as [string,string[]][]).map(([country,names])=>({names,place:{country,label:names[0]}}));
// Seed of foreign areas (ISO 3166-2) and towns. Belgium: Brussels-Capital is a region without province.
const FOREIGN:Entry[]=[
 {names:['Bruxelles-Capitale','Région de Bruxelles-Capitale','Brussels-Capital Region','Brussels Hoofdstedelijk Gewest'],place:{country:'BE',admin_area_level_1:'BE-BRU',label:'Bruxelles-Capitale'}},
 {names:['Bruxelles','Brussels','Brussel'],place:{country:'BE',admin_area_level_1:'BE-BRU',locality:'bruxelles',label:'Bruxelles'}},
 {names:['Wallonie','Wallonia'],place:{country:'BE',admin_area_level_1:'BE-WAL',label:'Wallonie'}},
 {names:['Flandre','Flanders','Vlaanderen'],place:{country:'BE',admin_area_level_1:'BE-VLG',label:'Flandre'}},
 {names:['Liège','Luik'],place:{country:'BE',admin_area_level_1:'BE-WAL',admin_area_level_2:'BE-WLG',locality:'liege',label:'Liège'}},
 {names:['Anvers','Antwerpen','Antwerp'],place:{country:'BE',admin_area_level_1:'BE-VLG',admin_area_level_2:'BE-VAN',locality:'antwerpen',label:'Anvers'}},
 {names:['Catalogne','Cataluña','Catalunya','Catalonia'],place:{country:'ES',admin_area_level_1:'ES-CT',label:'Catalogne'}},
 {names:['Barcelone','Barcelona'],place:{country:'ES',admin_area_level_1:'ES-CT',admin_area_level_2:'ES-B',locality:'barcelona',label:'Barcelone'}},
 {names:['Communauté de Madrid','Comunidad de Madrid'],place:{country:'ES',admin_area_level_1:'ES-MD',label:'Communauté de Madrid'}},
 {names:['Madrid'],place:{country:'ES',admin_area_level_1:'ES-MD',admin_area_level_2:'ES-M',locality:'madrid',label:'Madrid'}},
 {names:['Casablanca-Settat'],place:{country:'MA',admin_area_level_1:'MA-06',label:'Casablanca-Settat'}},
 {names:['Casablanca'],place:{country:'MA',admin_area_level_1:'MA-06',locality:'casablanca',label:'Casablanca'}},
 {names:['Rabat-Salé-Kénitra'],place:{country:'MA',admin_area_level_1:'MA-04',label:'Rabat-Salé-Kénitra'}},
 {names:['Rabat'],place:{country:'MA',admin_area_level_1:'MA-04',locality:'rabat',label:'Rabat'}},
];
const INDEX=new Map<string,GeoPlace[]>();
for(const e of [...COUNTRIES,...frGazetteer(),...FOREIGN])for(const n of e.names){const k=foldName(n);const list=INDEX.get(k)??[];list.push(e.place);INDEX.set(k,list)}
const sameMeaning=(a:GeoPlace,b:GeoPlace)=>a.country===b.country&&(a.admin_area_level_1??null)===(b.admin_area_level_1??null)&&(a.admin_area_level_2??null)===(b.admin_area_level_2??null)&&(a.locality??null)===(b.locality??null);

// One name → one place, or null (unknown or ambiguous). Homonyms on one chain ("Paris": the department and its town)
// resolve to the broader place; homonyms in different places are ambiguous.
export function placeNamed(name:string):GeoPlace|null{
 const found=(INDEX.get(foldName(name))??[]).filter((p,i,all)=>all.findIndex(q=>sameMeaning(p,q))===i);
 if(found.length===1)return found[0]!;
 const broad=found.find(a=>found.every(b=>ancestorOf(a,b)));
 return broad??null;
}
function ancestorOf(a:GeoPlace,b:GeoPlace):boolean{return a.country===b.country&&(!a.admin_area_level_1||a.admin_area_level_1===b.admin_area_level_1)
 &&(!a.admin_area_level_2||a.admin_area_level_2===b.admin_area_level_2)&&(!a.locality||a.locality===b.locality)}
// One ICP location label → places. "France / Occitanie / Toulouse" or "Espagne > Catalogne" is a path: when its parts
// form one chain, the most precise place is kept; parts that do not chain stay separate places. A part that is not a
// known name makes the whole label unresolved (never a partial guess).
export function resolveLabel(label:string):GeoPlace[]{
 const parts=label.split(/\s*(?:\/|>|›|»|\|)\s*/).map(p=>p.trim()).filter(Boolean);
 if(!parts.length)return [];
 const places=parts.map(placeNamed);
 if(places.some(p=>!p))return [];
 const list=places as GeoPlace[];
 const chained=list.every(a=>list.every(b=>ancestorOf(a,b)||ancestorOf(b,a)));
 if(chained)return [list.reduce((deep,p)=>ancestorOf(deep,p)?p:deep)];
 return list;
}
export function resolveScope(labels:string[]):GeoPlace[]{return labels.flatMap(resolveLabel)}
