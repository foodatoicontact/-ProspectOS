// ZF1.1 — presentation only: how a French sentence says "in <place>" for the place label the engine stored
// (nba_actions.primary_detail.place: "Toulouse", "Hérault (34)", "Occitanie"…). The GEO model, its codes and its
// relevance are untouched; this only words a label. Departments and regions come from the existing gazetteer
// (src/discovery/geo-fr.ts); any other name is read as a town ("à …"). French only, like Today's card text.
import {DEPARTMENTS,REGIONS,foldPlace} from '../discovery/geo-fr.ts';

// "Hérault (34)" → "Hérault": the code stays in the stored data (and the advanced details), not in a sentence.
export const placeName=(place:string)=>place.replace(/\s*\((?:\d{2,3}|2[AB])\)\s*$/i,'').trim();

// Departments whose name is plural, or feminine and starting with a consonant (vowels and mute h take "l’" anyway).
const PLURAL=/^(Alpes|Ardennes|Bouches|Côtes|Deux|Hautes|Hauts|Landes|Pyrénées|Vosges|Yvelines)\b/;
const FEMININE=new Set(['Charente','Charente-Maritime','Corrèze','Corse-du-Sud','Côte-d’Or','Creuse','Dordogne','Drôme','Gironde','Loire',
 'Loire-Atlantique','Lozère','Manche','Marne','Mayenne','Meurthe-et-Moselle','Meuse','Moselle','Nièvre','Sarthe','Savoie','Seine-Maritime',
 'Seine-et-Marne','Seine-Saint-Denis','Somme','Vendée','Vienne']);
const ISLANDS_EN=new Set(['Guadeloupe','Martinique','Guyane']);
const REGION_PREP:Record<string,string>={'Grand Est':'dans le','Hauts-de-France':'dans les','Pays de la Loire':'dans les'};

const town=(name:string)=>/^Les /.test(name)?`aux ${name.slice(4)}`:/^Le /.test(name)?`au ${name.slice(3)}`:`à ${name}`;
function department(name:string):string{
 if(name==='Paris'||name==='Mayotte'||name==='La Réunion')return town(name);
 if(ISLANDS_EN.has(name))return `en ${name}`;
 if(PLURAL.test(name))return `dans les ${name}`;
 if(/^Haute-/.test(name))return `dans la ${name}`;       // aspirated h: no elision
 if(/^Haut-/.test(name))return `dans le ${name}`;
 if(/^[AEIOUYÉÈÊÀÂÎÔÛH]/.test(name))return `dans l’${name}`;
 return FEMININE.has(name)?`dans la ${name}`:`dans le ${name}`;
}

// "à Toulouse", "à Carcassonne", "dans l’Hérault", "dans la Haute-Garonne", "en Occitanie".
export function placePhrase(place:string):string{
 const name=placeName(place);const key=foldPlace(name);
 const dep=DEPARTMENTS.find(d=>foldPlace(d.name)===key);
 if(dep)return department(dep.name);
 const region=REGIONS.find(r=>foldPlace(r)===key);
 if(region)return `${REGION_PREP[region]??'en'} ${region}`;
 return town(name);
}
