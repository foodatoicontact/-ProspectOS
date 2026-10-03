'use client';
import {type Locale,translate,type TKey} from '../i18n';
// Demo mission header: what the visitor is looking at, in a few seconds. Static copy only — no data is
// fetched, nothing is analysed live, and the process strip describes the real mechanism (the human verifies
// before anything is scored; sending stays human).
const STEPS:TKey[]=['demoMission.step1','demoMission.step2','demoMission.step3','demoMission.step4','demoMission.step5'];

export function DemoMission({locale,missionName,showHowTo,onHowTo,onUpgrade}:{locale:Locale;missionName:string;showHowTo:boolean;onHowTo:()=>void;onUpgrade:()=>void}){
 const tr=(k:TKey)=>translate(locale,k);
 return <section className="demo-mission card" aria-labelledby="demo-mission-title">
  <div className="demo-mission-main">
   <p className="eyebrow">{tr('demoMission.eyebrow')}</p>
   <h2 id="demo-mission-title">{missionName}</h2>
   <p className="demo-mission-objective"><span>{tr('demoMission.objectiveLabel')}</span> {tr('demoMission.objective')}</p>
   <ol className="process-strip" aria-label={tr('demoMission.processAria')}>
    {STEPS.map((k,i)=><li key={k}><span className="process-index" aria-hidden="true">{String(i+1).padStart(2,'0')}</span>{tr(k)}</li>)}
   </ol>
   <p className="demo-mission-disclaimer">{tr('demoMission.disclaimer')}</p>
  </div>
  <div className="demo-mission-actions">
   <button type="button" className="primary" onClick={onUpgrade}>{tr('demoMission.cta')}</button>
   {showHowTo&&<button type="button" className="text-button" onClick={onHowTo}>{tr('demoMission.howTo')}</button>}
  </div>
 </section>;
}
