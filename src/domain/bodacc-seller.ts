// The SELLER of a business sold (BODACC « Ventes et cessions »), owner decision 26 nov. 2026 — the use case: franchise
// recruiters looking for restaurateurs who have just sold their business. Shared by the collection (src/collect/bodacc.ts),
// the search (src/discovery/providers/bodacc-sales.ts) and the measurement on 50 annotated notices
// (tests/bodacc-seller.test.ts). Pure.
//
// What is read, in memory only, and what comes out:
//  1. the notice's structured list of previous owners (listeprecedentproprietaire): only `typePersonne` and, for a legal
//     entity ("pm"), its registration number. A natural person ("pp") is recognised by its type alone: its name, its
//     address and its number are never read, never returned;
//  2. when that list is absent, the act's text and the origin of the business (same rule as PR #105: read in memory, matched
//     against fixed patterns, never stored nor logged): a registration number is taken only when it follows « précédent /
//     ancien propriétaire » or « vendeur / cédant » AND the words between them name a company (SAS, SARL, société…);
//  3. nothing else: no name, no address, no text.
// Result: {kind:'PM',siren,source} — a company identified by a SIREN with a valid key; {kind:'PP'} — a natural person,
// shown as « cédant : personne physique, non affiché » and stored as nothing but that kind; {kind:'UNKNOWN'}.
// A SIREN found here is still checked against the company register before it is ever shown (a sole trader there is
// treated as a natural person): src/collect/enrich.ts sets `individual`, and the search keeps companies only.
export type Seller={kind:'PM';siren:string;source:'structured'|'text'}|{kind:'PP'}|{kind:'UNKNOWN'};

const parse=(v:unknown):unknown=>{if(typeof v!=='string')return v;try{return JSON.parse(v)}catch{return null}};
const list=(v:unknown):unknown[]=>Array.isArray(v)?v:v==null?[]:[v];
// SIREN: 9 digits and a valid Luhn key (La Poste, 356 000 000, uses the sum of the digits modulo 5).
export function sirenValid(s:string):boolean{
 if(!/^\d{9}$/.test(s))return false;
 if(s==='356000000')return true;
 let sum=0;for(let i=0;i<9;i++){let d=Number(s[8-i]);if(i%2===1){d*=2;if(d>9)d-=9}sum+=d}
 return sum%10===0;
}
const nine=(v:unknown)=>typeof v==='string'?v.replace(/\D/g,''):'';

// What the text may say. The window between the words and the number must name a company form; a person's name followed by
// an RCS number (a sole trader) is never taken.
const LEAD=/(?:pr[ée]c[ée]dent|ancien)s?\s+(?:propri[ée]taire|exploitant)s?|vendeu(?:r|se)s?|c[ée]dant(?:e)?s?/gi;
const COMPANY=/\b(?:SAS|SASU|SARL|EURL|SA|SNC|SCI|SCP|SELARL|SELAS|SCS|SCA|SEL|soci[ée]t[ée]|holding)\b/i;
const NUMBER=/(?:RCS|R\.C\.S\.?|SIREN|immatricul[ée]e?)[^0-9]{0,60}?(\d{3}[\s.]?\d{3}[\s.]?\d{3})(?!\d)/i;
export function sellerFromText(...texts:unknown[]):{siren:string}|null{
 for(const t of texts){
  if(typeof t!=='string'||!t)continue;
  for(const m of t.matchAll(LEAD)){
   const window=t.slice(m.index!+m[0].length,m.index!+m[0].length+260);
   const n=NUMBER.exec(window);if(!n)continue;
   if(!COMPANY.test(window.slice(0,n.index)))continue;
   const siren=n[1]!.replace(/\D/g,'');
   if(sirenValid(siren))return {siren};
  }
 }
 return null;
}

export function sellerOf(previousOwners:unknown,acte?:unknown,etablissements?:unknown):Seller{
 const people=list((parse(previousOwners) as {personne?:unknown}|null)?.personne).filter(p=>p&&typeof p==='object') as Array<Record<string,unknown>>;
 if(people.length){
  // Several previous owners: the first company with a valid SIREN; none → a natural person is involved, nothing is shown.
  for(const p of people){
   if(p.typePersonne!=='pm')continue;
   const siren=nine((p.numeroImmatriculation as {numeroIdentification?:unknown}|undefined)?.numeroIdentification);
   if(sirenValid(siren))return {kind:'PM',siren,source:'structured'};
  }
  return people.some(p=>p.typePersonne==='pp')?{kind:'PP'}:{kind:'UNKNOWN'};
 }
 const a=parse(acte) as {descriptif?:unknown}|null;
 const site=list((parse(etablissements) as {etablissement?:unknown}|null)?.etablissement)[0] as {origineFonds?:unknown}|undefined;
 const fromText=sellerFromText(a?.descriptif,site?.origineFonds);
 return fromText?{kind:'PM',siren:fromText.siren,source:'text'}:{kind:'UNKNOWN'};
}

// The line shown with a sale: the company (its name comes from the register, never from the notice), or the fixed sentence.
export const SELLER_PP_LABEL='Cédant : personne physique, non affiché';
export const SELLER_UNKNOWN_LABEL='Cédant : non indiqué par l’annonce';
