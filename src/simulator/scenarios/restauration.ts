import type {SimScenario} from '../types.ts';
import {ev,sig} from './build.ts';
// Fictional demonstration data — restaurants and food retail. Every company and domain is invented (.example).
const REF='2026-10-01T12:00:00Z';
const A='comptoir-exemple.example',B='fournil-demo.example',C='traiteur-exemple.example';
export const restauration:SimScenario={
 id:'restauration',version:1,label:'Restauration et commerce de bouche',reference_date:REF,
 match:{
  target:[{stem:'restaur',label:'restauration'},{stem:'brasser',label:'brasserie'},{stem:'bistro',label:'bistrot'},{stem:'pizz',label:'pizzeria'},{stem:'boulang',label:'boulangerie'},{stem:'traiteur',label:'traiteur'},{stem:'snack',label:'snacking'},{stem:'cafe',label:'café'},{stem:'bouche',label:'commerce de bouche'},{stem:'food',label:'food'}],
  offer:[{stem:'commande',label:'commande'},{stem:'caisse',label:'caisse'},{stem:'click',label:'click & collect'},{stem:'emporter',label:'vente à emporter'},{stem:'livraison',label:'livraison'},{stem:'menu',label:'menu'},{stem:'reservation',label:'réservation'}],
 },
 criteria:[
  {key:'food',label:'Restauration ou commerce de bouche',weight:30},
  {key:'pickup',label:'Vente à emporter ou retrait',weight:25},
  {key:'phone_orders',label:'Commandes par téléphone',weight:20},
  {key:'no_online',label:'Pas de commande en ligne en propre',weight:25},
 ],
 prospects:[
  {id:'resto-comptoir',name:'Le Comptoir Exemple',fictional:true,domain:A,sector_label:'Restaurant',size_label:'8 à 12 personnes',
   evidence:[ev(REF,A,'resto-comptoir-e1','food','La page d’accueil présente un restaurant de cuisine de saison.','VERIFIED',20),
    ev(REF,A,'resto-comptoir-e2','pickup','Le menu indique des plats à emporter le midi.','VERIFIED',20,'/menu'),
    ev(REF,A,'resto-comptoir-e3','phone_orders','Un numéro est affiché « pour vos commandes ».','NOT_VERIFIED',20,'/contact'),
    ev(REF,A,'resto-comptoir-e4','no_online','Aucun module de commande en ligne n’apparaît sur le site.','INFERRED_UNCONFIRMED',20)],
   signals:[sig(REF,A,'resto-comptoir-s1','new_site','Ouverture d’un second point de vente annoncée','Le restaurant annonce l’ouverture d’un second point de vente au printemps.','VERIFIED',12,'official_website')],
   public_content:[],angle_ref:{type:'signal',source_id:'resto-comptoir-s1'}},
  {id:'resto-fournil',name:'Fournil Démo',fictional:true,domain:B,sector_label:'Boulangerie',size_label:'5 à 8 personnes',
   evidence:[ev(REF,B,'resto-fournil-e1','food','Le site présente une boulangerie-pâtisserie artisanale.','VERIFIED',15),
    ev(REF,B,'resto-fournil-e2','phone_orders','La page précise : « commandes de gâteaux par téléphone ».','VERIFIED',15,'/commandes'),
    ev(REF,B,'resto-fournil-e3','pickup','Un encart mentionne un retrait en boutique.','NOT_VERIFIED',15,'/commandes')],
   signals:[sig(REF,B,'resto-fournil-s1','hiring_role','Offre d’emploi : vendeur ou vendeuse en boulangerie','Une offre d’emploi pour un poste de vente est publiée.','PENDING_REVIEW',6,'job_board','/emploi')],
   public_content:[],angle_ref:{type:'evidence',source_id:'resto-fournil-e1'}},
  {id:'resto-traiteur',name:'Traiteur Exemple',fictional:true,domain:C,sector_label:'Traiteur',size_label:'Taille non documentée',
   evidence:[ev(REF,C,'resto-traiteur-e1','food','Le site décrit une activité de traiteur pour événements.','NOT_VERIFIED',30),
    ev(REF,C,'resto-traiteur-e2','no_online','Les demandes semblent passer par un formulaire de contact.','INFERRED_UNCONFIRMED',30,'/contact')],
   signals:[],public_content:[],angle_ref:{type:'generic',source_id:null}},
 ],
};
