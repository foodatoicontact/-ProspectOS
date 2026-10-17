// LEGACY_GEO_BACKFILL (NBA v1.3, canary 2): Signal-first signals stored before P4 carry no structured place
// (raw_metadata.location null, or a text with no department / region: "Vannes", "Ulis", "Connerré"…). Their place is
// re-read here with the SAME reader ingestion uses today (places.ts eventPlacesIn: geo-fr + communes introduced as a
// place), on the text already stored — the event sentence (excerpt) first, then the headline (title), as
// extract.ts locationOf does. Nothing is fetched, nothing is guessed: no place read → no change (UNKNOWN stays).
// Several departments read → all are kept, and the generic model says UNKNOWN (mixed places), never a choice.
// Pure and idempotent: a signal already backfilled, or already located, is never touched again. NBA never reads text.
import {eventPlacesIn} from './places.ts';
import type {EventLocation} from './extract.ts';

export const LEGACY_GEO_BACKFILL_VERSION='legacy-geo-v1';
export type LegacySignal={id:string;title:string;excerpt:string;raw_metadata:Record<string,unknown>|null};
export type LegacyGeoUpdate={id:string;location:EventLocation;provenance:{version:string;source:'excerpt'|'title';reader:string;previous:unknown;at:string}};

const located=(l:unknown)=>!!l&&typeof l==='object'&&(((l as EventLocation).departments?.length??0)>0||((l as EventLocation).regions?.length??0)>0);

export function legacyGeoUpdate(s:LegacySignal,now:Date):LegacyGeoUpdate|null{
 const meta=s.raw_metadata;
 if(!meta||meta.origin!=='signal_discovery')return null; // only Signal-first rows: the reader is theirs
 if(meta.location_backfill)return null;                  // idempotent
 if(located(meta.location))return null;                  // already structured: never overwritten
 const previous=meta.location??null;
 const previousText=previous&&typeof previous==='object'&&typeof (previous as EventLocation).text==='string'?(previous as EventLocation).text:null;
 for(const [source,text,basis] of [['excerpt',s.excerpt,'EVENT_MENTION'],['title',s.title,'HEADLINE_MENTION']] as const){
  const found=eventPlacesIn(text??'',{demonyms:basis==='EVENT_MENTION'});
  if(!found.departments.size&&!found.regions.size)continue;
  const location:EventLocation={text:(found.communes[0]??previousText??[...found.regions][0]??'').slice(0,80),
   departments:[...found.departments].sort().slice(0,10),regions:[...found.regions].sort().slice(0,5),basis};
  return {id:s.id,location,provenance:{version:LEGACY_GEO_BACKFILL_VERSION,source,reader:'signal-discovery/places.eventPlacesIn',previous,at:now.toISOString()}};
 }
 return null;
}

// One idempotent statement per update (run by an operator on the database, as a data migration): it applies only
// while the row is still un-backfilled, so running it twice changes nothing.
const lit=(v:unknown)=>`'${JSON.stringify(v).replace(/'/g,"''")}'::jsonb`;
export function legacyGeoSql(u:LegacyGeoUpdate):string{
 return `update public.signals set raw_metadata=raw_metadata||jsonb_build_object('location',${lit(u.location)},'location_backfill',${lit(u.provenance)})`
  +` where id='${u.id.replace(/[^0-9a-f-]/gi,'')}' and raw_metadata->>'origin'='signal_discovery' and raw_metadata->'location_backfill' is null;`;
}
