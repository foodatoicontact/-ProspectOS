import type {SimScenario} from '../types.ts';
import {ev,sig} from './build.ts';
// Fictional demonstration data — the generic example used when no scenario is close to the visitor's input. It is
// shown as such ("exemple générique"), never as a match. Every company and domain is invented (.example).
const REF='2026-10-01T12:00:00Z';
const A='entreprise-a.example',B='entreprise-b.example',C='entreprise-c.example';
export const generique:SimScenario={
 id:'generique',version:1,label:'Exemple générique',reference_date:REF,
 match:{target:[],offer:[]},
 criteria:[
  {key:'target',label:'Correspond à votre cible',weight:40},
  {key:'size',label:'Taille compatible avec votre offre',weight:30},
  {key:'need',label:'Besoin observable',weight:30},
 ],
 prospects:[
  {id:'gen-a',name:'Entreprise Exemple A',fictional:true,domain:A,sector_label:'Secteur de votre cible',size_label:'20 à 50 personnes',
   evidence:[ev(REF,A,'gen-a-e1','target','Le site décrit une activité correspondant à la cible.','VERIFIED',20),
    ev(REF,A,'gen-a-e2','need','Une page évoque un projet lié à votre offre.','NOT_VERIFIED',20,'/projets')],
   signals:[sig(REF,A,'gen-a-s1','expansion','Ouverture d’une nouvelle agence','L’entreprise annonce l’ouverture d’une nouvelle agence.','VERIFIED',15,'official_website')],
   public_content:[],angle_ref:{type:'signal',source_id:'gen-a-s1'}},
  {id:'gen-b',name:'Entreprise Exemple B',fictional:true,domain:B,sector_label:'Secteur de votre cible',size_label:'10 à 20 personnes',
   evidence:[ev(REF,B,'gen-b-e1','target','Le site décrit une activité correspondant à la cible.','VERIFIED',25),
    ev(REF,B,'gen-b-e2','size','Les mentions légales laissent penser à une dizaine de salariés.','NOT_VERIFIED',25,'/mentions-legales')],
   signals:[sig(REF,B,'gen-b-s1','hiring_role','Offre d’emploi publiée','Une offre d’emploi est publiée.','PENDING_REVIEW',8,'job_board','/emploi')],
   public_content:[],angle_ref:{type:'evidence',source_id:'gen-b-e1'}},
  {id:'gen-c',name:'Entreprise Exemple C',fictional:true,domain:C,sector_label:'Secteur à confirmer',size_label:'Taille non documentée',
   evidence:[ev(REF,C,'gen-c-e1','target','Le site laisse supposer une activité proche de la cible.','INFERRED_UNCONFIRMED',30)],
   signals:[],public_content:[],angle_ref:{type:'generic',source_id:null}},
 ],
};
