// Search market (Brave `country` parameter) derived from the zone the user typed — deterministic, no
// network, no LLM. Brave only ranks for a closed list of markets; any zone that cannot be tied to exactly
// one of them with certainty is searched on the neutral, officially supported `ALL` market — never on a
// guessed country, and never on France by default (a foreign zone searched on `FR` returns the French web).
import {placesIn} from './geo-fr.ts';

// The `country` values Brave's Web Search API accepts, copied from Brave's own published contract
// (brave/brave-search-mcp-server, src/tools/web/params.ts, `country` enum). `ALL` = no market bias.
// Anything else (e.g. MA, TN, SN, CI…) is not a Brave market and must never be sent.
export const BRAVE_COUNTRIES: ReadonlySet<string> = new Set(['ALL', 'AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CL', 'DK', 'FI', 'FR', 'DE', 'HK', 'IN', 'ID', 'IT', 'JP', 'KR', 'MY', 'MX', 'NL', 'NZ', 'NO', 'CN', 'PL', 'PT', 'PH', 'RU', 'SA', 'ZA', 'ES', 'SE', 'CH', 'TW', 'TR', 'GB', 'US']);
export const NEUTRAL_MARKET = 'ALL';

// Country names (French and English, accents folded) for the Brave markets only: a zone naming any other
// country has no Brave market and falls back to ALL without needing to be listed. Names only — never a
// city, since a city name alone is too ambiguous to pin a market on.
const MARKET_NAMES: ReadonlyArray<[string, string[]]> = [
 ['AR', ['argentine', 'argentina']], ['AU', ['australie', 'australia']], ['AT', ['autriche', 'austria', 'osterreich']],
 ['BE', ['belgique', 'belgium', 'belgie']], ['BR', ['bresil', 'brazil', 'brasil']], ['CA', ['canada']], ['CL', ['chili', 'chile']],
 ['DK', ['danemark', 'denmark']], ['FI', ['finlande', 'finland']], ['FR', ['france']], ['DE', ['allemagne', 'germany', 'deutschland']],
 ['HK', ['hong kong']], ['IN', ['inde', 'india']], ['ID', ['indonesie', 'indonesia']], ['IT', ['italie', 'italy', 'italia']],
 ['JP', ['japon', 'japan']], ['KR', ['coree du sud', 'south korea']], ['MY', ['malaisie', 'malaysia']], ['MX', ['mexique', 'mexico']],
 ['NL', ['pays bas', 'netherlands', 'hollande']], ['NZ', ['nouvelle zelande', 'new zealand']], ['NO', ['norvege', 'norway']],
 ['CN', ['chine', 'china']], ['PL', ['pologne', 'poland']], ['PT', ['portugal']], ['PH', ['philippines']], ['RU', ['russie', 'russia']],
 ['SA', ['arabie saoudite', 'saudi arabia']], ['ZA', ['afrique du sud', 'south africa']], ['ES', ['espagne', 'spain', 'espana']],
 ['SE', ['suede', 'sweden']], ['CH', ['suisse', 'switzerland', 'schweiz']], ['TW', ['taiwan']], ['TR', ['turquie', 'turkey', 'turkiye']],
 ['GB', ['royaume uni', 'united kingdom', 'grande bretagne', 'angleterre', 'england', 'ecosse', 'scotland']],
 ['US', ['etats unis', 'united states', 'usa']],
];
const fold = (s: string): string => ` ${s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

export type MarketReason = 'explicit_country' | 'explicit_country_unsupported' | 'zone_country' | 'zone_french_place' | 'zone_ambiguous' | 'zone_unknown';
export type Market = {country: string; reason: MarketReason};

// explicit: optional_filters.country, an ISO code chosen by the caller — honored only when Brave supports it.
export function resolveMarket(location: string, explicit?: string): Market {
 if (explicit) return BRAVE_COUNTRIES.has(explicit) ? {country: explicit, reason: 'explicit_country'} : {country: NEUTRAL_MARKET, reason: 'explicit_country_unsupported'};
 const text = fold(location);
 const named = new Set(MARKET_NAMES.filter(([, names]) => names.some(n => text.includes(` ${n} `))).map(([code]) => code));
 // A French department, region, prefecture or postal code places the zone in France.
 const french = placesIn(location);
 if (french.departments.size || french.regions.size) named.add('FR');
 if (named.size === 1) { const [country] = [...named]; return {country: country!, reason: country === 'FR' && !text.includes(' france ') ? 'zone_french_place' : 'zone_country'}; }
 return {country: NEUTRAL_MARKET, reason: named.size > 1 ? 'zone_ambiguous' : 'zone_unknown'};
}
