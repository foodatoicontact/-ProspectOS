// How a keyword matches a BOAMP notice (« Appels d'offres ouverts »). The BOAMP's own search cuts an expression into
// words and matches word prefixes (« techniques de vente » brings back « installations techniques… ventilation »), so it
// only fetches candidates; this module decides, on the notice's subject:
//  - an expression between commas matches as a whole: its words, in the same order, as whole words;
//  - case and accents are ignored; a plural in -s or -x matches its singular (« façades » / « façade »);
//  - small linking words (au, de, du, des, la, le…) may differ or be absent between two words of the expression;
//  - small linking words alone never match anything (a keyword made only of them is refused);
//  - « Saint Pierre » / « Saint-Pierre » is one name: « pierre » alone does not find it, « saint pierre » does;
//  - other hyphens separate words: « graffitis » finds « anti-graffitis », « sous traitance » finds « sous-traitance ».
export const LINK_WORDS=new Set(['a','au','aux','d','de','des','du','en','et','l','la','le','les','un','une','ou','par','pour','sur']);
// Up to this many linking words may sit between two words of the expression.
const MAX_LINKS=3;
const SAINT=new Set(['saint','sainte','saints','saintes','st','ste']);

export function fold(s:string):string{
 return s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/œ/g,'oe').replace(/æ/g,'ae');
}
// Words of a text, folded; « saint/sainte + next word » kept as one name.
export function words(text:string):string[]{
 const raw=fold(text).split(/[^a-z0-9]+/).filter(Boolean);
 const out:string[]=[];
 for(let i=0;i<raw.length;i++){
  const w=raw[i]!;
  if(SAINT.has(w)&&i+1<raw.length&&!LINK_WORDS.has(raw[i+1]!)){out.push(`saint-${raw[i+1]}`);i++;continue}
  out.push(w);
 }
 return out;
}
// The words that carry meaning in a keyword: its words without linking words. Empty: the keyword can match nothing.
export const meaningfulWords=(keyword:string):string[]=>words(keyword).filter(w=>!LINK_WORDS.has(w));

const same=(a:string,b:string)=>a===b||(a.length>=3&&(b===`${a}s`||b===`${a}x`))||(b.length>=3&&(a===`${b}s`||a===`${b}x`));

export function keywordMatches(subject:string,keyword:string):boolean{
 const want=meaningfulWords(keyword);if(!want.length)return false;
 const have=words(subject);
 for(let start=0;start<have.length;start++){
  if(!same(have[start]!,want[0]!))continue;
  let at=start,ok=true;
  for(let k=1;k<want.length&&ok;k++){
   let next=at+1,links=0;
   while(next<have.length&&LINK_WORDS.has(have[next]!)&&!same(have[next]!,want[k]!)&&links<MAX_LINKS){next++;links++}
   if(next<have.length&&same(have[next]!,want[k]!))at=next;else ok=false;
  }
  if(ok)return true;
 }
 return false;
}
// The person's keywords (as they typed them) that make this subject match, in their order.
export const matchingKeywords=(subject:string,keywords:string[]):string[]=>keywords.filter(k=>keywordMatches(subject,k));
