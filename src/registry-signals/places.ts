// Signaux SIRENE — Google Places API (New), Text Search: "name + address" of one register establishment, then the
// prudent match (match.ts). The key goes in the X-Goog-Api-Key header only: never in a URL, a log line or an error.
// The field mask asks only for what a signal shows. Responses are cached in memory only (Google Maps Platform terms:
// the place ID may be stored, the place's details may not): the database keeps place_id and the match status.
import type {RateLimiter} from './limiter.ts';
import {cacheKey,type ResponseCache} from './cache.ts';
import {matchPlace,type MatchResult,type PlaceCandidate,type RegistrySide} from './match.ts';
import {readBounded} from './sirene.ts';

export const PLACES_SEARCH_ENDPOINT='https://places.googleapis.com/v1/places:searchText';
export const PLACES_PROVENANCE='Google Places API (New)';
const FIELD_MASK=['places.id','places.displayName','places.formattedAddress','places.addressComponents','places.rating','places.userRatingCount',
 'places.websiteUri','places.regularOpeningHours.weekdayDescriptions','places.googleMapsUri','places.businessStatus'].join(',');
const RESULTS_PER_QUERY=5;
// At most this many names are tried for one establishment (sign or trade name first, then the legal name).
export const MAX_QUERIES_PER_ESTABLISHMENT=2;

type ApiPlace={id?:string;displayName?:{text?:string};formattedAddress?:string;addressComponents?:Array<{longText?:string;shortText?:string;types?:string[]}>;
 rating?:number;userRatingCount?:number;websiteUri?:string;regularOpeningHours?:{weekdayDescriptions?:string[]};googleMapsUri?:string;businessStatus?:string};
export type PlaceDetails=PlaceCandidate&{rating:number|null;ratingCount:number|null;website:string|null;openingHours:string[];mapsUrl:string};
export type PlacesLookup=MatchResult&{place:PlaceDetails|null;queries:string[];failure:string|null};

export const placeUrl=(placeId:string)=>`https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;

export function toPlace(p:ApiPlace):PlaceDetails|null{
 const id=p.id?.trim();const name=p.displayName?.text?.trim();if(!id||!name)return null;
 const component=(type:string)=>p.addressComponents?.find(c=>c.types?.includes(type))?.longText??null;
 const site=typeof p.websiteUri==='string'&&/^https?:\/\/\S+$/.test(p.websiteUri)?p.websiteUri:null;
 return {id,name,formattedAddress:p.formattedAddress??null,postalCode:component('postal_code'),streetNumber:component('street_number'),route:component('route'),
  businessStatus:p.businessStatus??null,rating:typeof p.rating==='number'?p.rating:null,ratingCount:typeof p.userRatingCount==='number'?p.userRatingCount:null,
  website:site,openingHours:(p.regularOpeningHours?.weekdayDescriptions??[]).filter(d=>typeof d==='string').slice(0,7),
  mapsUrl:typeof p.googleMapsUri==='string'&&/^https:\/\/\S+$/.test(p.googleMapsUri)?p.googleMapsUri:placeUrl(id)};
}

export type PlacesDeps={apiKey:string;limiter:RateLimiter;cache:ResponseCache;ttlSeconds:number;fetch?:typeof fetch;timeoutMs?:number};

async function searchText(query:string,deps:PlacesDeps):Promise<{places:PlaceDetails[];failure:string|null;cached:boolean}>{
 const key=cacheKey('places',query);
 const hit=await deps.cache.get(key) as PlaceDetails[]|undefined;if(hit)return {places:hit,failure:null,cached:true};
 const request=deps.fetch??fetch;let res:Response;
 try{res=await deps.limiter.send(()=>request(PLACES_SEARCH_ENDPOINT,{method:'POST',signal:AbortSignal.timeout(deps.timeoutMs??10000),redirect:'error',
  headers:{'content-type':'application/json','x-goog-api-key':deps.apiKey,'x-goog-fieldmask':FIELD_MASK},
  body:JSON.stringify({textQuery:query,languageCode:'fr',regionCode:'FR',pageSize:RESULTS_PER_QUERY})}))}
 catch(e){const name=(e as {name?:string})?.name;return {places:[],failure:name==='TimeoutError'||name==='AbortError'?'PLACES_TIMEOUT':'PLACES_NETWORK_ERROR',cached:false}}
 if(!res.ok){await res.body?.cancel().catch(()=>{});return {places:[],failure:`PLACES_HTTP_${res.status}`,cached:false}}
 let body:{places?:ApiPlace[]};
 try{body=await readBounded(res,'PLACES',500_000) as typeof body}catch(e){return {places:[],failure:(e as Error).message,cached:false}}
 const places=(Array.isArray(body?.places)?body.places:[]).map(toPlace).filter((p):p is PlaceDetails=>!!p);
 await deps.cache.set(key,places,deps.ttlSeconds);
 return {places,failure:null,cached:false};
}

// The query of one name: "<name>, <register address>". The address already carries its postal code and commune.
export const placesQuery=(name:string,address:string)=>`${name}, ${address}`.replace(/\s+/g,' ').trim().slice(0,250);

// `queryNames`: the names to search, in order (signs first, legal name last); every name of `registry` counts for the match.
export async function lookupPlace(registry:RegistrySide,queryNames:readonly string[],deps:PlacesDeps):Promise<PlacesLookup>{
 if(!deps.apiKey)throw Error('PLACES_NOT_CONFIGURED');
 const queries:string[]=[];let last:PlacesLookup={status:'absent',reason:'NO_RESULT',place:null,queries,failure:null};
 for(const name of queryNames.filter(Boolean).slice(0,MAX_QUERIES_PER_ESTABLISHMENT)){
  const query=placesQuery(name,registry.address??'');queries.push(query);
  const found=await searchText(query,deps);
  if(found.failure)return {...last,failure:found.failure};
  const m=matchPlace(registry,found.places);
  const place=m.place?found.places.find(p=>p.id===m.place!.id)??null:null;
  // A place found that does not match clearly is a stronger answer than no result: never replaced by a later "absent".
  if(m.status!=='absent'||last.status==='absent')last={...m,place,queries,failure:null};
  if(m.status==='confirme')return last;
 }
 return last;
}

// Place Details by place ID (the only Google datum stored): read live when a person reviews a candidate, never stored.
export const PLACE_ID=/^[A-Za-z0-9_-]{10,300}$/;
const DETAILS_FIELD_MASK=FIELD_MASK.split(',').map(f=>f.replace(/^places\./,'')).join(',');
export async function placeDetails(placeId:string,deps:PlacesDeps):Promise<PlaceDetails>{
 if(!deps.apiKey)throw Error('PLACES_NOT_CONFIGURED');
 if(!PLACE_ID.test(placeId))throw Error('INVALID_PLACE_ID');
 const key=cacheKey('places-details',placeId);
 const hit=await deps.cache.get(key) as PlaceDetails|undefined;if(hit)return hit;
 const request=deps.fetch??fetch;let res:Response;
 try{res=await deps.limiter.send(()=>request(`https://places.googleapis.com/v1/places/${placeId}?languageCode=fr&regionCode=FR`,{signal:AbortSignal.timeout(deps.timeoutMs??10000),
  redirect:'error',headers:{'x-goog-api-key':deps.apiKey,'x-goog-fieldmask':DETAILS_FIELD_MASK}}))}
 catch(e){const name=(e as {name?:string})?.name;throw Error(name==='TimeoutError'||name==='AbortError'?'PLACES_TIMEOUT':'PLACES_NETWORK_ERROR')}
 if(!res.ok){await res.body?.cancel().catch(()=>{});throw Error(`PLACES_HTTP_${res.status}`)}
 const place=toPlace(await readBounded(res,'PLACES',200_000) as ApiPlace);
 if(!place)throw Error('PLACES_INVALID_RESPONSE');
 await deps.cache.set(key,place,deps.ttlSeconds);
 return place;
}
