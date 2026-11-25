'use client';
// Programme partenaires bench (/ui-v2/partenaires, Preview only — the /ui-v2 layout answers 404 without UI_V2_BENCH_ENABLED):
// the partner space and the administrator's dashboard on FICTITIOUS data, actions applied locally. No real partner, client
// or company in this file.
import {useState} from 'react';
import {PartnerSpaceView} from './PartnerViews.tsx';
import {PartnerAdminView} from './PartnerAdminView.tsx';
import type {AdminData,SpaceData} from './model.ts';
import '../dedicated/dedicated.css';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const BENCH_SPACE:SpaceData={
 partner:{name:'Alice Exemple',company:'Agence Exemple',code:'AGENCEEX',rate_percent:30,status:'ACTIVE'},link:'https://prospectos.fr/?ref=AGENCEEX',
 signups:7,paying_clients:3,month:'2026-11-01',month_commissions_cents:8910,balance_cents:11880,threshold_cents:5000,
 lines:[
  {client:'C-4F2A91',kind:'COMMISSION',amount_cents:2970,base_ht_cents:9900,occurred_at:'2026-11-20T09:12:00Z'},
  {client:'C-B07E3C',kind:'COMMISSION',amount_cents:2970,base_ht_cents:9900,occurred_at:'2026-11-14T16:40:00Z'},
  {client:'C-91D5E0',kind:'COMMISSION',amount_cents:2970,base_ht_cents:9900,occurred_at:'2026-11-03T08:05:00Z'},
  {client:'C-B07E3C',kind:'REFUND',amount_cents:-1470,base_ht_cents:null,occurred_at:'2026-10-28T10:00:00Z'},
  {client:'C-4F2A91',kind:'COMMISSION',amount_cents:2970,base_ht_cents:9900,occurred_at:'2026-10-20T09:12:00Z'},
  {client:'C-B07E3C',kind:'COMMISSION',amount_cents:1470,base_ht_cents:4900,occurred_at:'2026-10-14T16:40:00Z'}],
 statements:[
  {id:id(0x51),month:'2026-10-01',referred_count:6,paying_clients:2,payments_count:2,month_commissions_cents:2970,balance_cents:2970,payable:false,paid:null},
  {id:id(0x52),month:'2026-09-01',referred_count:4,paying_clients:0,payments_count:0,month_commissions_cents:0,balance_cents:0,payable:false,paid:null}],
};
export const BENCH_ADMIN:AdminData={
 partners:[
  {id:id(0xa1),name:'Alice Exemple',company:'Agence Exemple',siret:'99900000100019',email:'alice@agence-exemple.test',code:'AGENCEEX',rate_percent:30,status:'ACTIVE',has_account:true,created_at:'2026-09-02T10:00:00Z',
   signups:7,paying_clients:3,earned_cents:13880,paid_cents:0,balance_cents:13880},
  {id:id(0xb1),name:'Bruno Fictif',company:'Conseil Fictif',siret:'99900000200017',email:'bruno@conseil-fictif.test',code:'CONSEILF',rate_percent:30,status:'ACTIVE',has_account:false,created_at:'2026-10-11T10:00:00Z',
   signups:3,paying_clients:2,earned_cents:8910,paid_cents:2970,balance_cents:5940},
  {id:id(0xc1),name:'Chloé Test',company:'Cabinet Test',siret:'99900000300015',email:'chloe@cabinet-test.test',code:'CABINETT',rate_percent:25,status:'SUSPENDED',has_account:false,created_at:'2026-10-20T10:00:00Z',
   signups:1,paying_clients:0,earned_cents:0,paid_cents:0,balance_cents:0}],
 to_pay:[{id:id(0x61),partner_id:id(0xb1),partner:'Conseil Fictif',code:'CONSEILF',month:'2026-10-01',balance_cents:5940,month_commissions_cents:2970}],
 statements:[],
 applications:[{id:id(0x71),name:'Denis Démo',company:'Démo Compta',siret:'99900000100019',email:'denis@demo-compta.test',
  pitch:'Cabinet d’expertise comptable : je recommanderai ProspectOS aux artisans et commerçants que nous accompagnons à la création.',created_at:'2026-11-22T14:00:00Z',is_partner:false}],
};
export function PartnerBench({view}:{view:'space'|'admin'}){
 const [admin,setAdmin]=useState(BENCH_ADMIN);
 return <div className="pos-ui" style={{minHeight:'100vh',background:'var(--pos-bg)'}}>
  {view==='space'?<PartnerSpaceView data={BENCH_SPACE} onCopy={()=>{}}/>
  :<PartnerAdminView data={admin} actions={{
   markPaid:async sid=>setAdmin(a=>({...a,to_pay:a.to_pay.filter(t=>t.id!==sid)})),
   setStatus:async(pid,status)=>setAdmin(a=>({...a,partners:a.partners.map(p=>p.id===pid?{...p,status}:p)})),
   create:async()=>{},
  }}/>}
 </div>;
}
