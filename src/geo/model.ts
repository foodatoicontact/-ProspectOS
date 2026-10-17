// Generic geography — France AND international. A place is a path in a country's own administrative tree:
//   country (ISO 3166-1 alpha-2) > admin_area_level_1 > admin_area_level_2 > locality (+ postal_code)
// Admin levels are opaque codes (ISO 3166-2 where one exists: FR-OCC, FR-31, BE-BRU, ES-CT, ES-B, MA-06): no business
// rule here knows what a French "région" or "département" is. Country adapters (src/geo/fr.ts…) translate their own
// data into this model; providers keep their country-specific identifiers (SIREN, SIRET, NAF…) as their own attributes.
//
// Containment is level by level, from the country down, and NEVER a text search: a scope place contains a place when
// every level the scope defines is equal; a level the scope defines but the place does not know makes it UNKNOWN.
export type GeoPlace={
 country:string;
 admin_area_level_1?:string|null;
 admin_area_level_2?:string|null;
 // Folded name of the town (no accents, lower case, single spaces): compared by equality only, under equal parents.
 locality?:string|null;
 postal_code?:string|null;
 // What a person reads ("Toulouse", "Catalogne"): display only, never compared.
 label?:string|null;
};
export type GeoRelevance='MATCH'|'MISMATCH'|'UNKNOWN';
export type GeoRelevanceReason='in_scope'|'outside_scope'|'scope_undefined'|'place_unknown'|'insufficient_precision'|'mixed_places';

export const foldName=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’'`]/g,' ').replace(/[-_.]+/g,' ').toLowerCase().replace(/\s+/g,' ').trim();
const LEVELS=['country','admin_area_level_1','admin_area_level_2','locality'] as const;

export function isGeoPlace(v:unknown):v is GeoPlace{
 if(!v||typeof v!=='object')return false;
 const p=v as Record<string,unknown>;
 if(typeof p.country!=='string'||!/^[A-Z]{2}$/.test(p.country))return false;
 for(const k of ['admin_area_level_1','admin_area_level_2','locality','postal_code','label'])if(p[k]!==undefined&&p[k]!==null&&typeof p[k]!=='string')return false;
 return true;
}
export function geoPlace(p:GeoPlace):GeoPlace{
 return {country:p.country,admin_area_level_1:p.admin_area_level_1??null,admin_area_level_2:p.admin_area_level_2??null,
  locality:p.locality?foldName(p.locality):null,postal_code:p.postal_code?.replace(/\s+/g,'')||null,label:p.label??null};
}

// 'in' | 'out' | 'unknown' for one place against one scope place.
export function containment(scope:GeoPlace,place:GeoPlace):'in'|'out'|'unknown'{
 const s=geoPlace(scope),p=geoPlace(place);
 for(const level of LEVELS){
  const want=s[level];
  if(!want)return s.postal_code?postal(s,p):'in';
  const have=p[level];
  if(!have)return 'unknown';
  if(want!==have)return 'out';
 }
 return s.postal_code?postal(s,p):'in';
}
function postal(s:GeoPlace,p:GeoPlace):'in'|'out'|'unknown'{
 if(!p.postal_code)return 'unknown';
 return p.postal_code===s.postal_code?'in':'out';
}

// A signal may name several places; the scope may have several places (union).
//   MATCH     every place of the signal is inside the scope;
//   MISMATCH  every place of the signal is known and outside every scope place;
//   UNKNOWN   no scope, no place, a level the scope needs is missing, or the places disagree — never promoted to MATCH.
export function relevanceOf(places:GeoPlace[],scope:GeoPlace[]):{relevance:GeoRelevance;reason:GeoRelevanceReason}{
 if(!scope.length)return {relevance:'UNKNOWN',reason:'scope_undefined'};
 if(!places.length)return {relevance:'UNKNOWN',reason:'place_unknown'};
 const each=places.map(p=>{const r=scope.map(s=>containment(s,p));return r.includes('in')?'in':r.every(x=>x==='out')?'out':'unknown'});
 if(each.every(x=>x==='in'))return {relevance:'MATCH',reason:'in_scope'};
 if(each.every(x=>x==='out'))return {relevance:'MISMATCH',reason:'outside_scope'};
 if(each.includes('in')&&each.includes('out'))return {relevance:'UNKNOWN',reason:'mixed_places'};
 return {relevance:'UNKNOWN',reason:'insufficient_precision'};
}

export const placeLabel=(p:GeoPlace)=>p.label??[p.locality,p.admin_area_level_2,p.admin_area_level_1,p.country].find(Boolean)??'—';
