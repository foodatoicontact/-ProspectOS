import type {Metadata} from 'next';
import {PublicSeoPage} from '../../src/components/PublicSeoPage';
import {WatchRequestForm} from '../../src/components/WatchRequestForm';
import {creationsMetadata} from '../../src/components/CompanyCreations';
import type {SeoPage} from '../../src/domain/seo';

// « Demander un devis » de veille dédiée (owner decision, 26 nov. 2026): the real form that replaces the mailto of /tarifs and
// /veille-entreprises. The request is stored for the administrator's cockpit (app/api/public/demande-veille, migration 056).
const page:SeoPage={
 slug:'demande-veille',navLabel:'Demander un devis de veille',updated:'2026-11-26',
 keywords:{primary:'devis veille entreprises',secondary:['veille dédiée prospects','liste d’entreprises à jour']},
 title:'Demander un devis de veille dédiée | ProspectOS',
 description:'Décrivez votre cible et vos zones : vous recevez un devis de veille dédiée (prix, durée, fréquence de mise à jour, conditions d’arrêt) avant tout engagement.',
 eyebrow:'Veille dédiée · Sur devis',
 h1:'Demander un devis de veille dédiée',
 intro:'ProspectOS constitue pour votre cible et vos zones une liste d’entreprises à partir du registre, du BODACC et du BOAMP, la met à jour à la fréquence convenue et vous la livre en PDF et en CSV. Décrivez votre besoin : je reviens vers vous avec un devis.',
 sections:[
  {h2:'Ce que contient le devis',blocks:[
   {type:'ul',items:[
    'Le prix, la durée et la fréquence de mise à jour de la liste.',
    'Les sources utilisées pour votre cible et ce qu’elles permettent de repérer.',
    'Les conditions d’arrêt, avant tout engagement.',
   ]},
  ]},
 ],
 faq:[
  {q:'Que devient ma demande ?',a:'Elle est enregistrée par ProspectOS pour préparer le devis et vous recontacter à ce sujet, puis supprimée 12 mois après son envoi. Pas de newsletter, pas de revente.'},
  {q:'Vous préférez l’écrire ?',a:'Écrivez à contact@prospectos.fr avec votre métier et vos départements.'},
 ],
 cta:{title:'Vous préférez chercher vous-même ?',text:'Les offres en libre-service vous laissent lancer vos recherches quand vous le souhaitez.',href:'/tarifs',label:'Voir les tarifs'},
 related:['veille-entreprises','prospection-b2b','prioriser-liste-prospects'],
};

export const metadata:Metadata=creationsMetadata(page);
export default function Page(){return <PublicSeoPage page={page}><WatchRequestForm/></PublicSeoPage>}
