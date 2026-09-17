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
