// Programme partenaires (052) — the text of /partenaires.
// The CONDITIONS are the owner's text (25 nov. 2026), pasted word for word. Only « [date de mise en ligne] » is replaced
// by PARTNER_TERMS_VERSION_DATE, and the three figures the product computes with (rate, duration, payout threshold) are
// written from the SAME constants as the commission rules (src/partners/model.ts, checked against migration 052 by
// tests/partner-program.test.ts): the page can never announce one figure while the ledger applies another.
// While PARTNER_TERMS_VERSION_DATE is empty, /partenaires is not shown (404), whatever the flag.
import {DEFAULT_RATE_PERCENT,COMMISSION_MONTHS,PAYOUT_THRESHOLD_CENTS} from './model.ts';

// Fixed by Kevin when the programme is switched back on, e.g. '1er décembre 2026'. Empty: the public page stays hidden.
export const PARTNER_TERMS_VERSION_DATE:string='';

const RATE=`${DEFAULT_RATE_PERCENT} %`;
const MONTHS=`${COMMISSION_MONTHS} mois`;
const THRESHOLD=`${PAYOUT_THRESHOLD_CENTS/100} €`;

export const PARTNER_CONDITIONS_TITLE='CONDITIONS DU PROGRAMME PARTENAIRES PROSPECTOS';
export const partnerConditionsVersion=(date:string)=>`Version du ${date}`;
export const PARTNER_CONDITIONS:{title:string;text:string}[]=[
 {title:'1. Objet',text:'Le programme partenaires permet à des professionnels de recommander ProspectOS et de percevoir une commission sur les abonnements payés par les clients qu\'ils apportent.'},
 {title:'2. Partenaires éligibles',text:'Le programme est ouvert aux professionnels immatriculés (numéro SIRET obligatoire). Chaque candidature est examinée par ProspectOS, qui peut l\'accepter ou la refuser sans avoir à se justifier. Le partenaire reçoit un code et un lien personnels.'},
 {title:'3. Client apporté',text:'Est considéré comme apporté un client qui crée un nouveau compte ProspectOS en utilisant le lien ou le code du partenaire. Le code doit être renseigné au moment de l\'inscription et ne peut pas être ajouté après coup. Un compte existant, ou un compte créé par le partenaire pour lui-même, n\'ouvre droit à aucune commission.'},
 {title:'4. Commission',text:`Le partenaire perçoit ${RATE} du montant hors taxes effectivement encaissé par ProspectOS au titre de l'abonnement du client apporté, pendant les ${MONTHS} qui suivent son premier paiement. Les périodes d'essai gratuites ne donnent lieu à aucune commission. En cas de remboursement, la commission correspondante est déduite du solde du partenaire.`},
 {title:'5. Relevé et versement',text:`Un relevé mensuel est disponible dans l'espace partenaire. Le versement intervient par virement, sur facture du partenaire du montant du relevé, dans les 30 jours suivant sa réception, dès que le solde atteint ${THRESHOLD} HT. En dessous de ce seuil, le solde est reporté au mois suivant.`},
 {title:'6. Engagements du partenaire',text:'Le partenaire recommande ProspectOS de façon loyale et exacte. Sont interdits : l\'envoi de messages non sollicités en masse, l\'automatisation de la prospection sur LinkedIn, l\'achat de publicités sur le nom ProspectOS, toute promesse de résultat ou de fonctionnalité que l\'outil ne propose pas, et toute pratique contraire au RGPD. Le partenaire agit en toute indépendance : il n\'est ni salarié ni mandataire de ProspectOS et ne peut prendre aucun engagement en son nom.'},
 {title:'7. Manquement',text:'En cas de manquement à ces conditions ou de fraude, ProspectOS peut suspendre le partenaire et annuler les commissions liées aux clients concernés.'},
 {title:'8. Durée, résiliation et modification',text:'Chaque partie peut mettre fin à sa participation à tout moment, avec un préavis de 30 jours. Les commissions sur les paiements encaissés avant la date de fin restent dues. ProspectOS peut modifier ces conditions en prévenant les partenaires 30 jours à l\'avance ; les nouvelles conditions ne s\'appliquent qu\'aux clients apportés après leur entrée en vigueur.'},
 {title:'9. Données personnelles',text:'Les données du partenaire (nom, entreprise, SIRET, e-mail) sont utilisées uniquement pour gérer le programme et les versements. Le partenaire ne reçoit aucune donnée personnelle sur les clients qu\'il apporte, seulement des montants. Voir la politique de confidentialité.'},
 {title:'10. Droit applicable',text:'Ces conditions sont soumises au droit français. Tout litige relève des tribunaux de Toulouse.'},
];

// The short summary above the conditions: only what the product enforces, with the same constants.
export const PARTNER_SUMMARY:string[]=[
 `${RATE} du montant hors taxes payé par chaque client que vous apportez, pendant ses ${COMMISSION_MONTHS} premiers mois à compter de son premier paiement.`,
 'Un client vous est attribué s’il s’inscrit avec votre lien (?ref=VOTRECODE) ou s’il saisit votre code dans le champ « Code partenaire » à l’inscription. Aucun cookie n’est utilisé.',
 'Un relevé est établi le 1er de chaque mois : clients apportés, paiements, commissions du mois, solde cumulé.',
 `Le solde est versé par virement à partir de ${THRESHOLD} HT ; en dessous, il est reporté au mois suivant. Un remboursement accordé à un client annule la commission correspondante.`,
 'Vous suivez tout dans votre espace partenaire. Vos clients y apparaissent sous une référence anonyme : ProspectOS ne vous communique ni leur nom ni leurs coordonnées.',
];
