// A teammate's identical search, reused (migration 022: same organization, same source and criteria, less than 7
// days, complete). The stored results are handed back to the NORMAL pipeline — re-validated by CandidateSchema,
// deduplicated against THIS project, novelty and review priority recomputed for it — so a reused result is never
// trusted more than a fresh one. No external request is sent: the report says 0 requests, and where it comes from.
import {CandidateSchema,type Candidate,type DiscoveryInput,type DiscoveryProvider,type ProviderSearchReport} from '../types.ts';
export type ReusedSource={run_id:string;by_email:string|null;started_at:string};
export class ReusedResultsProvider implements DiscoveryProvider {
 id:string;mode='live' as const;lastSearch?:ProviderSearchReport;private stored:unknown[];private source:ReusedSource;
 constructor(id:string,stored:unknown[],source:ReusedSource){this.id=id;this.stored=stored;this.source=source}
 async searchCompanies(_input:DiscoveryInput):Promise<unknown[]>{
  this.lastSearch={queries_planned:0,requests_sent:0,requests_failed:0,failure_codes:[],country:'FR',country_reason:'reused',reused_from:this.source};
  return this.stored;
 }
 async fetchCompanyDetails(candidate:Candidate){return candidate}
 normalizeResult(raw:unknown):Candidate{return CandidateSchema.parse(raw)}
}
