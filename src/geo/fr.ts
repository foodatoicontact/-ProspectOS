// France adapter: the Discovery gazetteer (src/discovery/geo-fr.ts — unchanged, still used as is by French Discovery)
// translated into the generic model. Codes are ISO 3166-2:FR: admin_area_level_1 = the region (FR-OCC…; an overseas
// department is its own region: FR-971…), admin_area_level_2 = the department (FR-31, FR-2A, FR-971…). Only this file
// knows that France has regions and departments.
import {DEPARTMENTS,REGIONS} from '../discovery/geo-fr.ts';
import {foldName,type GeoPlace} from './model.ts';

const REGION_ISO:Record<string,string>={
 'Auvergne-Rhône-Alpes':'FR-ARA','Bourgogne-Franche-Comté':'FR-BFC','Bretagne':'FR-BRE','Centre-Val de Loire':'FR-CVL','Corse':'FR-20R',
 'Grand Est':'FR-GES','Hauts-de-France':'FR-HDF','Île-de-France':'FR-IDF','Normandie':'FR-NOR','Nouvelle-Aquitaine':'FR-NAQ','Occitanie':'FR-OCC',
 'Pays de la Loire':'FR-PDL','Provence-Alpes-Côte d’Azur':'FR-PAC',
};
const departmentIso=(code:string)=>`FR-${code}`;
const OVERSEAS=new Set(['971','972','973','974','976']);
export function frRegionIso(region:string):string|null{
 if(REGION_ISO[region])return REGION_ISO[region];
 const d=DEPARTMENTS.find(x=>x.region===region&&OVERSEAS.has(x.code));
 return d?departmentIso(d.code):null;
}
export function frDepartmentPlace(code:string,locality?:string|null,label?:string|null):GeoPlace|null{
 const d=DEPARTMENTS.find(x=>x.code===code);if(!d)return null;
 const admin1=OVERSEAS.has(code)?departmentIso(code):REGION_ISO[d.region];if(!admin1)return null;
 return {country:'FR',admin_area_level_1:admin1,admin_area_level_2:departmentIso(code),locality:locality?foldName(locality):null,label:label??locality??d.name};
}

// Named places of France for the gazetteer: country, regions, departments, prefectures (as localities).
export function frGazetteer():{names:string[];place:GeoPlace}[]{
 const out:{names:string[];place:GeoPlace}[]=[{names:['France'],place:{country:'FR',label:'France'}}];
 for(const r of REGIONS){const iso=frRegionIso(r);if(iso)out.push({names:[r,...(r==='Île-de-France'?['Ile de France','Région parisienne']:r==='Provence-Alpes-Côte d’Azur'?['PACA']:[])],place:{country:'FR',admin_area_level_1:iso,label:r}})}
 for(const d of DEPARTMENTS){
  if(!OVERSEAS.has(d.code))out.push({names:[d.name],place:frDepartmentPlace(d.code,null,d.name)!});
  if(d.prefecture)out.push({names:[d.prefecture],place:frDepartmentPlace(d.code,d.prefecture,d.prefecture)!});
 }
 return out;
}

// The French place a Signal-first article named (raw_metadata.location: department codes, region names, the text):
// one place per department; the town only when the text IS that department's prefecture; region only otherwise.
export function frPlacesFromLegacyLocation(loc:{text?:unknown;departments?:unknown;regions?:unknown}):GeoPlace[]{
 const text=typeof loc.text==='string'?loc.text.trim():'';
 const departments=Array.isArray(loc.departments)?loc.departments.filter((d):d is string=>typeof d==='string'):[];
 const regions=Array.isArray(loc.regions)?loc.regions.filter((r):r is string=>typeof r==='string'):[];
 const places:GeoPlace[]=[];
 for(const code of departments){
  const d=DEPARTMENTS.find(x=>x.code===code);if(!d)continue;
  const isPrefecture=!!text&&foldName(text)===foldName(d.prefecture);
  const p=frDepartmentPlace(code,isPrefecture?d.prefecture:null,text||d.name);if(p)places.push(p);
 }
 if(!places.length)for(const r of regions){const iso=frRegionIso(r);if(iso)places.push({country:'FR',admin_area_level_1:iso,label:text||r})}
 return places;
}
