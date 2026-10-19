'use client';
// /ui-v2/activity (bench: UI_V2_ENABLED and UI_V2_BENCH_ENABLED, never Production): Activité 2.0 inside the real v2 shell,
// to review it in every theme and width without an account. ?state=actions|empty|error|overview. Frozen data only
// (fictitious companies, .example sources); every action is listed on the page instead of being performed.
import {useState} from 'react';
import {AppShell} from '../shell/AppShell.tsx';
import {ActivityV2,ActionsNative,ActivityOverview} from './ActivityV2.tsx';
import type {ActionRow,ActionsView} from '../../../components/ActionsPanel.tsx';

export type ActivityBenchState='actions'|'empty'|'error'|'overview';
export const ACTIVITY_BENCH_STATES:readonly ActivityBenchState[]=['actions','empty','error','overview'];
const PROJECTS=[{id:'bench',name:'Banc Activité 2.0'}];
const ref=(id:string,url:string)=>[{id,source_url:url}] as never;
const row=(id:string,o:Partial<ActionRow>):ActionRow=>({id,prospect_id:`p-${id}`,recommended_action:'CONTACT',rule:'bench',state:'OPEN',opportunity_score:72,fit_score:80,fit_basis:'verified',
 intent_score:64,timing_score:70,freshness_score:88,evidence_quality_score:75,primary_kind:'signal',primary_signal_type:null,primary_evidence_status:'VERIFIED',signal_age_days:3,primary_detail:null,
 target:{role:'Gérant',role_alternatives:[],person:null},
 explanation:{why_this_account:[{kind:'fact',text:'Restaurant indépendant à Toulouse, dans votre cible.',refs:ref(`${id}-a`,'https://kantina.example/')}],
  why_now:[{kind:'fact',text:'Ouverture d’un second établissement annoncée cette semaine.',refs:ref(`${id}-n`,'https://presse.example/kantina')}],
  why_this_action:[{kind:'rule',text:'Un fait récent et vérifié sur un compte dans la cible : un premier message est pertinent.',refs:[]}],inferred:[],unknown:[]},
 prepared_content:{kind:'contact_draft',text:'Bonjour, j’ai vu l’annonce de votre second établissement…'},expires_at:new Date(Date.now()+7*864e5).toISOString(),
 prospects:{name:'Kantina',city:'Toulouse',website:'https://kantina.example'},...o} as ActionRow);
const TODAY:ActionRow[]=[
 row('a',{}),
 row('b',{recommended_action:'ENGAGE',primary_kind:'conversation',signal_age_days:0,opportunity_score:58,primary_evidence_status:'INFERRED',
  prospects:{name:'Le Comptoir des Halles de Montpellier et de sa région',city:'Montpellier',website:null},
  explanation:{why_this_account:[],why_now:[{kind:'inference',text:'Le gérant discute publiquement de la commande en ligne.',refs:[]}],why_this_action:[],inferred:[{kind:'inference',text:'Rôle déduit du profil public.',refs:[]}],unknown:[{kind:'unknown',text:'Nombre de couverts inconnu.',refs:[]}]},
  prepared_content:{kind:'engage',suggested_comment:'Merci pour ce retour d’expérience !',suggested_dm_after_engagement:null}}),
];
const QUEUE:ActionRow[]=[...TODAY,row('c',{recommended_action:'WATCH',signal_age_days:21,opportunity_score:41,prospects:{name:'Bistro Nîmois',city:'Nîmes',website:null}}),
 row('d',{recommended_action:'WAIT',signal_age_days:null,primary_kind:null,opportunity_score:22,prospects:{name:'La Pausa',city:'Nîmes',website:null}})];

export function ActivityBench({initial}:{initial:ActivityBenchState}){
 const [state,setState]=useState<ActivityBenchState>(initial);
 const [filter,setFilter]=useState({signal_type:'',min_score:'',min_freshness:''});
 const [log,setLog]=useState<string[]>([]);const act=(s:string)=>setLog(l=>[...l,s]);
 const m:ActionsView={locale:'fr',today:state==='actions'?TODAY:[],queue:state==='actions'?QUEUE:[],busy:false,error:state==='error'?'Les recommandations sont indisponibles pour le moment.':'',note:'',
  filter,setFilter,compute:()=>act('compute'),decide:(id,b)=>act(`decide:${id}:${String(b.decision)}`),onOpenProspect:id=>act(`open:${id}`)};
 return <AppShell locale="fr" current="activity" onNavigate={()=>{}} title="Activité"
  project={{projects:PROJECTS,currentId:'bench',busy:false,onSelect:()=>{},onNew:()=>{}}}
  account={{mode:'demo',email:'',internal:false,busy:false,onLocale:()=>{},onAccount:()=>{},onTeam:()=>{},onOfferTarget:()=>{},onSources:()=>{},onPrivacy:()=>{},
   onBetaAnalytics:()=>{},onSignOut:()=>{},onResetDemo:()=>{}}}
  screen={<>
   <nav className="pos-visually-hidden" aria-label="Banc : état affiché" data-testid="bench-states">
    {ACTIVITY_BENCH_STATES.map(s=><button key={s} type="button" aria-pressed={state===s} data-state={s} onClick={()=>setState(s)}>{s}</button>)}
   </nav>
   {state==='overview'
    ?<ActivityV2 locale="fr" intro="overview" top={null} notice="" onDismissNotice={()=>{}} paywall={null}>
      <ActivityOverview locale="fr" total={9} note="Les statuts sont vos décisions. Un score ne qualifie jamais automatiquement un prospect." onStatus={s=>act(`status:${s}`)}
       metrics={[{label:'Prospects dans le projet',value:'09',sub:'Votre vivier documenté'},{label:'À contacter',value:'02',sub:'Validés par vos soins'},
        {label:'Score moyen',value:'41/100',sub:'Priorité, pas probabilité de vente'},{label:'Conversations lancées',value:'03',sub:'Actions déclarées manuellement'}]}
       pipeline={[['À analyser',3],['Qualifié',1],['À contacter',2],['Contacté',2],['Réponse',1],['Intéressé',0],['Gagné',0],['Perdu',0],['Ignoré',0]].map(([s,n])=>({status:s as string,label:s as string,count:n as number}))}/>
     </ActivityV2>
    :<ActivityV2 locale="fr" intro="actions" top={null} notice="" onDismissNotice={()=>{}} paywall={null}><ActionsNative m={m}/></ActivityV2>}
   <p className="pos-visually-hidden" data-testid="bench-log">{log.join(' ')}</p>
  </>}>{null}</AppShell>;
}
