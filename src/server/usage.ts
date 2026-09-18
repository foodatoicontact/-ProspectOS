import {createAdminClient} from './admin-client';
import {resolveCost,costFromRequests,costFromTokens,type Provider,type Operation} from './pricing';
export interface RecordUsageInput {
 organizationId:string;projectId?:string|null;discoveryRunId?:string|null;userId:string;
 provider:Provider;operation:Operation;model?:string|null;
 requestCount?:number;inputTokens?:number|null;outputTokens?:number|null;
}
// Called exclusively from server code, exclusively for a call that ACTUALLY happened against a real
// (never fixture/TEST) provider. Writes through the admin/service-role client — no `authenticated`
// grant exists on api_usage_events or resolve_provider_cost at all (migration 009), so no logged-in
// client can ever reach this path, forge a usage row, or see a platform provider key. Best-effort: a
// failure here never blocks or rolls back the caller's real result — losing one cost-ledger row is
// strictly better than losing (or double-charging for) an already-delivered Discovery result.
export async function recordApiUsage(input:RecordUsageInput):Promise<void> {
 try {
  const admin=createAdminClient();
  const quantities=input.provider==='brave'?costFromRequests(input.requestCount??1):costFromTokens(input.inputTokens??null,input.outputTokens??null);
  const cost=await resolveCost(admin,input.provider,input.operation,input.model??null,quantities);
  const {error}=await admin.from('api_usage_events').insert({
   organization_id:input.organizationId,project_id:input.projectId??null,discovery_run_id:input.discoveryRunId??null,user_id:input.userId,
   provider:input.provider,operation:input.operation,model:input.model??null,billing_source:'PLATFORM',
   request_count:input.requestCount??1,input_tokens:input.inputTokens??null,output_tokens:input.outputTokens??null,
   estimated_cost_micros:cost?.estimatedCostMicros??null,pricing_version:cost?.pricingVersion??null,
  });
  if(error)console.error(JSON.stringify({component:'usage',error:'USAGE_WRITE_FAILED',detail:error.message}));
 } catch(e) {
  console.error(JSON.stringify({component:'usage',error:'USAGE_WRITE_FAILED',detail:e instanceof Error?e.message:String(e)}));
 }
}
