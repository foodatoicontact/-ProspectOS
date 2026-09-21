import {FOODATOI_CRITERIA,type Prospect,type Evidence} from './core.ts';
export const DEMO_ORG='demo-organization';
export const DEMO_PROJECT={id:'foodatoi-demo',organization_id:DEMO_ORG,name:'Foodatoi · Occitanie',offer:'Foodatoi propose votre carte en ligne et une interface comptoir pour les commandes à retirer, avec un abonnement fixe sans commission Foodatoi sur les ventes.',criteria:FOODATOI_CRITERIA};
function facts(source:string,items:[string,boolean,string][]):Evidence[]{return items.map(([criterion,value,excerpt],i)=>({id:`${source}-${i}`,criterion,value,excerpt,source_url:source,observed_at:'2026-09-16',status:'NOT_VERIFIED',verified_by:null}))}
export const DEMO_PROSPECTS:Prospect[]=[
 {id:'newschool',project_id:DEMO_PROJECT.id,organization_id:DEMO_ORG,name:'New School Tacos · Minimes',city:'Toulouse',website:'https://www.newschooltacos.fr/restaurants/toulouse-minimes',status:'À analyser',evidence:facts('https://www.newschooltacos.fr/restaurants/toulouse-minimes',[
 ['food',true,'La page officielle présente un restaurant de tacos.'],['region',true,'Adresse publiée : 110 boulevard Silvio Trentin, Toulouse.'],['phone_orders',true,'La page propose explicitement les commandes par téléphone.'],['platforms',true,'La page mentionne la livraison via Uber Eats.']]),channels:[{kind:'phone',value:'05 61 22 59 49',source_url:'https://www.newschooltacos.fr/restaurants/toulouse-minimes',verified:true}]},
 {id:'ofuzion',project_id:DEMO_PROJECT.id,organization_id:DEMO_ORG,name:'O’Fuzion',city:'Toulouse',website:'https://linktr.ee/ofuzion31',status:'À analyser',evidence:facts('https://linktr.ee/ofuzion31',[
 ['food',true,'Le profil présente une offre de restauration rapide.'],['region',true,'Adresse affichée : 3 rue Sirven, Toulouse.'],['platforms',true,'Le profil relie des pages de commande Uber Eats et Deliveroo.']]),channels:[{kind:'phone',value:'07 45 00 42 71',source_url:'https://linktr.ee/ofuzion31',verified:true}]},
 {id:'lombezienne',project_id:DEMO_PROJECT.id,organization_id:DEMO_ORG,name:'La Lombezienne',city:'Lombez',website:'https://www.lalombezienne.com/',status:'À analyser',evidence:facts('https://www.lalombezienne.com/',[
 ['food',true,'Le site officiel présente une pizzeria artisanale.'],['region',true,'Le site identifie une pizzeria à Lombez.'],['phone_orders',true,'Le parcours propose une commande par téléphone ou la préparation d’un SMS.']]),channels:[{kind:'phone',value:'05 62 06 94 69',source_url:'https://www.lalombezienne.com/',verified:true}]}
];
DEMO_PROSPECTS.push(
 {id:'pimpmyburger',project_id:DEMO_PROJECT.id,organization_id:DEMO_ORG,name:'Pimp My Burger',city:'Toulouse',website:'https://pimpmyburger.fr/',status:'À analyser',evidence:facts('https://pimpmyburger.fr/',[['food',true,'BURGERS'],['region',true,'54 avenue Jules Julien / 31400 Toulouse'],['platforms',true,'Livraison via Uber Eats & Deliveroo']]),channels:[]},
 {id:'bapz',project_id:DEMO_PROJECT.id,organization_id:DEMO_ORG,name:'Bapz',city:'Toulouse',website:'https://www.bapz.fr/',status:'À analyser',evidence:facts('https://www.bapz.fr/',[['food',true,'Nos pâtisseries à emporter ou à commander en ligne'],['region',true,'salon de thé à Toulouse']]),channels:[]}
);
export const DEMO_NOTES:Record<string,string>={pimpmyburger:'Une commande et un retrait sont proposés. Aucun déficit de click & collect établi.',bapz:'Commande en ligne et retrait sur place déjà annoncés : vérifier le besoin réel avant approche.',newschool:'Un lien de commande en ligne existe. Le fonctionnement du retrait et l’autonomie du franchisé restent à vérifier.',ofuzion:'Une solution directe Rushour est déjà liée. Cela ne prouve pas une livraison par une équipe interne. Audience et commandes sociales à confirmer.',lombezienne:'Un panier web et une préparation SMS existent. Ne pas présenter cet établissement comme dépourvu de solution numérique.'};
// Shown once when a visitor enters the demo — explains the evidence-first mechanics before they see a
// 0/100 score, so that state reads as "nothing reviewed yet" instead of "the engine is broken". Kept to
// exactly the 7 factual steps of the product's own mechanism — no marketing language, nothing a human
// reviewer hasn't actually done in this demo's own UI.
export const DEMO_ONBOARDING_STEPS:string[]=[
 'ProspectOS découvre une entreprise.',
 'Il collecte des observations depuis des sources publiques.',
 'Les observations ne deviennent pas automatiquement des preuves.',
 'L’humain vérifie.',
 'Seules les preuves vérifiées alimentent le score.',
 'ProspectOS prépare ensuite l’approche.',
 'L’envoi reste humain.',
];
// A visible, honest marker — never mixed with the fixture label below. These 5 establishments are real
// public businesses (see the excerpts' own source URLs); nothing here is invented or private. Wording
// deliberately separates "this company exists" from "this data is already verified" — a prior version
// ("sources publiques") read as if the data were already trustworthy, when every evidence row here
// starts NOT_VERIFIED until a human reviews it.
export const DEMO_REAL_LABEL='Entreprise réelle · données publiques à vérifier';
// Read alongside DEMO_ONBOARDING_STEPS. States plainly what this public demo does and does not run live,
// so nobody concludes from the 5 real establishments or from a fixture "Analyser le site" run that the
// demo just demonstrated a live web search or a live site analysis — neither ever happens here. Never
// say the 5 establishments were "discovered live" or their observations came from a live analysis: they
// were prepared in advance for review, exactly as stated below.
export const DEMO_LIVE_LIMITATIONS:string[]=[
 'Les 5 établissements Foodatoi sont des entreprises réelles ; leurs données publiques sont proposées ici pour revue humaine, pas générées à la volée.',
 '« Trouver des prospects » fonctionne uniquement sur des exemples TEST synthétiques dans cette démo — aucune recherche web réelle n’est jamais lancée.',
 'L’extraction ou l’analyse d’un site réel en direct n’est pas exécutée dans cette démo publique.',
 'Cette capacité est disponible dans l’espace bêta connecté, selon les droits applicables.',
];
