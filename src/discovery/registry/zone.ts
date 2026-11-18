// The zone of a Discovery brief, as the register codes it: an INSEE region code (COG) or a department code. Only a
// region or a department written explicitly is read (geo-fr.ts) — an unknown place is null, never guessed.
import {DEPARTMENTS,REGIONS,foldPlace} from '../geo-fr.ts';
export type RegistryZone={kind:'region';code:string;label:string}|{kind:'department';code:string;label:string}|{kind:'departments';codes:string[];label:string};

// INSEE region codes (Code officiel géographique).
const REGION_CODES:Record<string,string>={'Auvergne-Rhône-Alpes':'84','Bourgogne-Franche-Comté':'27','Bretagne':'53','Centre-Val de Loire':'24','Corse':'94','Grand Est':'44',
 'Hauts-de-France':'32','Île-de-France':'11','Normandie':'28','Nouvelle-Aquitaine':'75','Occitanie':'76','Pays de la Loire':'52','Provence-Alpes-Côte d’Azur':'93',
 'Guadeloupe':'01','Martinique':'02','Guyane':'03','La Réunion':'04','Mayotte':'06'};

// Common short names of the regions (audit 2026-11-11, B4).
const REGION_ALIASES:Record<string,string>={paca:'Provence-Alpes-Côte d’Azur','sud paca':'Provence-Alpes-Côte d’Azur',sud:'Provence-Alpes-Côte d’Azur',
 ara:'Auvergne-Rhône-Alpes',aura:'Auvergne-Rhône-Alpes',idf:'Île-de-France',bfc:'Bourgogne-Franche-Comté',hdf:'Hauts-de-France',cvl:'Centre-Val de Loire',
 reunion:'La Réunion','ile de la reunion':'La Réunion'};
const MAX_DEPARTMENTS=40;
// One place: a region (its name, « région … », a short name), a department (name, number, « Nom (NN) ») or a prefecture
// (« Lyon » → Rhône). « France » and the words « région », « département » are dropped. Anything else: null, never guessed.
function resolveOne(raw:string):RegistryZone|null{
 const text=raw.trim().replace(/(?:\s*,\s*|\s+)france$/i,'').trim();
 const folded=foldPlace(text).replace(/^(la |le |l )?(region|departement)( de la| de l| du| des| de| d)?\s+/,'').trim();
 if(!folded)return null;
 const alias=REGION_ALIASES[folded];
 const region=alias??REGIONS.find(r=>foldPlace(r)===folded);
 if(region&&REGION_CODES[region])return {kind:'region',code:REGION_CODES[region]!,label:region};
 const code=/\((\d{2,3}|2[AB])\)\s*$/i.exec(text)?.[1]?.toUpperCase()??(/^(\d{2,3}|2[AB])$/i.test(text)?text.toUpperCase():null);
 const name=folded.replace(/\s*\(.*\)$/,'');
 const dept=code?DEPARTMENTS.find(d=>d.code===code):DEPARTMENTS.find(d=>foldPlace(d.name)===name)??DEPARTMENTS.find(d=>d.prefecture&&foldPlace(d.prefecture)===name);
 return dept?{kind:'department',code:dept.code,label:dept.name}:null;
}
const departmentsOf=(z:RegistryZone):string[]=>z.kind==='department'?[z.code]:z.kind==='departments'?z.codes:DEPARTMENTS.filter(d=>REGION_CODES[d.region]===z.code).map(d=>d.code);
// The zone of a brief: one place, or several separated by commas, « ; », « / », « + » or « et » — then the union of their
// departments (a region counts as all of its departments). One unknown place makes the whole zone unknown.
export function resolveRegistryZone(location:string):RegistryZone|null{
 const whole=resolveOne(location);if(whole)return whole;
 const parts=location.split(/\s*(?:[,;\/+]|\s+et\s+)\s*/i).map(x=>x.trim()).filter(Boolean).filter(x=>!/^france$/i.test(x));
 if(parts.length<2)return parts.length===1?resolveOne(parts[0]!):null;
 const zones=parts.map(resolveOne);if(zones.some(z=>!z))return null;
 const codes=[...new Set(zones.flatMap(z=>departmentsOf(z!)))];
 if(codes.length>MAX_DEPARTMENTS)return null;
 if(codes.length===1)return zones.find(z=>z!.kind==='department')!;
 return {kind:'departments',codes,label:zones.map(z=>z!.label).join(', ')};
}
// The departments of a zone written by a person (« Île-de-France », « Rhône, Isère », « 69 ») — for the sources that
// take department numbers only (BOAMP tenders). Null when the zone is unknown.
export function zoneDepartments(location:string):string[]|null{const z=resolveRegistryZone(location);return z?departmentsOf(z):null}

// Is a register place (region code, commune code) inside the zone?
export function inZone(zone:RegistryZone,place:{region?:string|null;commune?:string|null}):boolean{
 if(zone.kind==='region')return place.region===zone.code;
 const commune=(place.commune??'').toUpperCase();if(!commune)return false;
 return zone.kind==='department'?commune.startsWith(zone.code):zone.codes.some(c=>commune.startsWith(c));
}
