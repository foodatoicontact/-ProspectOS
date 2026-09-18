import type {SupabaseClient} from '@supabase/supabase-js';
// Single source of truth for turning real provider usage into an integer micro-dollar cost. Never
// duplicate a `cost = 0.005`-style constant anywhere else — every call site imports resolveCost from
// here. prospectos_private.provider_pricing is never exposed to PostgREST (by design, same reason
// discovery quota settings live there too), so the actual lookup happens inside
// public.resolve_provider_cost (migration 009), a SECURITY DEFINER RPC not granted to any client role —
// only the admin/service-role client passed in here ever calls it.
export type Provider='brave'|'anthropic'|'openai';
export type Operation='search'|'offer_analysis';
export type UnitType='request'|'input_tokens_1k'|'output_tokens_1k';
export interface UsageQuantity {unit_type:UnitType;quantity:number}
export interface ResolvedCost {estimatedCostMicros:number;pricingVersion:string}

// Returns null — never a fabricated number — the moment ANY involved quantity has no matching active
// pricing row, so a partially-priced call is never silently under-reported as fully priced.
export async function resolveCost(admin:SupabaseClient,provider:Provider,operation:Operation,model:string|null,quantities:UsageQuantity[]):Promise<ResolvedCost|null> {
 if(!quantities.length)return null;
 const {data,error}=await admin.rpc('resolve_provider_cost',{p_provider:provider,p_operation:operation,p_model:model,p_quantities:quantities});
 if(error||!data)return null;
 return {estimatedCostMicros:Number(data.estimated_cost_micros),pricingVersion:String(data.pricing_version)};
}

export const costFromRequests=(count:number):UsageQuantity[]=>[{unit_type:'request',quantity:count}];
export const costFromTokens=(inputTokens:number|null,outputTokens:number|null):UsageQuantity[]=>[
 ...(inputTokens?[{unit_type:'input_tokens_1k' as const,quantity:inputTokens/1000}]:[]),
 ...(outputTokens?[{unit_type:'output_tokens_1k' as const,quantity:outputTokens/1000}]:[]),
];
