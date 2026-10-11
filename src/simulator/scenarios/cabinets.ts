import type {SimScenario} from '../types.ts';
import {ev,sig,content} from './build.ts';
// Fictional demonstration data — accounting, legal and consulting firms. Every company and domain is invented.
const REF='2026-10-01T12:00:00Z';
const A='cabinet-exemple.example',B='fiduciaire-demo.example',C='juris-exemple.example';
export const cabinets:SimScenario={
 id:'cabinets',version:1,label:'Cabinets comptables, juridiques et de conseil',reference_date:REF,
 match:{
  target:[{stem:'cabinet',label:'cabinet'},{stem:'comptab',label:'comptabilité'},{stem:'expert',label:'expert-comptable'},{stem:'avocat',label:'avocat'},{stem:'notaire',label:'notaire'},{stem:'juridiq',label:'juridique'},{stem:'conseil',label:'conseil'},{stem:'fiduciair',label:'fiduciaire'}],
  offer:[{stem:'gestion',label:'gestion'},{stem:'factur',label:'facturation'},{stem:'signature',label:'signature'},{stem:'document',label:'documents'},{stem:'rgpd',label:'RGPD'},{stem:'conformit',label:'conformité'},{stem:'paie',label:'paie'}],
 },
 criteria:[
  {key:'profession',label:'Cabinet comptable, juridique ou de conseil',weight:35},
  {key:'team',label:'Équipe de 5 personnes ou plus',weight:20},
  {key:'clients',label:'Clientèle de PME',weight:25},
  {key:'growth',label:'Développement ou nouvelle offre',weight:20},
 ],
 prospects:[
  {id:'cab-conseil',name:'Cabinet Exemple Conseil',fictional:true,domain:A,sector_label:'Expertise comptable',size_label:'10 à 15 personnes',
   evidence:[ev(REF,A,'cab-conseil-e1','profession','Le site présente un cabinet d’expertise comptable.','VERIFIED',20),
    ev(REF,A,'cab-conseil-e2','clients','La page « clients » cite des commerçants et des PME.','NOT_VERIFIED',20,'/clients')],
   signals:[sig(REF,A,'cab-conseil-s1','leadership_change','Arrivée d’un nouvel associé','Le cabinet annonce l’arrivée d’un nouvel associé.','VERIFIED',10,'official_website')],
   public_content:[],angle_ref:{type:'signal',source_id:'cab-conseil-s1'}},
  {id:'cab-fiduciaire',name:'Fiduciaire Démo',fictional:true,domain:B,sector_label:'Gestion et paie',size_label:'6 à 10 personnes',
   evidence:[ev(REF,B,'cab-fiduciaire-e1','profession','Le site présente un cabinet de gestion et de paie.','VERIFIED',25),
    ev(REF,B,'cab-fiduciaire-e2','team','La page équipe présente huit collaborateurs.','VERIFIED',25,'/equipe')],
   signals:[],
   public_content:[content(REF,B,'cab-fiduciaire-c1','Nous lançons une offre d’accompagnement à la facture électronique.','PENDING_REVIEW',12)],
   angle_ref:{type:'evidence',source_id:'cab-fiduciaire-e1'}},
  {id:'cab-juris',name:'Juris Exemple',fictional:true,domain:C,sector_label:'Conseil juridique',size_label:'Taille non documentée',
   evidence:[ev(REF,C,'cab-juris-e1','profession','Le nom et le site laissent supposer une activité juridique.','INFERRED_UNCONFIRMED',35)],
   signals:[],public_content:[],angle_ref:{type:'generic',source_id:null}},
 ],
};
