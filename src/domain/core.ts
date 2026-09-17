export const NO_UNAUTHORIZED_LINKEDIN_AUTOMATION = true as const;
// User-authored, explicit rules only — never a hint for an LLM or a similarity model. Structural
// validation (bounds, dedup, discriminant) lives in discovery/types.ts's Zod schemas, the single
// source of truth enforced both for Discovery search input and for ICP save — this type is kept in
// sync with that schema via a compile-time assertion there. Absent (undefined) on a criterion means
// exactly what it always meant: no deterministic rule, so behavior is unchanged for every existing ICP.
export type TargetFitRules = {categories?:string[]; locations?:string[]; org_types?:string[]; match:'all_defined'|'any_defined'};
export type NeedFitRules = {signals:string[]};
export type CriterionRules =
 | {type:'target_fit'; config:TargetFitRules}
 | {type:'need_fit'; config:NeedFitRules};
export type Criterion = {key:string; label:string; weight:number; rules?:CriterionRules};
export type Evidence = {id:string;criterion:string;value:boolean;status:string;source_url:string;excerpt:string;observed_at:string;verified_by:string|null};
export type Prospect = {id:string;name:string;website:string;city:string;status:string;project_id:string;organization_id:string;evidence:Evidence[];channels?:Channel[]};
export type Channel = {kind:string;value:string;source_url:string;verified:boolean};
export const STATUSES=['À analyser','Qualifié','À contacter','Contacté','Réponse','Gagné','Perdu'] as const;
export const FOODATOI_CRITERIA:Criterion[]=[
 {key:'food',label:'Activité alimentaire',weight:15},
 {key:'region',label:'Toulouse / Occitanie',weight:15},
 {key:'phone_orders',label:'Commandes par téléphone',weight:20},
 {key:'social_orders',label:'Commandes sur réseaux sociaux',weight:10},
 {key:'platforms',label:'Uber Eats / Deliveroo',weight:15},
 {key:'weak_collect',label:'Click & collect absent ou faible',weight:15},
 {key:'audience',label:'Forte audience sociale documentée',weight:5},
 {key:'internal_delivery',label:'Livraison interne documentée',weight:5}
];
export const DEFAULT_CRITERIA:Criterion[]=[
 {key:'target_fit',label:'Correspond à la cible définie',weight:25},
 {key:'need_fit',label:'Besoin correspondant à l’offre',weight:30},
 {key:'commercial_signal',label:'Signal commercial observable',weight:25},
 {key:'contactability',label:'Canal de contact professionnel documenté',weight:20}
];
export function safeLink(value:string):string|null {try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null}catch{return null}}
export function validateCriteria(criteria:Criterion[]) {if(!criteria.length||criteria.length>30||new Set(criteria.map(c=>c.key)).size!==criteria.length||criteria.some(c=>!c.key||!c.label||!Number.isFinite(c.weight)||c.weight<=0)||Math.abs(criteria.reduce((s,c)=>s+c.weight,0)-100)>0.001)throw Error('Les critères doivent être uniques et leurs poids totaliser 100.');}
export function scoreProspect(criteria:Criterion[],evidence:Evidence[],now=new Date()) {
 validateCriteria(criteria);
 const breakdown=criteria.map(c=>{
 const rows=evidence.filter(e=>{const age=now.getTime()-new Date(e.observed_at).getTime();return e.criterion===c.key&&e.status==='VERIFIED'&&e.verified_by&&e.excerpt.trim()&&safeLink(e.source_url)&&Number.isFinite(age)&&age>=0&&age<=90*86400000});
 const values=new Set(rows.map(e=>e.value));const state=values.size>1?'CONFLICT':values.size===0?'UNKNOWN':values.has(true)?'TRUE':'FALSE';
 return {...c,state,points:state==='TRUE'?c.weight:0,evidence_ids:[...new Set(rows.map(e=>e.id))],reason:state==='CONFLICT'?'Contradiction : revue nécessaire':state==='UNKNOWN'?'À confirmer':state==='TRUE'?'Critère étayé par une preuve vérifiée':'Critère vérifié non satisfait'};
 });
 return {score:Math.round(breakdown.reduce((s,b)=>s+b.points,0)),coverage:Math.round(breakdown.filter(b=>['TRUE','FALSE'].includes(b.state)).reduce((s,b)=>s+b.weight,0)),breakdown};
}
export function generateOutreach(name:string,offer:string,criteria:Criterion[],evidence:Evidence[],now=new Date()){
 const s=scoreProspect(criteria,evidence,now);const known=(key:string)=>s.breakdown.find(b=>b.key===key&&b.state==='TRUE');
 let hook='Je me permets de vous contacter au sujet de votre activité.';let chosen:ReturnType<typeof known>;
 if((chosen=known('phone_orders')))hook='Votre site indique que vous prenez des commandes par téléphone.';
 else if((chosen=known('platforms')))hook='Votre page mentionne votre présence sur des plateformes de livraison.';
 else if((chosen=known('social_orders')))hook='Votre page propose de commander via vos réseaux sociaux.';
 if(!chosen){const generic=s.breakdown.find(b=>b.state==='TRUE');if(generic){chosen=generic;hook=`J’ai relevé un signal pertinent concernant « ${generic.label} » dans vos informations publiques.`}}
 const value=offer.trim()||'Je souhaite vous présenter notre offre et vérifier si elle correspond à vos besoins.';
 const text=`Bonjour l’équipe ${name}, ${hook} ${value} Seriez-vous ouvert à un court échange ?`;
 return {text,evidence_ids:chosen?.evidence_ids??[],mode:'Modèle factuel',generated_at:now.toISOString()};
}
export function csv(rows:unknown[][]){return '\uFEFF'+rows.map(row=>row.map(value=>{let s=String(value??'');if(/^[\s]*[=+@\-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}).join(',')).join('\r\n')}
export function allowedAction(action:string){return ['analyze_company','build_icp','find_prospects','analyze_prospect','score_prospect','find_contact_channels','generate_outreach','prepare_connection_message','prepare_followup','mark_contacted','copy','open_profile'].includes(action)}
export function bestChannel(channels:Channel[]){const preference=['email','form','phone','linkedin','whatsapp','instagram'];const candidates=channels.filter(c=>c.verified&&safeLink(c.source_url)&&c.value.trim());return [...candidates].sort((a,b)=>{const rank=(k:string)=>preference.includes(k)?preference.indexOf(k):99;return rank(a.kind)-rank(b.kind)})[0]??null}
