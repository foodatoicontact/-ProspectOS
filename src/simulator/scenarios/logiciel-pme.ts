import type {SimScenario} from '../types.ts';
import {ev,sig,content} from './build.ts';
// Fictional demonstration data — software sold to small and mid-sized companies. Every company and domain is invented.
const REF='2026-10-01T12:00:00Z';
const A='horizon-exemple.example',B='nordique-demo.example',C='studio-exemple.example';
export const logicielPme:SimScenario={
 id:'logiciel-pme',version:1,label:'Logiciel ou SaaS pour PME',reference_date:REF,
 match:{
  target:[{stem:'pme',label:'PME'},{stem:'tpe',label:'TPE'},{stem:'eti',label:'ETI'},{stem:'startup',label:'startup'},{stem:'agence',label:'agence'},{stem:'esn',label:'ESN'},{stem:'scaleup',label:'scale-up'}],
  offer:[{stem:'logiciel',label:'logiciel'},{stem:'saas',label:'SaaS'},{stem:'crm',label:'CRM'},{stem:'erp',label:'ERP'},{stem:'applica',label:'application'},{stem:'plateforme',label:'plateforme'},{stem:'outil',label:'outil'},{stem:'automatis',label:'automatisation'},{stem:'numeriq',label:'numérique'},{stem:'cloud',label:'cloud'}],
 },
 criteria:[
  {key:'sme',label:'PME de 10 à 250 salariés',weight:30},
  {key:'growth',label:'Croissance ou recrutement',weight:25},
  {key:'tooling',label:'Outils encore manuels',weight:25},
  {key:'decision',label:'Décideur identifiable',weight:20},
 ],
 prospects:[
  {id:'saas-horizon',name:'Agence Horizon Exemple',fictional:true,domain:A,sector_label:'Agence de services',size_label:'40 à 60 personnes',
   evidence:[ev(REF,A,'saas-horizon-e1','sme','La page « équipe » présente une cinquantaine de collaborateurs.','VERIFIED',25,'/equipe'),
    ev(REF,A,'saas-horizon-e2','growth','La page carrières liste quatre postes ouverts.','VERIFIED',25,'/carrieres'),
    ev(REF,A,'saas-horizon-e3','tooling','Les devis semblent envoyés en pièce jointe par courriel.','INFERRED_UNCONFIRMED',25)],
   signals:[sig(REF,A,'saas-horizon-s1','funding','Levée de fonds de 2 M€ annoncée','L’agence annonce une levée de fonds de 2 M€ pour accélérer son développement.','VERIFIED',20,'news','/presse')],
   public_content:[],angle_ref:{type:'signal',source_id:'saas-horizon-s1'}},
  {id:'saas-nordique',name:'Nordique Services Démo',fictional:true,domain:B,sector_label:'Services aux entreprises',size_label:'20 à 30 personnes',
   evidence:[ev(REF,B,'saas-nordique-e1','sme','Les mentions légales indiquent une SAS d’environ 25 salariés.','VERIFIED',30,'/mentions-legales'),
    ev(REF,B,'saas-nordique-e2','tooling','La page contact renvoie vers un tableur partagé pour les demandes.','NOT_VERIFIED',30,'/contact')],
   signals:[sig(REF,B,'saas-nordique-s1','headcount_growth','Effectif en hausse sur un an','Une page institutionnelle évoque une équipe en croissance.','PENDING_REVIEW',40,'search_snippet','/a-propos')],
   public_content:[content(REF,B,'saas-nordique-c1','Nous modernisons nos outils internes en 2026 pour mieux suivre nos clients.','VERIFIED',15)],
   angle_ref:{type:'public_content',source_id:'saas-nordique-c1'}},
  {id:'saas-studio',name:'Studio Exemple',fictional:true,domain:C,sector_label:'Studio de création',size_label:'Taille non documentée',
   evidence:[ev(REF,C,'saas-studio-e1','sme','Le site laisse supposer une petite équipe.','INFERRED_UNCONFIRMED',35)],
   signals:[],public_content:[],angle_ref:{type:'generic',source_id:null}},
 ],
};
