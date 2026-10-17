// LEGACY_GEO_BACKFILL — prints the idempotent SQL that re-locates old Signal-first signals (src/signal-discovery/
// legacy-geo.ts). Reads rows exported by an operator: a JSON array of {id,title,excerpt,raw_metadata} (e.g.
// `select json_agg(json_build_object('id',id,'title',title,'excerpt',excerpt,'raw_metadata',raw_metadata)) from
// public.signals where raw_metadata->>'origin'='signal_discovery'`). Writes nothing itself; prints a summary on stderr.
// Usage: node scripts/legacy-geo-backfill.ts rows.json > backfill.sql
import {readFileSync} from 'node:fs';
import {legacyGeoUpdate,legacyGeoSql,type LegacySignal} from '../src/signal-discovery/legacy-geo.ts';

const rows=JSON.parse(readFileSync(process.argv[2]!,'utf8')) as LegacySignal[];
const now=new Date();
let changed=0;
for(const r of rows){
 const u=legacyGeoUpdate(r,now);
 console.error(`${r.id} ${u?`→ ${u.location.departments.join(',')||'-'} / ${u.location.regions.join(',')||'-'} (${u.provenance.source})`:'unchanged'}`);
 if(u){console.log(legacyGeoSql(u));changed++}
}
console.error(`${changed}/${rows.length} signal(s) to re-locate`);
