// Deterministic, literal, whole-word/phrase matching only — no fuzzy matching, no synonyms, no
// embeddings, no LLM, no automatic translation. A short needle ("PME") must never match as a mere
// fragment of a longer, unrelated word ("bar" inside "barbecue"): both edges of the match are
// required to sit on a non-alphanumeric boundary, so only a genuine whole word/phrase counts.
function normalizeForMatch(s:string):string{return s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim()}
function escapeRegExp(s:string):string{return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
export type LiteralMatch={line:string; value:string};
// Finds the first line containing `needle` as a whole word/phrase. Returns the exact matched line
// (never modified) so the caller can build an explainable claim/excerpt citing precisely what matched.
export function findLiteralMatch(lines:string[],needle:string):LiteralMatch|null{
 const normalizedNeedle=normalizeForMatch(needle);
 if(!normalizedNeedle)return null;
 const pattern=new RegExp(`[^a-z0-9]${escapeRegExp(normalizedNeedle)}[^a-z0-9]`);
 for(const line of lines){
  if(pattern.test(' '+normalizeForMatch(line)+' '))return {line,value:needle};
 }
 return null;
}
// Grammatical words and discourse markers ("des", "ou", "idéalement", "notamment"…): never a business term. A
// value made only of them (or of words shorter than 3 letters) is not an ICP rule — an ICP saved with one
// ("des", from an older onboarding parser) must never let it validate a page where every sentence has it.
const NOT_A_TERM=new Set(['le','la','les','l','un','une','des','de','du','d','au','aux','a','en','dans','sur','pour','par','avec','chez','sans','vers','entre','et','ou','ni','mais','qui','que','qu','dont','ce','ces','cet','cette','son','sa','ses','leur','leurs','notre','nos','votre','vos','tout','tous','toute','toutes','ont','eu','est','sont','ete','avoir','etre',
 'idealement','notamment','surtout','principalement','prioritairement','eventuellement','typiquement','generalement','souvent','plutot','egalement','aussi','preference','possible','exemple','particulier','recemment','actuellement','aujourd','hui','dernierement']);
const termWords=(value:string)=>normalizeForMatch(value).split(/[^a-z0-9]+/).filter(Boolean);
export function isMeaningfulTerm(value:string):boolean{return termWords(value).some(w=>w.length>=3&&!NOT_A_TERM.has(w))}
// The content words of a multi-word signal, each reduced to a short stem ("recrutent" / "recrutons" → "recrut").
const stemOf=(w:string)=>w.length>6?w.slice(0,6):w;
const contentStems=(value:string)=>[...new Set(termWords(value).filter(w=>w.length>=3&&!NOT_A_TERM.has(w)).map(stemOf))];
// Concept match for a signal of SEVERAL content words: every one of them (by stem, whole words only) in the same
// sentence, in any order — "recrutent un RSSI" ↔ "Nous recrutons actuellement un RSSI". Never a single shared word.
export function findConceptMatch(lines:string[],needle:string):LiteralMatch|null{
 const stems=contentStems(needle);if(stems.length<2)return null;
 for(const line of lines){const words=termWords(line).map(stemOf);if(stems.every(s=>words.includes(s)))return {line,value:needle}}
 return null;
}
