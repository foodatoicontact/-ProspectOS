'use client';
// Veille dédiée bench (/ui-v2/veille-dediee, Preview only — the /ui-v2 layout answers 404 without UI_V2_BENCH_ENABLED):
// both screens on FICTITIOUS data, actions applied locally. No real company, person or client.
import {useState} from 'react';
import {DedicatedClientView,DedicatedAdminView,type ClientData,type AdminView} from './DedicatedViews.tsx';
const C='00000000-0000-4000-8000-00000000c001',D1='00000000-0000-4000-8000-0000000000d1',D2='00000000-0000-4000-8000-0000000000d2';
const src=(n:number)=>`https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A2026${String(n).padStart(4,'0')}`;
const item=(n:number,d:string,num:number,name:string,city:string,status:ClientData['items'][number]['status'],extra:Partial<ClientData['items'][number]>={}):ClientData['items'][number]=>({
 id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,delivery_id:d,contract_id:C,reference:`L${num}-F${String(n%100).padStart(3,'0')}`,siren:String(800000000+n*1117).slice(0,9),
 name,city,source_label:'BODACC — immatriculation',source_url:src(n),delivered_on:num===2?'2026-11-23':'2026-11-16',status,status_changed_at:null,first_invoice_on:null,known_proof:null,statement_id:null,...extra});
export const BENCH_CLIENT:ClientData={
 contracts:[{id:C,label:'Veille Île-de-France — exemple',minimum_ht_cents:9900,commission_ht_cents:17900,known_client_days:15,first_statement_month:'2026-12-01'}],
 deliveries:[{id:D2,contract_id:C,number:2,delivered_on:'2026-11-23',scope:'Île-de-France — créations et transferts, semaine 48'},{id:D1,contract_id:C,number:1,delivered_on:'2026-11-16',scope:'Île-de-France — créations et transferts, semaine 47'}],
 items:[item(101,D2,2,'ATELIER EXEMPLE BOIS','Meaux','A_CONTACTER'),item(102,D2,2,'SAS CUISINES FICTIVES','Torcy','CONTACTE'),
  item(1,D1,1,'ENTREPÔT DÉMO LOGISTIQUE','Chelles','SIGNE',{first_invoice_on:'2026-12-03'}),item(2,D1,1,'SARL BOULANGERIE EXEMPLE','Lagny-sur-Marne','DEVIS_ENVOYE'),
  item(3,D1,1,'GARAGE FICTIF DU CENTRE','Meaux','DEJA_CLIENT',{known_proof:{kind:'facture',dated_on:'2026-03-02',reference:'F-2026-031'}}),item(4,D1,1,'CABINET TEST CONSEIL','Serris','PERDU')],
 statements:[{id:'00000000-0000-4000-8000-0000000005a1',contract_id:C,month:'2026-12-01',signed_count:1,minimum_ht_cents:9900,commission_ht_cents:17900,amount_ht_cents:17900,
  items:[{reference:'L1-F001',name:'ENTREPÔT DÉMO LOGISTIQUE',siren:'800001117',first_invoice_on:'2026-12-03'}],validated_at:null}],
};
export const BENCH_ADMIN:AdminView[]=[
 {contract:{...BENCH_CLIENT.contracts[0],organization:'Exemple Sécurité Incendie'},deliveries:2,counters:{delivered:6,opened:5,exported:4,contacted:3,quoted:2,signed:1,lost:1,known:1},
  alerts:[{kind:'EXPORT_IDLE',text:'2 fiches exportées sans changement de statut depuis 30 jours',items:['L1-F005','L1-F006']},{kind:'STATEMENT_UNVALIDATED',text:'Relevé de décembre 2026 non validé (179,00 € HT)'}],
  statements:[{id:'s1',month:'2026-12-01',signed_count:1,amount_ht_cents:17900,validated_at:null}]},
 {contract:{id:'00000000-0000-4000-8000-00000000c002',label:'Veille Occitanie — exemple',minimum_ht_cents:9900,commission_ht_cents:17900,known_client_days:15,first_statement_month:'2026-12-01',organization:'Exemple Rénovation Sud'},
  deliveries:4,counters:{delivered:48,opened:41,exported:30,contacted:22,quoted:9,signed:3,lost:4,known:2},alerts:[],
  statements:[{id:'s2',month:'2026-12-01',signed_count:3,amount_ht_cents:53700,validated_at:'2027-01-03T09:12:00Z'}]},
];
export function DedicatedBench({view}:{view:'client'|'admin'}){
 const [data,setData]=useState(BENCH_CLIENT);const [notice,setNotice]=useState('');
 return <div className="pos-ui" style={{minHeight:'100vh',background:'var(--pos-bg)'}}>{view==='admin'
  ?<DedicatedAdminView rows={BENCH_ADMIN} busy={false} error="" notice={notice} onDelivery={()=>setNotice('Livraison créée (banc de test).')} onContract={()=>setNotice('Contrat créé (banc de test).')}/>
  :<DedicatedClientView data={data} today="2027-01-02" busy={false} error="" notice={notice}
    onValidate={id=>{setData({...data,statements:data.statements.map(s=>s.id===id?{...s,validated_at:'2027-01-02T10:00:00Z'}:s)});setNotice('Relevé validé. Merci.')}}
    onOpen={async()=>[{kind:'ITEM_OPENED',detail:{},created_at:'2027-01-02T09:40:00Z'},{kind:'STATUS_CHANGED',detail:{from:'A_CONTACTER',to:'CONTACTE'},created_at:'2026-11-25T14:02:00Z'},{kind:'EXPORT',detail:{},created_at:'2026-11-24T08:15:00Z'}]}
    onStatus={async(id,c)=>{setData({...data,items:data.items.map(i=>i.id===id?{...i,status:c.status}:i)});setNotice('Statut enregistré.')}}
    onExport={()=>setNotice('Export téléchargé et inscrit au journal.')}/>}</div>;
}
