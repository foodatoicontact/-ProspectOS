'use client';
// Veille dédiée bench (/ui-v2/veille-dediee, Preview only — the /ui-v2 layout answers 404 without UI_V2_BENCH_ENABLED):
// both screens on FICTITIOUS data, actions applied locally. No real company, person or client in this file.
import {useEffect,useState} from 'react';
import {DedicatedClientView,DedicatedAdminView,type ClientData,type AdminView} from './DedicatedViews.tsx';
import {DedicatedNotice} from './DedicatedNotice.tsx';
const C='00000000-0000-4000-8000-00000000c001',D1='00000000-0000-4000-8000-0000000000d1',D2='00000000-0000-4000-8000-0000000000d2';
const src=(n:number)=>`https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A2026${String(n).padStart(4,'0')}`;
const item=(n:number,d:string,num:number,name:string,city:string,status:ClientData['items'][number]['status'],extra:Partial<ClientData['items'][number]>={}):ClientData['items'][number]=>({
 id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,delivery_id:d,contract_id:C,reference:`L${num}-F${String(n%100).padStart(3,'0')}`,siren:String(800000000+n*1117).slice(0,9),
 name,city,source_label:'BODACC — immatriculation',source_url:src(n),delivered_on:num===2?'2026-11-23':'2026-11-16',status,status_changed_at:null,first_invoice_on:null,known_proof:null,statement_id:null,...extra});
export const BENCH_CLIENT:ClientData={
 contracts:[{id:C,label:'Veille Île-de-France — exemple',minimum_ht_cents:9900,commission_ht_cents:17900,known_client_days:15,first_statement_month:'2026-12-01',status:'ACTIVE',trial_starts_on:'2026-11-16',accepted_at:'2026-11-15T18:20:00Z',terminated_at:null}],
 proposals:[{contract_id:C,version:1,file_name:'proposition-exemple.pdf',sha256:'3f0c1d9e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f10',created_at:'2026-11-14T10:00:00Z'}],
 deliveries:[{id:D2,contract_id:C,number:2,delivered_on:'2026-11-23',scope:'Île-de-France — semaine 48',pdf_sha256:'b'.repeat(64),pdf_file_name:'livraison-exemple.pdf',
   header:{prepared_for:'Exemple Sécurité',eyebrow:'Île-de-France · 23 novembre 2026',lead:'',title_count:3},
   sections:[{key:'tr',title:'Entreprises qui déménagent',subtitle:'transfert de siège publié ces trois dernières semaines',source:'BODACC — annonces légales',color:'#5b8def',badge:'BODACC'},
    {key:'syn',title:'Syndics & administrateurs de biens',subtitle:'qui viennent de racheter un portefeuille',source:'BODACC — annonces légales',color:'#f0a33a',badge:'BODACC'}]},
  {id:D1,contract_id:C,number:1,delivered_on:'2026-11-16',scope:'Île-de-France — liste simple, semaine 47'}],
 items:[
  item(101,D2,2,'EXEMPLE LOGISTIQUE','Meaux','A_CONTACTER',{reference:'L2-F001',section_key:'tr',badge:'BODACC',department:'77',event_label:'12 novembre 2026',chips:['Entreposage · 20 à 49 salariés'],
   fact:'Transfert du siège social.',why_now:'Une nouvelle adresse peut signifier de nouveaux locaux : extincteurs, BAES, plans d’évacuation et vérification à prévoir.',
   hook:'J’ai vu que vous avez transféré votre siège à Meaux mi-novembre — vos nouveaux locaux sont déjà équipés et vérifiés côté incendie ?'}),
  item(102,D2,2,'ATELIER FICTIF','Montreuil','CONTACTE',{reference:'L2-F002',section_key:'tr',badge:'BODACC',department:'93',event_label:'10 novembre 2026',chips:['Menuiserie · 10 à 19 salariés'],
   fact:'Transfert du siège social.',why_now:'Une nouvelle adresse peut signifier de nouveaux locaux : extincteurs, BAES, plans d’évacuation et vérification à prévoir.',
   hook:'J’ai vu que vous avez transféré votre siège à Montreuil début novembre — vos nouveaux locaux sont déjà équipés et vérifiés côté incendie ?'}),
  item(103,D2,2,'SYNDIC EXEMPLE','Chelles','DEVIS_ENVOYE',{reference:'L2-F003',section_key:'syn',badge:'BODACC',department:'77',event_label:'2 octobre 2026',chips:['Fonds acquis : 100 000 €'],
   fact:'Rachat d’un portefeuille de gestion d’immeubles.',why_now:'Nouveau portefeuille, nouveaux immeubles à prendre en main.',
   hook:'J’ai vu que vous avez repris un portefeuille de gestion en octobre. Qui s’occupe aujourd’hui des vérifications incendie de ces immeubles ?'}),
  item(1,D1,1,'ENTREPÔT DÉMO LOGISTIQUE','Chelles','SIGNE',{first_invoice_on:'2026-12-03'}),item(2,D1,1,'SARL BOULANGERIE EXEMPLE','Lagny-sur-Marne','DEVIS_ENVOYE'),
  item(3,D1,1,'GARAGE FICTIF DU CENTRE','Meaux','DEJA_CLIENT',{known_proof:{kind:'facture',dated_on:'2026-03-02',reference:'F-2026-031'}}),item(4,D1,1,'CABINET TEST CONSEIL','Serris','PERDU')],
 statements:[{id:'00000000-0000-4000-8000-0000000005a1',contract_id:C,month:'2026-12-01',signed_count:1,minimum_ht_cents:9900,commission_ht_cents:17900,amount_ht_cents:17900,
  items:[{reference:'L1-F001',name:'ENTREPÔT DÉMO LOGISTIQUE',siren:'800001117',first_invoice_on:'2026-12-03'}],validated_at:null}],
};
export const BENCH_ADMIN:AdminView[]=[
 {contract:{...BENCH_CLIENT.contracts[0],organization:'Exemple Sécurité Incendie',proposal:{version:1,sha256:'3f0c1d9e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f10',file_name:'proposition-exemple.pdf'}},deliveries:2,counters:{delivered:6,opened:5,exported:4,contacted:3,quoted:2,signed:1,lost:1,known:1},
  alerts:[{kind:'EXPORT_IDLE',text:'2 fiches exportées sans changement de statut depuis 30 jours',items:['L1-F005','L1-F006']},{kind:'STATEMENT_UNVALIDATED',text:'Relevé de décembre 2026 non validé (179,00 € HT)'}],
  statements:[{id:'s1',month:'2026-12-01',signed_count:1,amount_ht_cents:17900,validated_at:null}]},
 {contract:{id:'00000000-0000-4000-8000-00000000c002',label:'Veille Occitanie — exemple',minimum_ht_cents:9900,commission_ht_cents:17900,known_client_days:15,first_statement_month:'2026-12-01',organization:'Exemple Rénovation Sud',
   status:'PROPOSED',trial_starts_on:'2026-12-01',accepted_at:null,terminated_at:null,proposal:{version:2,sha256:'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9',file_name:'proposition-renovation-v2.pdf'}},
  deliveries:4,counters:{delivered:48,opened:41,exported:30,contacted:22,quoted:9,signed:3,lost:4,known:2},alerts:[],
  statements:[{id:'s2',month:'2026-12-01',signed_count:3,amount_ht_cents:53700,validated_at:'2027-01-03T09:12:00Z'}]},
];
// A local review can pass other data (a real delivery kept outside git) through window.__POS_DEDICATED_BENCH__, set by the
// browser automation before the page loads. Nothing is fetched and nothing is stored: without it, the fictitious data.
const injected=():ClientData|null=>typeof window!=='undefined'?((window as unknown as {__POS_DEDICATED_BENCH__?:ClientData}).__POS_DEDICATED_BENCH__??null):null;
export function DedicatedBench({view}:{view:'client'|'admin'|'proposal'}){
 const [data,setData]=useState<ClientData>(()=>(view==='proposal'?{...BENCH_CLIENT,contracts:BENCH_CLIENT.contracts.map(c=>({...c,status:'PROPOSED',accepted_at:null})),deliveries:[],items:[],statements:[]}:BENCH_CLIENT));
 useEffect(()=>{const i=injected();if(i)setData(i)},[]);const [notice,setNotice]=useState('');
 const [signIn,setSignIn]=useState(view==='proposal');
 return <div className="pos-ui" style={{minHeight:'100vh',background:'var(--pos-bg)'}}>{signIn&&<DedicatedNotice proposals={1} statements={0} onOpen={()=>setSignIn(false)}/>}{view==='admin'
  ?<DedicatedAdminView rows={BENCH_ADMIN} busy={false} error="" notice={notice} onDelivery={()=>setNotice('Livraison créée (banc de test).')} onDocDelivery={()=>setNotice('Livraison créée (banc de test).')} onSearch={async()=>[]} onPropose={()=>setNotice('Veille proposée (banc de test).')} onReplace={()=>setNotice('Version jointe (banc de test).')} onTerminate={()=>setNotice('Veille résiliée (banc de test).')}/>
  :<DedicatedClientView data={data} today="2027-01-02" busy={false} error="" notice={notice}
    onReadProposal={()=>setNotice('Ouverture du PDF (banc de test).')} onAccept={()=>{setData({...data,contracts:data.contracts.map(c=>({...c,status:'ACTIVE',accepted_at:'2027-01-02T10:00:00Z'}))});setNotice('Proposition acceptée : votre espace de suivi est ouvert.')}}
    onValidate={id=>{setData({...data,statements:data.statements.map(s=>s.id===id?{...s,validated_at:'2027-01-02T10:00:00Z'}:s)});setNotice('Relevé validé. Merci.')}}
    onOpen={async()=>[{kind:'ITEM_OPENED',detail:{},created_at:'2027-01-02T09:40:00Z'},{kind:'STATUS_CHANGED',detail:{from:'A_CONTACTER',to:'CONTACTE'},created_at:'2026-11-25T14:02:00Z'},{kind:'EXPORT',detail:{},created_at:'2026-11-24T08:15:00Z'}]}
    onStatus={async(id,c)=>{setData({...data,items:data.items.map(i=>i.id===id?{...i,status:c.status}:i)});setNotice('Statut enregistré.')}}
    onExport={()=>setNotice('Export téléchargé et inscrit au journal.')}/>}</div>;
}
