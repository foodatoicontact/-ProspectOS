// Signaux SIRENE — the ONE output format: one signal per establishment, every field with the URL(s) it was read from
// and its confidence ("verifie": read as is from that source; "estime": a rule's conclusion). Never a global score.
//  - Register fields are "verifie": read from the official register, source = the establishment's and the company's
//    pages on annuaire-entreprises.data.gouv.fr.
//  - statut_match is always "estime" (a matching rule decides it). Google values are given only for a CONFIRMED place,
//    "verifie" as read from Google, source = the place's Google Maps page; otherwise they are null and absent.
//  - The stored form (toStoredSignal) keeps place_id and the match only: Google content is never written to the database.
import type {RecentEstablishment} from './sirene.ts';
import {placeUrl,type PlacesLookup} from './places.ts';
import {fold} from './normalize.ts';
import {ANNUAIRE_PAGE} from './sirene.ts';

export type Confidence='verifie'|'estime';
export type GoogleSignal={place_id:string|null;note:number|null;nb_avis:number|null;site:string|null;horaires:string[];
 statut_match:'confirme'|'non_confirme'|'absent';raison_match:string;fiche:string|null};
export type RegistrySignal={siren:string;siret:string;denomination:string;enseignes:string[];activite_principale:string;date_creation:string;
 date_creation_entreprise:string|null;adresse:string;code_postal:string;commune:string|null;metier_probable:string|null;google:GoogleSignal;
 sources:Record<string,string[]>;confiance:Record<string,Confidence>;detecte_le:string};

// The trade a name suggests (paramedical preset): one of the preset's keywords read in a name, never a certainty.
export function probableTrade(names:readonly string[],keywords:readonly string[]):string|null{
 const words=new Set(names.flatMap(n=>fold(n).split(' ')));
 return keywords.map(k=>fold(k)).find(k=>words.has(k))??null;
}

export function buildSignal(e:RecentEstablishment,google:PlacesLookup|null,keywords:readonly string[],detectedAt:Date):RegistrySignal{
 const reg=[e.source_url,ANNUAIRE_PAGE(e.siren)];
 const sources:Record<string,string[]>={};const confiance:Record<string,Confidence>={};
 for(const f of ['siren','siret','denomination','activite_principale','date_creation','adresse','code_postal','commune'] as const){sources[f]=reg;confiance[f]='verifie'}
 if(e.signs.length){sources.enseignes=reg;confiance.enseignes='verifie'}
 if(e.date_creation_entreprise){sources.date_creation_entreprise=[ANNUAIRE_PAGE(e.siren)];confiance.date_creation_entreprise='verifie'}
 const trade=probableTrade(e.names,keywords);
 if(trade){sources.metier_probable=reg;confiance.metier_probable='estime'}
 const p=google?.status==='confirme'?google.place:null;
 const g:GoogleSignal={place_id:p?.id??null,note:p?.rating??null,nb_avis:p?.ratingCount??null,site:p?.website??null,horaires:p?.openingHours??[],
  statut_match:google?.status??'absent',raison_match:google?.failure??google?.reason??'PLACES_NOT_QUERIED',fiche:p?.mapsUrl??null};
 // The match is a rule's conclusion, drawn from both sources.
 sources['google.statut_match']=p?[...reg,p.mapsUrl]:reg;confiance['google.statut_match']='estime';
 if(p){
  for(const [f,v] of [['place_id',g.place_id],['note',g.note],['nb_avis',g.nb_avis],['site',g.site],['horaires',g.horaires.length?g.horaires:null]] as const){
   if(v===null)continue;sources[`google.${f}`]=[p.mapsUrl];confiance[`google.${f}`]='verifie';
  }
 }
 return {siren:e.siren,siret:e.siret,denomination:e.denomination,enseignes:e.signs,activite_principale:e.activite_principale,date_creation:e.date_creation,
  date_creation_entreprise:e.date_creation_entreprise,adresse:e.adresse,code_postal:e.code_postal,commune:e.commune,metier_probable:trade,google:g,
  sources,confiance,detecte_le:detectedAt.toISOString()};
}

// What the database keeps: everything from the register, and from Google only the place ID and the match.
export function toStoredSignal(s:RegistrySignal):RegistrySignal{
 const keep=new Set(['google.place_id','google.statut_match']);
 const strip=<T,>(r:Record<string,T>)=>Object.fromEntries(Object.entries(r).filter(([k])=>!k.startsWith('google.')||keep.has(k)));
 // The Maps link is rebuilt from the place ID alone: nothing else Google sent is kept.
 const fiche=s.google.place_id?placeUrl(s.google.place_id):null;
 const sources=strip(s.sources);for(const k of ['google.place_id','google.statut_match'])if(sources[k])sources[k]=sources[k]!.map(u=>u.startsWith('https://annuaire-entreprises.')?u:fiche??u);
 return {...s,google:{place_id:s.google.place_id,note:null,nb_avis:null,site:null,horaires:[],statut_match:s.google.statut_match,raison_match:s.google.raison_match,fiche},
  sources,confiance:strip(s.confiance)};
}
