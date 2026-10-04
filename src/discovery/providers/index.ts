// The Discovery providers a run can be started with — chosen explicitly by the user, never substituted: an
// unavailable provider fails on its own (Brave without its key), it never falls back to another source.
import type {DiscoveryProvider} from '../types.ts';
import {BraveProvider} from './brave.ts';
import {FixtureProvider} from './fixture.ts';
import {RegistryProvider} from './registry.ts';

export type DiscoveryProviderId='fixture'|'brave'|'registry';
type Env=Record<string,string|undefined>;
export const REGISTRY_LABEL='Registre des entreprises — données publiques';

export function createDiscoveryProvider(id:DiscoveryProviderId|undefined,env:Env):DiscoveryProvider{
 if(id==='brave')return new BraveProvider(env.BRAVE_SEARCH_API_KEY??'');
 if(id==='registry')return new RegistryProvider();
 return new FixtureProvider();
}

export function discoveryProviderConfig(env:Env){
 return {providers:[
  {id:'fixture' as const,available:true,mode:'test' as const,label:'TEST — entreprises synthétiques'},
  {id:'brave' as const,available:!!env.BRAVE_SEARCH_API_KEY,mode:'live' as const,label:'Brave Search API'},
  // Public data, no key: always available in live mode.
  {id:'registry' as const,available:true,mode:'live' as const,label:REGISTRY_LABEL},
 ],website_policy:'Domaines autorisés par l’opérateur et robots.txt vérifié',max_results_transport:100};
}

// Only paid provider requests enter the cost ledger. The register is free (no ledger row: its run cost is 0), but
// its launch still consumes one Discovery quota in start_discovery (migration 019).
export function isMeteredSearchProvider(id:string|undefined):boolean{return id==='brave'}

// Filters that only one provider reads. The headcount range is a structured filter of the register; it is never
// sent with another provider (it never becomes Brave search words, a criterion, a weight or evidence).
export function providerSpecificFilters(id:string|undefined,employeeRange:{min:number;max:number}|null|undefined):{employee_range?:{min:number;max:number}}{
 return id==='registry'&&employeeRange?{employee_range:{min:employeeRange.min,max:employeeRange.max}}:{};
}
