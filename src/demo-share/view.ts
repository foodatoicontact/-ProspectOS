import {z} from 'zod';
// What the public demo page shows (read_demo_share, migration 042), validated again here: company data only.
// The page never shows a phone number or an email — none is read, and the schema below has no place for one.
const DemoKeys=z.object({
 activity:z.string().max(300).optional(),
 department:z.string().regex(/^\d{2,3}$|^2[AB]$/).optional(),
 sells_vehicles:z.boolean().optional(),
 is_new:z.boolean().optional(),
 hook:z.string().max(400).optional(),
}).passthrough();
const Signal=z.object({
 signal_type:z.string(),title:z.string(),excerpt:z.string(),source_url:z.string(),source_type:z.string().optional(),
 event_date:z.string().nullable().optional(),published_at:z.string().nullable().optional(),demo:DemoKeys.default({}),
});
const Prospect=z.object({name:z.string(),city:z.string().nullable().optional(),signals:z.array(Signal).default([])});
export const DemoViewSchema=z.object({
 project:z.object({name:z.string()}),target:z.string().nullable().optional(),expires_at:z.string().optional(),
 prospects:z.array(Prospect).default([]),
});
export type DemoView=z.infer<typeof DemoViewSchema>;
export type DemoCompany={name:string;city:string|null;department:string|null;activity:string|null;signalType:string|null;signalLabel:string|null;
 signalDate:string|null;excerpt:string|null;sourceUrl:string|null;isNew:boolean;priority:boolean;hook:string|null};

const SIGNAL_LABELS:Record<string,string>={
 acquisition:'Reprise de fonds de commerce',leadership_change:'Changement de dirigeant',new_site:'Nouvel établissement',funding:'Augmentation de capital',
 hiring_role:'Recrutement',expansion:'Développement',product_launch:'Lancement',partnership:'Partenariat',certification:'Certification',tech_change:'Changement d’outil',
 public_contract_won:'Marché public remporté',headcount_growth:'Croissance des effectifs',incident_cyber:'Incident',event:'Événement',
};
export const signalLabel=(type:string):string=>SIGNAL_LABELS[type]??'Signal public';
// Only an http(s) address without credentials becomes a link; anything else is shown as no link at all.
export function officialLink(v:string|null|undefined):string|null{
 try{const u=new URL(String(v??''));return (u.protocol==='https:'||u.protocol==='http:')&&!u.username&&!u.password?u.toString():null}catch{return null}
}
const day=(s:{event_date?:string|null;published_at?:string|null})=>(s.event_date??s.published_at??'').slice(0,10)||null;
// One line per company: its most recent signal carries the fact, the date and the official source.
// Order: the companies the owner marked as the priority first, then the most recent signal first, then by name —
// a display order. It is NOT the product's fit score (that one counts verified evidence only, src/domain/core.ts).
export function demoCompanies(view:DemoView):DemoCompany[]{
 const rows=view.prospects.map(p=>{
  const s=[...p.signals].sort((a,b)=>(day(b)??'').localeCompare(day(a)??''))[0]??null;
  const d=s?.demo??{};
  return {name:p.name,city:p.city?.trim()||null,department:d.department??null,activity:d.activity?.trim()||null,signalType:s?.signal_type??null,
   signalLabel:s?signalLabel(s.signal_type):null,signalDate:s?day(s):null,excerpt:s?.excerpt?.trim()||null,sourceUrl:officialLink(s?.source_url),
   isNew:d.is_new===true,priority:d.sells_vehicles===true,hook:d.hook?.trim()||null};
 });
 return rows.sort((a,b)=>Number(b.priority)-Number(a.priority)||(b.signalDate??'').localeCompare(a.signalDate??'')||a.name.localeCompare(b.name,'fr'));
}
