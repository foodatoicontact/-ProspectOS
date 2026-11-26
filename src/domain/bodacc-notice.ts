// The notice a BODACC cancellation or correction targets (migration 055). The open-data API gives every notice an id made
// of its publication letter, its issue and its number — « BODACC A », issue 20260220, number 4824 → A202602204824 — and a
// cancellation or a correction names the notice it targets in « parutionavisprecedent ». Anything else: null.
const obj=(v:unknown):Record<string,unknown>=>{if(v&&typeof v==='object')return v as Record<string,unknown>;if(typeof v==='string'&&v.trim().startsWith('{'))try{return JSON.parse(v)}catch{return {}}return {}};
const str=(v:unknown)=>typeof v==='string'?v.trim():typeof v==='number'?String(v):'';
export function previousNoticeId(v:unknown):string|null{
 const o=obj(v);const pub=/^BODACC ([ABC])$/.exec(str(o.nomPublication));const issue=str(o.numeroParution),num=str(o.numeroAnnonce);
 return pub&&/^\d{8}$/.test(issue)&&/^\d{1,6}$/.test(num)?`${pub[1]}${issue}${num}`:null;
}
