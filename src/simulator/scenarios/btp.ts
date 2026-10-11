import type {SimScenario} from '../types.ts';
import {ev,sig} from './build.ts';
// Fictional demonstration data — construction firms and tradespeople. Every company and domain is invented (.example).
const REF='2026-10-01T12:00:00Z';
const A='batisseurs-exemple.example',B='charpentes-demo.example',C='renov-exemple.example';
export const btp:SimScenario={
 id:'btp',version:1,label:'Bâtiment et travaux',reference_date:REF,
 match:{
  target:[{stem:'btp',label:'BTP'},{stem:'batiment',label:'bâtiment'},{stem:'construct',label:'construction'},{stem:'macon',label:'maçonnerie'},{stem:'plomb',label:'plomberie'},{stem:'electricien',label:'électricien'},{stem:'menuis',label:'menuiserie'},{stem:'couvr',label:'couverture'},{stem:'charpent',label:'charpente'},{stem:'travaux',label:'travaux'},{stem:'artisan',label:'artisans'},{stem:'renov',label:'rénovation'}],
  offer:[{stem:'chantier',label:'chantier'},{stem:'devis',label:'devis'},{stem:'planning',label:'planning'},{stem:'materiel',label:'matériel'},{stem:'location',label:'location'},{stem:'securite',label:'sécurité'},{stem:'assur',label:'assurance'}],
 },
 criteria:[
  {key:'construction',label:'Entreprise du bâtiment',weight:30},
  {key:'size',label:'Plus de 10 salariés',weight:20},
  {key:'public_works',label:'Chantiers publics',weight:25},
  {key:'equipment',label:'Parc matériel ou véhicules',weight:25},
 ],
 prospects:[
  {id:'btp-batisseurs',name:'Bâtisseurs Exemple',fictional:true,domain:A,sector_label:'Gros œuvre',size_label:'30 à 50 personnes',
   evidence:[ev(REF,A,'btp-batisseurs-e1','construction','Le site présente une entreprise de gros œuvre et de rénovation.','VERIFIED',30),
    ev(REF,A,'btp-batisseurs-e2','public_works','Les références citent des chantiers pour des collectivités.','VERIFIED',30,'/references'),
    ev(REF,A,'btp-batisseurs-e3','size','La page « entreprise » évoque plusieurs équipes de chantier.','NOT_VERIFIED',30,'/entreprise')],
   signals:[sig(REF,A,'btp-batisseurs-s1','public_contract_won','Marché public remporté : rénovation d’un groupe scolaire','Avis d’attribution : rénovation d’un groupe scolaire attribuée à l’entreprise.','VERIFIED',25,'public_procurement','/marches')],
   public_content:[],angle_ref:{type:'signal',source_id:'btp-batisseurs-s1'}},
  {id:'btp-charpentes',name:'Charpentes Démo',fictional:true,domain:B,sector_label:'Charpente et couverture',size_label:'10 à 20 personnes',
   evidence:[ev(REF,B,'btp-charpentes-e1','construction','Le site présente un atelier de charpente et couverture.','VERIFIED',20),
    ev(REF,B,'btp-charpentes-e2','equipment','Une galerie montre des engins de levage.','NOT_VERIFIED',20,'/galerie')],
   signals:[sig(REF,B,'btp-charpentes-s1','hiring_role','Offre d’emploi : chef d’équipe charpentier','Une offre de chef d’équipe est publiée.','PENDING_REVIEW',9,'job_board','/emploi')],
   public_content:[],angle_ref:{type:'evidence',source_id:'btp-charpentes-e1'}},
  {id:'btp-renov',name:'Rénov Exemple',fictional:true,domain:C,sector_label:'Rénovation',size_label:'Taille non documentée',
   evidence:[ev(REF,C,'btp-renov-e1','construction','Le site mentionne des travaux de rénovation intérieure.','NOT_VERIFIED',40)],
   signals:[],public_content:[],angle_ref:{type:'generic',source_id:null}},
 ],
};
