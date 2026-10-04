import {DEFAULT_CRITERIA,safeLink,type Criterion} from './core.ts';
import {DEPARTMENTS,REGIONS,foldPlace} from '../discovery/geo-fr.ts';
// Quick start (activation layer): turns two plain answers — "what do you sell?" and "who do you want to find?"
// — into a PROPOSAL for the existing project / ICP / Discovery models. Pure and deterministic.
//
// Evidence-first guarantees, by construction:
//  - nothing here describes a prospect: the output is a configuration (criteria, rules, a search), never an
//    Evidence row, never a status, never a score;
//  - criteria are the existing default criteria (same keys, same weights as a manually created project) with
//    the existing user-authored rule shapes (target_fit / need_fit) filled from the user's own words — the
//    scoring engine reads them exactly as if the user had typed them in the ICP editor;
//  - every value says where it comes from (the user's text, a deterministic extraction of it, or the AI
//    summary of the user's own offer), and what could not be determined is listed, never invented.
export type Origin='user'|'extracted'|'ai'|'default';
export type Field<T>={value:T;origin:Origin};
export type Missing='offer'|'target'|'location'|'category';
export type OnboardingAnswers={offerText:string;offerUrl?:string;targetText:string;aiSummary?:string|null};
export type TargetingProposal={
 projectName:Field<string>;
 offer:Field<string>;
 offerSummary:Field<string>|null;
 target:Field<string>;
 categories:Field<string[]>;
 locations:Field<string[]>;
 signals:Field<string[]>;
 notes:string[];
 missing:Missing[];
 criteria:Criterion[];
 discovery:{query:string;location:string;categories:string[]};
};

const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
const MAX_LIST=5;
const uniq=(xs:string[])=>{const seen=new Set<string>();return xs.filter(x=>{const k=foldPlace(x);if(!k||seen.has(k))return false;seen.add(k);return true})};
// The places the user explicitly wrote: French regions, departments and prefectures (geo-fr.ts), then a
// capitalised place after "à / en / dans / sur / autour de". Nothing is ever inferred from the offer.
const PLACE_NAMES:string[]=[...REGIONS,...DEPARTMENTS.map(d=>d.name),...DEPARTMENTS.map(d=>d.prefecture)].sort((a,b)=>b.length-a.length);
export function extractLocations(text:string):string[]{
 const folded=` ${foldPlace(text).replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ')} `;const found:string[]=[];
 for(const name of PLACE_NAMES){const f=foldPlace(name);if(f.length>=3&&folded.includes(` ${f} `)&&!found.some(x=>foldPlace(x).includes(f)))found.push(name)}
 if(!found.length){
  const m=/(?:^|\s)(?:à|a|en|dans|sur|autour de|près de|proche de)\s+([A-ZÀ-ÖØ-Ý][\p{L}’'-]+(?:[ -](?:[A-ZÀ-ÖØ-Ý][\p{L}’'-]+|de|du|des|la|le|sur|en))*)/u.exec(text);
  if(m)found.push(m[1].replace(/[ -](?:de|du|des|la|le|sur|en)$/,''));
 }
 return uniq(found).slice(0,MAX_LIST);
}
// "1 à 5 établissements", "10-50 salariés": kept as a note for the human, never turned into a scored rule
// (no public page states it reliably enough for a literal match).
const SIZE=/\b\d+\s*(?:à|-|–)\s*\d+\s*(?:établissements?|salariés?|employés?|personnes|sites?|points de vente)\b|\b(?:plus|moins) de \d+\s*(?:établissements?|salariés?|employés?|personnes)\b/i;
const LEADING=/^(?:avec|ayant|proposant|qui (?:ont|proposent|font|vendent|utilisent)|qui|offrant|faisant)\s+/i;
// A plural head noun to its singular, conservatively (only a trailing s/x on a long enough word).
const singular=(w:string)=>w.length>4&&/[sx]$/i.test(w)&&!/ss$/i.test(w)?w.slice(0,-1):w;

export function parseTarget(targetText:string):{query:string;categories:string[];locations:string[];signals:string[];notes:string[]}{
 const text=clean(targetText);
 const locations=extractLocations(text);
 const notes:string[]=[];const size=SIZE.exec(text);if(size)notes.push(size[0]);
 // Clauses: the first one names who; the following ones (or "avec …") describe what to observe.
 const clauses=text.split(/[,;.\n]|\s+(?=avec\s)|\s+(?=qui\s)|\s+(?=ayant\s)|\s+(?=proposant\s)/i).map(clean).filter(Boolean);
 let head=(clauses[0]??'').replace(/\s+(?:en|à|a|dans|sur|autour de|près de|proche de)\s+.*$/i,'').replace(SIZE,'').trim();
 // A place written inside the first clause ("PME de Haute-Garonne") belongs to the zone, not to the search words.
 for(const place of locations)head=head.replace(new RegExp(`\\s+(?:de|du|des|d’|d')?\\s*${place.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i'),'').trim();
 const query=clean(head).toLowerCase().slice(0,120);
 const firstWord=query.split(' ').find(w=>w.length>2)??'';
 const categories=firstWord?[singular(firstWord)]:[];
 const placeFolds=locations.map(foldPlace);
 const signals=uniq(clauses.slice(1)
  .map(c=>clean(c.replace(LEADING,'').replace(/^(?:la|le|les|un|une|des|du|de la|l’|l')\s*/i,'')))
  .filter(c=>c.length>=4&&!SIZE.test(c)&&!placeFolds.some(p=>foldPlace(c)===p||foldPlace(c).replace(/^(en|a|dans|sur) /,'')===p))
  .map(c=>c.replace(/\s+(?:en|à|dans)\s+[A-ZÀ-ÖØ-Ý].*$/,'').slice(0,80).toLowerCase()))
  .slice(0,MAX_LIST);
 return {query,categories,locations,signals,notes};
}

export function projectNameFrom(offerText:string,offerUrl?:string,firstLocation?:string):string{
 let base='';
 const url=offerUrl&&safeLink(offerUrl);
 if(url){const host=new URL(url).hostname.replace(/^www\./,'').split('.')[0];base=host?host.charAt(0).toUpperCase()+host.slice(1):''}
 if(!base)base=clean(offerText).split(' ').slice(0,4).join(' ').replace(/[,.;:!?]+$/,'');
 if(!base)base='Mon projet';
 return (firstLocation?`${base} · ${firstLocation}`:base).slice(0,120);
}

// The existing default criteria (same keys, labels and weights as a manual project), with the existing
// user-authored rule shapes filled from the user's own words. Unchanged weights → unchanged scoring.
export function proposalCriteria(categories:string[],locations:string[],signals:string[]):Criterion[]{
 return DEFAULT_CRITERIA.map(c=>{
  if(c.key==='target_fit'&&(categories.length||locations.length))return {...c,rules:{type:'target_fit' as const,config:{match:'any_defined' as const,...(categories.length?{categories}:{}),...(locations.length?{locations}:{})}}};
  if(c.key==='need_fit'&&signals.length)return {...c,rules:{type:'need_fit' as const,config:{signals}}};
  return {...c};
 });
}

export function buildTargetingProposal(a:OnboardingAnswers):TargetingProposal{
 const offerText=clean(a.offerText).slice(0,4000);const targetText=clean(a.targetText).slice(0,600);
 const t=parseTarget(targetText);
 const missing:Missing[]=[];
 if(!offerText)missing.push('offer');if(!targetText)missing.push('target');
 if(!t.locations.length)missing.push('location');if(!t.categories.length)missing.push('category');
 const summary=a.aiSummary?clean(a.aiSummary).slice(0,1000):'';
 return {
  projectName:{value:projectNameFrom(offerText,a.offerUrl,t.locations[0]),origin:'extracted'},
  offer:{value:offerText,origin:'user'},
  offerSummary:summary?{value:summary,origin:'ai'}:null,
  target:{value:targetText,origin:'user'},
  categories:{value:t.categories,origin:'extracted'},
  locations:{value:t.locations,origin:'extracted'},
  signals:{value:t.signals,origin:'extracted'},
  notes:t.notes,
  missing,
  criteria:proposalCriteria(t.categories,t.locations,t.signals),
  discovery:{query:t.query||t.categories[0]||'',location:t.locations[0]??'',categories:t.categories},
 };
}

// Human edits on the review screen → the same proposal, rebuilt (criteria and search follow the edits).
export type ProposalEdits={projectName:string;offer:string;categories:string[];locations:string[];signals:string[];query:string};
export function applyEdits(p:TargetingProposal,e:ProposalEdits):TargetingProposal{
 const list=(xs:string[])=>uniq(xs.map(clean).filter(Boolean)).slice(0,MAX_LIST);
 const categories=list(e.categories),locations=list(e.locations),signals=list(e.signals);
 const missing:Missing[]=[...p.missing.filter(m=>m==='target'),...(clean(e.offer)?[]:['offer' as const]),...(locations.length?[]:['location' as const]),...(categories.length?[]:['category' as const])];
 return {...p,
  projectName:{value:clean(e.projectName).slice(0,120)||p.projectName.value,origin:'user'},
  offer:{value:clean(e.offer).slice(0,4000),origin:'user'},
  categories:{value:categories,origin:'user'},locations:{value:locations,origin:'user'},signals:{value:signals,origin:'user'},
  missing,criteria:proposalCriteria(categories,locations,signals),
  discovery:{query:clean(e.query).slice(0,120)||categories[0]||'',location:locations[0]??'',categories},
 };
}
// The first Discovery needs a query and a location (DiscoveryInputSchema: both ≥ 2 characters).
export const readyForDiscovery=(p:TargetingProposal)=>p.discovery.query.length>=2&&p.discovery.location.length>=2&&p.offer.value.length>0;
// The existing analyze-company route requires an http(s) source URL and 30–10 000 characters of text.
export const canAnalyzeOffer=(offerText:string,offerUrl?:string)=>!!offerUrl&&!!safeLink(offerUrl)&&clean(offerText).length>=30&&offerText.length<=10000;
