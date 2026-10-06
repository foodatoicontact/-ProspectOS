import type {SignalType,SignalSourceType} from './types.ts';
// Signal Engine S2 — the provider contract, the same shape as Discovery's DiscoveryProvider: a provider only FINDS raw
// items for one company; the service (service.ts) validates, deduplicates, budgets and saves. A provider never decides
// a status or a confidence, never writes, and never reads LinkedIn (no scraping, no browser automation).
export type SignalProviderId='web_search'|'official_site'|'bodacc'|'discovery_recycled'|'user_provided'|'test_fixture';
// The company to look at: an accepted prospect, identified by its own data (official domain, SIREN when known).
export type SignalTarget={prospect_id:string;name:string;website:string|null;siren:string|null;city:string|null};
export type RawSignal={signal_type:SignalType;title:string;excerpt:string;source_url:string;source_type:SignalSourceType;
 published_at:string|null;event_date:string|null;metadata:Record<string,unknown>};
export type SignalSearchInput={target:SignalTarget;types:SignalType[];now:Date};
export interface SignalProvider{
 id:SignalProviderId;
 mode:'live'|'test';
 // false when the provider cannot look at this company at all (e.g. the legal-announcement source needs a SIREN).
 supports(target:SignalTarget):boolean;
 // One provider call for one company: counted as one request of the scan budget.
 searchSignals(input:SignalSearchInput):Promise<RawSignal[]>;
 // Items the provider itself refused (homonym risk, no recognizable event…), by reason code; read and reset by the
 // service after each call. Codes only, never a URL or a text.
 takeRejections?():Record<string,number>;
}
