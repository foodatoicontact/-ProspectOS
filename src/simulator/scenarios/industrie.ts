import type {SimScenario} from '../types.ts';
import {ev,sig} from './build.ts';
// Fictional demonstration data — manufacturers. Every company and domain is invented (.example).
const REF='2026-10-01T12:00:00Z';
const A='usinage-exemple.example',B='plasturgie-demo.example',C='mecanique-exemple.example';
export const industrie:SimScenario={
 id:'industrie',version:1,label:'Industrie et sites de production',reference_date:REF,
 match:{
  target:[{stem:'industri',label:'industrie'},{stem:'usine',label:'usine'},{stem:'pmi',label:'PMI'},{stem:'fabric',label:'fabrication'},{stem:'manufactur',label:'manufacture'},{stem:'agroalim',label:'agroalimentaire'},{stem:'plasturg',label:'plasturgie'},{stem:'metallurg',label:'métallurgie'},{stem:'mecaniq',label:'mécanique'},{stem:'usinage',label:'usinage'}],
  offer:[{stem:'maintenance',label:'maintenance'},{stem:'machine',label:'machines'},{stem:'capteur',label:'capteurs'},{stem:'qualit',label:'qualité'},{stem:'energ',label:'énergie'},{stem:'automat',label:'automatisme'},{stem:'robot',label:'robotique'},{stem:'gmao',label:'GMAO'}],
 },
 criteria:[
  {key:'industry',label:'Site de production',weight:35},
  {key:'size',label:'Plus de 50 salariés',weight:20},
  {key:'maintenance',label:'Parc machines à entretenir',weight:25},
  {key:'quality',label:'Démarche qualité ou certification',weight:20},
 ],
 prospects:[
  {id:'ind-usinage',name:'Usinage Exemple',fictional:true,domain:A,sector_label:'Usinage de précision',size_label:'60 à 90 personnes',
   evidence:[ev(REF,A,'ind-usinage-e1','industry','Le site présente un atelier d’usinage de précision.','VERIFIED',30),
    ev(REF,A,'ind-usinage-e2','maintenance','La page « parc machines » liste une vingtaine de centres d’usinage.','NOT_VERIFIED',30,'/parc-machines')],
   signals:[sig(REF,A,'ind-usinage-s1','certification','Certification ISO 9001 obtenue','L’entreprise annonce l’obtention de la certification ISO 9001.','VERIFIED',30,'official_website')],
   public_content:[],angle_ref:{type:'signal',source_id:'ind-usinage-s1'}},
  {id:'ind-plasturgie',name:'Plasturgie Démo',fictional:true,domain:B,sector_label:'Plasturgie',size_label:'50 à 70 personnes',
   evidence:[ev(REF,B,'ind-plasturgie-e1','industry','Le site présente une usine d’injection plastique.','VERIFIED',20),
    ev(REF,B,'ind-plasturgie-e2','size','Les mentions légales indiquent un effectif d’environ 60 salariés.','VERIFIED',20,'/mentions-legales')],
   signals:[sig(REF,B,'ind-plasturgie-s1','expansion','Extension du site de production évoquée','Un article évoque l’extension du site de production.','PENDING_REVIEW',14,'news','/presse')],
   public_content:[],angle_ref:{type:'evidence',source_id:'ind-plasturgie-e1'}},
  {id:'ind-mecanique',name:'Mécanique Exemple',fictional:true,domain:C,sector_label:'Mécanique générale',size_label:'Taille non documentée',
   evidence:[ev(REF,C,'ind-mecanique-e1','industry','Le site décrit des travaux de mécanique générale.','NOT_VERIFIED',45)],
   signals:[],public_content:[],angle_ref:{type:'generic',source_id:null}},
 ],
};
