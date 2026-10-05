// The zone of a Discovery brief, as the register codes it: an INSEE region code (COG) or a department code. Only a
// region or a department written explicitly is read (geo-fr.ts) — an unknown place is null, never guessed.
import {DEPARTMENTS,REGIONS,foldPlace} from '../geo-fr.ts';
export type RegistryZone={kind:'region';code:string;label:string}|{kind:'department';code:string;label:string};

// INSEE region codes (Code officiel géographique).
const REGION_CODES:Record<string,string>={'Auvergne-Rhône-Alpes':'84','Bourgogne-Franche-Comté':'27','Bretagne':'53','Centre-Val de Loire':'24','Corse':'94','Grand Est':'44',
 'Hauts-de-France':'32','Île-de-France':'11','Normandie':'28','Nouvelle-Aquitaine':'75','Occitanie':'76','Pays de la Loire':'52','Provence-Alpes-Côte d’Azur':'93',
 'Guadeloupe':'01','Martinique':'02','Guyane':'03','La Réunion':'04','Mayotte':'06'};

export function resolveRegistryZone(location:string):RegistryZone|null{
 const folded=foldPlace(location);
 const region=REGIONS.find(r=>foldPlace(r)===folded);
 if(region&&REGION_CODES[region])return {kind:'region',code:REGION_CODES[region]!,label:region};
 const code=/\((\d{2,3}|2[AB])\)\s*$/i.exec(location.trim())?.[1]?.toUpperCase()??(/^(\d{2,3}|2[AB])$/i.test(location.trim())?location.trim().toUpperCase():null);
 const dept=code?DEPARTMENTS.find(d=>d.code===code):DEPARTMENTS.find(d=>foldPlace(d.name)===folded.replace(/\s*\(.*\)$/,''));
 return dept?{kind:'department',code:dept.code,label:dept.name}:null;
}

// Is a register place (region code, commune code) inside the zone?
export function inZone(zone:RegistryZone,place:{region?:string|null;commune?:string|null}):boolean{
 return zone.kind==='region'?place.region===zone.code:!!place.commune&&place.commune.toUpperCase().startsWith(zone.code);
}
