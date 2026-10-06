import type {SupabaseClient} from '@supabase/supabase-js';
// FIT estimé: the estimate weighs each piece of evidence by its source (fit-estimate.ts evidenceConfidence). The source
// is the one of the observation that proposed it (prospect_observations.source_type, read under RLS like everything
// else). Best-effort: if it cannot be read, evidence is returned unchanged and counts as typed by hand (70 %).
type WithEvidence={evidence?:{id:string}[]|null};
const CHUNK=100;
export async function attachEvidenceSources<T extends WithEvidence>(db:SupabaseClient,prospects:T[]):Promise<T[]>{
 const ids=prospects.flatMap(p=>(p.evidence??[]).map(e=>e.id));
 if(!ids.length)return prospects;
 const source=new Map<string,string>();
 for(let i=0;i<ids.length;i+=CHUNK){
  const {data,error}=await db.from('prospect_observations').select('evidence_id,source_type').in('evidence_id',ids.slice(i,i+CHUNK));
  if(error)return prospects;
  for(const r of (data??[]) as {evidence_id:string|null;source_type:string}[])if(r.evidence_id)source.set(r.evidence_id,r.source_type);
 }
 return prospects.map(p=>({...p,evidence:(p.evidence??[]).map(e=>({...e,source_type:source.get(e.id)??null}))}));
}
