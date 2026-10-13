// Signal-first Discovery V1 — the search provider contract. A provider only SEARCHES: one call = one request to its
// source, returning the results normalized to what P1 reads (title, url, snippet, the engine's own date). It never
// fetches a result page, never decides anything, never writes.
//
// "Answered" (the refund contract, migration 030 / release_failed_signal_discovery): a call that RETURNS — even with
// zero results — is a request the source answered. A call that THROWS (network error, timeout, HTTP error, invalid or
// oversized body) is not. A run is refunded only when it failed and no request was answered.
import type {SearchHit} from './extract.ts';

export type SignalSearchRequest={q:string;freshness:string;country:string;search_lang:string;count:number};
export interface SignalSearchProvider{
 id:'brave'|'fixture';
 // true only for a real, billed source: its requests are recorded in the cost ledger (api_usage_events).
 metered:boolean;
 search(request:SignalSearchRequest):Promise<SearchHit[]>;
}

// Deterministic provider for tests and local runs: no network. Each call takes the next scripted answer: a list of
// results (answered, possibly empty) or an Error (not answered). With no script, every call answers `hits`.
export class FixtureSignalSearchProvider implements SignalSearchProvider{
 id='fixture' as const;metered=false;
 readonly calls:SignalSearchRequest[]=[];
 private readonly hits:SearchHit[];private readonly script?:Array<SearchHit[]|Error>;
 constructor(hits:SearchHit[]=DEMO_HITS,script?:Array<SearchHit[]|Error>){this.hits=hits;this.script=script}
 async search(request:SignalSearchRequest):Promise<SearchHit[]>{
  this.calls.push(request);
  const next=this.script?this.script[this.calls.length-1]:this.hits;
  if(next instanceof Error)throw next;
  return (next??[]).map(h=>({...h}));
 }
}

// The few fictitious results the fixture provider answers by default (no real organization, .exemple domains).
export const DEMO_HITS:SearchHit[]=[
 {title:'Napolino ouvrira un nouveau restaurant à Toulouse en décembre 2026',description:'L’enseigne Napolino ouvrira un nouveau restaurant à Toulouse en décembre 2026, rue d’Alsace-Lorraine.',url:'https://www.depeche-exemple.fr/2026/10/01/napolino-toulouse.html',page_age:'2026-10-01T08:00:00Z'},
 {title:'Café Mira ouvre son deuxième établissement à Montpellier',description:'Après le succès de sa première adresse, Café Mira a ouvert son deuxième établissement à Montpellier le 2 octobre 2026.',url:'https://www.midi-exemple.fr/2026/10/04/cafe-mira.html',page_age:'2026-10-04'},
 {title:'Découvrez notre guide des meilleurs fast-foods de Toulouse',description:'Burgers, tacos, kebabs : notre sélection des meilleurs fast-foods de Toulouse.',url:'https://www.guide-exemple.fr/meilleurs-fast-foods-toulouse',page_age:'2026-09-01'},
];
