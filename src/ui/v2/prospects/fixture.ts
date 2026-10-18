// Prospects 2.0 bench data (/ui-v2/prospects, Preview only) and test fixture. Fictitious companies, .example domains.
// Dates are relative to `now` so the 90-day evidence window of scoreProspect / estimateFit always holds.
import type {Criterion,Evidence,Prospect} from '../../../domain/core.ts';

export const BENCH_CRITERIA:Criterion[]=[
 {key:'target_fit',label:'Restauration avec point de vente physique en Occitanie',weight:35},
 {key:'local_decision',label:'Décision d’achat locale',weight:25},
 {key:'need_fit',label:'Besoin d’un canal direct',weight:25},
 {key:'contactability',label:'Canal de contact professionnel documenté',weight:15},
];
const day=86400000;
const iso=(now:Date,daysAgo:number)=>new Date(now.getTime()-daysAgo*day).toISOString();
const ev=(now:Date,o:Partial<Evidence>&Pick<Evidence,'id'|'criterion'|'status'>&{note?:string|null}):Evidence=>({value:true,source_url:'',excerpt:'',observed_at:iso(now,3),verified_by:null,...o});

export function benchProspects(now:Date):Prospect[]{
 const P=(o:Partial<Prospect>&Pick<Prospect,'id'|'name'>):Prospect=>({website:`https://${o.id}.example`,city:'',status:'À analyser',project_id:'bench',organization_id:'org',evidence:[],channels:[],...o});
 return [
  // Verified + declared by the person + a source to check + nothing on contactability.
  P({id:'kantina',name:'Kantina',city:'Toulouse',status:'À contacter',evidence:[
   ev(now,{id:'k-v',criterion:'target_fit',status:'VERIFIED',verified_by:'u',source_url:'https://presse.example/kantina',excerpt:'Kantina ouvre un second restaurant à Toulouse.'}),
   ev(now,{id:'k-d',criterion:'local_decision',status:'USER_DECLARED',note:'Le gérant décide seul, vu au salon.'}),
   ev(now,{id:'k-n',criterion:'need_fit',status:'NOT_VERIFIED',source_url:'https://kantina.example/commande',excerpt:'Commandez directement sur notre site.'}),
  ],channels:[{kind:'linkedin',value:'https://www.linkedin.com/company/kantina-example',source_url:'https://kantina.example',verified:true},{kind:'email',value:'contact@kantina.example',source_url:'https://kantina.example',verified:false}]}),
  // Only a declaration: estimated, never "Vérifié".
  P({id:'mojo',name:'Mojo Burger',city:'Montpellier',evidence:[
   ev(now,{id:'m-d',criterion:'target_fit',status:'USER_DECLARED'}),
   ev(now,{id:'m-f',criterion:'local_decision',status:'USER_DECLARED',value:false,note:'Groupe avec achats centralisés.'}),
  ]}),
  // Nothing documented.
  P({id:'crousti',name:'O’Crousti Poulet',status:'Contacté'}),
  // Fully verified.
  P({id:'pausa',name:'La Pausa',city:'Nîmes',status:'Intéressé',evidence:[
   ev(now,{id:'p-1',criterion:'target_fit',status:'VERIFIED',verified_by:'u',source_url:'https://presse.example/pausa',excerpt:'La Pausa, pizzeria de Nîmes.'}),
   ev(now,{id:'p-2',criterion:'contactability',status:'VERIFIED',verified_by:'u',source_url:'https://lapausa.example/contact',excerpt:'Téléphone : 04 00 00 00 00.'}),
  ]}),
  // An inference to check, and a long name for 320 px.
  P({id:'brasserie',name:'Brasserie du Grand Marché Couvert de Perpignan',city:'Perpignan',evidence:[
   ev(now,{id:'b-i',criterion:'need_fit',status:'INFERRED_UNCONFIRMED',source_url:'https://annuaire.example/brasserie',excerpt:'Livraison via plateformes uniquement.'}),
  ]}),
 ];
}
