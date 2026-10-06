import type {SignalProvider,SignalSearchInput,RawSignal} from '../provider.ts';
// Test-only provider: deterministic TEST signals for any company, without network. Every item says it is a test
// (title prefix, test_fixture source, .fixture.example URL), so it can never pass for a real public fact.
const slug=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'societe';
export class FixtureSignalProvider implements SignalProvider{
 id='test_fixture' as const;mode='test' as const;
 supports(){return true}
 async searchSignals({target,types,now}:SignalSearchInput):Promise<RawSignal[]>{
  const day=(d:number)=>new Date(now.getTime()-d*86400000).toISOString();
  const base=`https://signals.fixture.example/${slug(target.name)}`;
  const all:RawSignal[]=[
   {signal_type:'hiring_role',title:`TEST — ${target.name} recrute un responsable sécurité`,excerpt:`TEST — ${target.name} publie une offre de responsable de la sécurité des systèmes d’information.`,
    source_url:`${base}/emploi/rssi`,source_type:'test_fixture',published_at:day(3),event_date:null,metadata:{fixture:true}},
   {signal_type:'funding',title:`TEST — ${target.name} annonce une levée de fonds`,excerpt:`TEST — ${target.name} annonce une levée de fonds pour accélérer son développement.`,
    source_url:`${base}/actualites/levee`,source_type:'test_fixture',published_at:day(20),event_date:null,metadata:{fixture:true}},
   {signal_type:'leadership_change',title:`TEST — ${target.name} nomme un nouveau directeur technique`,excerpt:`TEST — ${target.name} nomme un nouveau directeur technique.`,
    source_url:`${base}/actualites/nomination`,source_type:'test_fixture',published_at:day(12),event_date:null,metadata:{fixture:true}},
  ];
  return all.filter(s=>types.includes(s.signal_type));
 }
}
