// Business words → NAF (rév. 2) activities of the official nomenclature (INSEE). A closed, documented table: each
// group carries its official label and an explanation shown to the user, who confirms it. A word that matches no
// group is reported as unmapped — never guessed, never sent to the register.
export type NafDivision={code:string;label:string};
export type NafGroup={key:'industriel'|'agroalimentaire';terms:string[];label:string;explanation:string;section:'C'|null;divisions:NafDivision[];codes:string[]};

const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const words=(s:string)=>fold(s).split(/[^a-z0-9-]+/).filter(Boolean);

// NAF rév. 2 sub-classes of divisions 10 (Industries alimentaires) and 11 (Fabrication de boissons).
const AGRIFOOD_CODES=['10.11Z','10.12Z','10.13A','10.13B','10.20Z','10.31Z','10.32Z','10.39A','10.39B','10.41A','10.41B','10.42Z','10.51A','10.51B','10.51C','10.51D','10.52Z',
 '10.61A','10.61B','10.62Z','10.71A','10.71B','10.71C','10.71D','10.72Z','10.73Z','10.81Z','10.82Z','10.83Z','10.84Z','10.85Z','10.86Z','10.89Z','10.91Z','10.92Z',
 '11.01Z','11.02A','11.02B','11.03Z','11.04Z','11.05Z','11.06Z','11.07A','11.07B'];

const GROUPS:Array<{key:NafGroup['key'];match:RegExp;build:()=>Omit<NafGroup,'key'|'terms'>}>=[
 {key:'industriel',match:/^(?:industri|manufactur)/,build:()=>({label:'Section C — Industrie manufacturière',section:'C',divisions:[],codes:[],
  explanation:'« industriel » est traduit par la section C de la NAF (Industrie manufacturière) : entreprises dont l’activité principale est de fabriquer.'})},
 {key:'agroalimentaire',match:/^agro-?aliment/,build:()=>({label:'Divisions 10 et 11 — Industries alimentaires, Fabrication de boissons',section:null,
  divisions:[{code:'10',label:'Division 10 — Industries alimentaires'},{code:'11',label:'Division 11 — Fabrication de boissons'}],codes:AGRIFOOD_CODES,
  explanation:'« agroalimentaire » est traduit par les divisions 10 (Industries alimentaires) et 11 (Fabrication de boissons) de la NAF, recherchées à part pour ne pas être noyées dans l’industrie en général.'})},
];

// NAF rév. 2 sections → their divisions (INSEE). Only the sections a group declares need to be listed; a section
// missing here is never considered to contain anything (the groups are then simply kept side by side).
const SECTION_DIVISIONS:Record<string,string[]>={C:Array.from({length:24},(_,i)=>String(10+i))};// C: divisions 10–33
type NafScope={key:string;section:string|null;codes:string[]};
// True when every activity of `inner` is also an activity of `outer` — computed from the declared scopes only.
function within(inner:NafScope,outer:NafScope):boolean{
 if(outer.section){if(inner.section)return inner.section===outer.section;const divisions=SECTION_DIVISIONS[outer.section];
  return !!divisions&&inner.codes.length>0&&inner.codes.every(c=>divisions.includes(c.slice(0,2)))}
 return !inner.section&&inner.codes.length>0&&inner.codes.every(c=>outer.codes.includes(c));
}
// The most precise group wins: a group whose scope contains another requested group's scope is not queried (it would
// add everything outside the precise one — canary 2f1ea224: "industriel" + "agroalimentaire" gave 10/20 agri-food).
// Groups that are not nested keep the existing combination (each queried, results interleaved). Equal scopes: the
// first one is kept. Deterministic: order preserved, nothing read from the words.
export function reduceNafGroups<T extends NafScope>(groups:T[]):{groups:T[];narrowed:Array<{key:string;into:string[]}>}{
 const dropped=groups.map((b,j)=>groups.some((a,i)=>i!==j&&within(a,b)&&(!within(b,a)||i<j)));
 const kept=groups.filter((_,j)=>!dropped[j]);
 return {groups:kept,narrowed:groups.filter((_,j)=>dropped[j]).map(b=>({key:b.key,into:kept.filter(a=>within(a,b)).map(a=>a.key)}))};
}

// requested: every group the words map to, in table order; groups: the ones actually queried after reduceNafGroups.
export function proposeNafGroups(terms:string[]):{groups:NafGroup[];requested:Array<NafGroup['key']>;narrowed:Array<{key:string;into:string[]}>;unmapped:string[]}{
 const groups:NafGroup[]=[];const unmapped:string[]=[];
 for(const term of terms.map(t=>t.trim()).filter(Boolean)){
  const hits=GROUPS.filter(g=>words(term).some(w=>g.match.test(w)));
  if(!hits.length){if(!unmapped.includes(term))unmapped.push(term);continue}
  for(const g of hits){const existing=groups.find(x=>x.key===g.key);if(existing){if(!existing.terms.includes(term))existing.terms.push(term)}else groups.push({key:g.key,terms:[term],...g.build()})}
 }
 const requested=GROUPS.map(g=>groups.find(x=>x.key===g.key)).filter((g):g is NafGroup=>!!g);
 const {groups:kept,narrowed}=reduceNafGroups(requested);
 return {groups:kept,requested:requested.map(g=>g.key),narrowed,unmapped};
}
// The label of a NAF group key kept in a run's metrics (search_failed_groups); an unknown key → null.
export function nafGroupLabel(key:string):string|null{const g=GROUPS.find(x=>x.key===key);return g?g.build().label:null}
