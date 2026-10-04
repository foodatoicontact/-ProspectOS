'use client';
import {useState} from 'react';
import {type Locale,translate,type TKey} from '../i18n';
import {buildTargetingProposal,applyEdits,readyForDiscovery,canAnalyzeOffer,type TargetingProposal} from '../domain/onboarding';
// Quick start: 3 short steps (offer → target → review) on top of the existing models. It never scores, never
// creates evidence and never launches a search by itself: it creates the project through the existing route,
// saves the reviewed ICP through the existing route, then opens the existing Discovery screen pre-filled.
// The optional AI step is the existing offer analysis (user's own text, 1 unit of the AI offer quota).
export type OfferAnalysis={summary:string;target:string}|null;
export type QuickStartApi={
 createProject:(name:string,offer:string)=>Promise<string>;
 analyzeOffer:(projectId:string,url:string,text:string)=>Promise<OfferAnalysis>;
 confirm:(projectId:string,p:TargetingProposal)=>Promise<void>;
 manual:(projectId:string|null,p:TargetingProposal|null)=>Promise<void>;
};
const list=(s:string)=>s.split(/[,\n]/).map(x=>x.trim()).filter(Boolean);

export function QuickStart({locale,aiAvailable,busy,onApi}:{locale:Locale;aiAvailable:boolean;busy:boolean;onApi:QuickStartApi}){
 const tr=(k:TKey)=>translate(locale,k);
 const [step,setStep]=useState<1|2|3>(1);
 const [offerText,setOfferText]=useState('');const [offerUrl,setOfferUrl]=useState('');const [useAi,setUseAi]=useState(true);
 const [targetText,setTargetText]=useState('');
 const [projectId,setProjectId]=useState<string|null>(null);
 const [analysis,setAnalysis]=useState<OfferAnalysis>(null);const [aiNote,setAiNote]=useState('');
 const [proposal,setProposal]=useState<TargetingProposal|null>(null);const [editing,setEditing]=useState(false);
 const [working,setWorking]=useState(false);const [error,setError]=useState('');
 const [edits,setEdits]=useState({projectName:'',offer:'',categories:'',locations:'',signals:'',query:''});
 const aiPossible=aiAvailable&&canAnalyzeOffer(offerText,offerUrl);
 const disabled=busy||working;
 async function run(action:()=>Promise<void>){setWorking(true);setError('');try{await action()}catch(e){setError(e instanceof Error?e.message:tr('error.generic'))}finally{setWorking(false)}}

 // Step 1 → the project exists (same route as the manual creation). The AI analysis is optional and never
 // blocks: a failure only means the user continues with their own description.
 const submitOffer=()=>run(async()=>{
  const draftName=buildTargetingProposal({offerText,offerUrl,targetText:''}).projectName.value;
  const id=projectId??await onApi.createProject(draftName,offerText.trim());
  setProjectId(id);setAiNote('');
  if(aiPossible&&useAi&&!analysis){
   try{const a=await onApi.analyzeOffer(id,offerUrl.trim(),offerText.trim());setAnalysis(a);if(!a)setAiNote(tr('quick.aiFailed'))}
   catch{setAiNote(tr('quick.aiFailed'))}
  }
  setStep(2);
 });
 const submitTarget=()=>{const p=buildTargetingProposal({offerText,offerUrl,targetText,aiSummary:analysis?.summary??null});setProposal(p);setEditing(false);
  setEdits({projectName:p.projectName.value,offer:p.offer.value,categories:p.categories.value.join(', '),locations:p.locations.value.join(', '),signals:p.signals.value.join(', '),query:p.discovery.query});setStep(3)};
 const current=proposal&&editing?applyEdits(proposal,{projectName:edits.projectName,offer:edits.offer,categories:list(edits.categories),locations:list(edits.locations),signals:list(edits.signals),query:edits.query}):proposal;

 return <section className="quickstart card" aria-labelledby="quickstart-title">
  <p className="eyebrow">{tr('quick.eyebrow')}</p>
  <ol className="quick-progress" aria-label={tr('quick.progressAria')}>{[1,2,3].map(n=><li key={n} className={n===step?'active':n<step?'done':''} aria-current={n===step?'step':undefined}><span>{n}</span>{tr(`quick.step${n}` as TKey)}</li>)}</ol>
  {step===1&&<form onSubmit={e=>{e.preventDefault();void submitOffer()}}>
   <h2 id="quickstart-title">{tr('quick.offerTitle')}</h2>
   <label>{tr('quick.offerLabel')}<textarea rows={4} required minLength={10} maxLength={4000} value={offerText} onChange={e=>setOfferText(e.target.value)} placeholder={tr('quick.offerPlaceholder')} autoFocus/></label>
   <label>{tr('quick.urlLabel')} <span className="muted">{tr('quick.optional')}</span><input type="url" inputMode="url" autoComplete="url" maxLength={500} value={offerUrl} onChange={e=>setOfferUrl(e.target.value)} placeholder="https://"/></label>
   <p className="muted quick-hint">{tr('quick.urlHonesty')}</p>
   {aiPossible&&<label className="checkbox quick-ai"><input type="checkbox" checked={useAi} onChange={e=>setUseAi(e.target.checked)}/>{tr('quick.aiOptIn')}</label>}
   <div className="quick-actions"><button className="primary" disabled={disabled||offerText.trim().length<10}>{tr('quick.continue')}</button></div>
  </form>}
  {step===2&&<form onSubmit={e=>{e.preventDefault();submitTarget()}}>
   <h2 id="quickstart-title">{tr('quick.targetTitle')}</h2>
   {aiNote&&<p className="note" role="status">{aiNote}</p>}
   {analysis?.target&&<div className="quick-suggestion"><p><b>{tr('quick.aiTargetLabel')}</b> {analysis.target}</p><button type="button" className="text-button" onClick={()=>setTargetText(analysis.target.slice(0,600))}>{tr('quick.useSuggestion')}</button></div>}
   <label>{tr('quick.targetLabel')}<textarea rows={3} required minLength={3} maxLength={600} value={targetText} onChange={e=>setTargetText(e.target.value)} placeholder={tr('quick.targetPlaceholder')} autoFocus/></label>
   <p className="muted quick-hint">{tr('quick.targetHint')}</p>
   <div className="quick-actions"><button type="button" className="text-button" onClick={()=>setStep(1)}>{tr('quick.back')}</button><button className="primary" disabled={disabled||targetText.trim().length<3}>{tr('quick.prepare')}</button></div>
  </form>}
  {step===3&&current&&<div>
   <h2 id="quickstart-title">{tr('quick.reviewTitle')}</h2>
   <p className="quick-intro">{tr('quick.reviewIntro')}</p>
   {!editing?<dl className="quick-summary">
    <div><dt>{tr('quick.labelOffer')}</dt><dd>{current.offer.value}{current.offerSummary&&<span className="quick-ai-summary"><small>{tr('quick.aiSummaryLabel')}</small> {current.offerSummary.value}</span>}</dd></div>
    <div><dt>{tr('quick.labelTarget')}</dt><dd>{current.discovery.query||<span className="quick-missing">{tr('quick.toSpecify')}</span>}</dd></div>
    <div><dt>{tr('quick.labelZone')}</dt><dd>{current.locations.value.length?current.locations.value.join(', '):<span className="quick-missing">{tr('quick.toSpecify')}</span>}</dd></div>
    <div><dt>{tr('quick.labelCriteria')}</dt><dd><ul className="quick-criteria">
     <li>✓ {tr('quick.critTarget')} {[...current.categories.value,...current.locations.value].length?<span className="muted">({[...current.categories.value,...current.locations.value].join(' · ')})</span>:null} <span className="quick-weight">{current.criteria[0].weight} pts</span></li>
     <li>✓ {tr('quick.critNeed')} {current.signals.value.length?<span className="muted">({current.signals.value.join(' · ')})</span>:<span className="muted">({tr('quick.critNeedNone')})</span>} <span className="quick-weight">{current.criteria[1].weight} pts</span></li>
     <li>✓ {tr('quick.critSignal')} <span className="quick-weight">{current.criteria[2].weight} pts</span></li>
     <li>✓ {tr('quick.critContact')} <span className="quick-weight">{current.criteria[3].weight} pts</span></li>
    </ul><p className="muted quick-hint">{tr('quick.criteriaNote')}</p></dd></div>
    {current.notes.length>0&&<div><dt>{tr('quick.labelNotes')}</dt><dd>{current.notes.join(' · ')} <span className="muted">— {tr('quick.notesExplain')}</span></dd></div>}
   </dl>:<div className="quick-edit">
    <label>{tr('quick.labelOffer')}<textarea rows={3} maxLength={4000} value={edits.offer} onChange={e=>setEdits(x=>({...x,offer:e.target.value}))}/></label>
    {proposal?.offerSummary&&<button type="button" className="text-button" onClick={()=>setEdits(x=>({...x,offer:proposal.offerSummary!.value}))}>{tr('quick.useAiSummary')}</button>}
    <label>{tr('quick.editQuery')}<input value={edits.query} maxLength={120} onChange={e=>setEdits(x=>({...x,query:e.target.value}))}/></label>
    <label>{tr('quick.editCategories')}<input value={edits.categories} onChange={e=>setEdits(x=>({...x,categories:e.target.value}))}/></label>
    <label>{tr('quick.labelZone')}<input value={edits.locations} onChange={e=>setEdits(x=>({...x,locations:e.target.value}))} placeholder={tr('icp.locationsPlaceholder')}/></label>
    <label>{tr('quick.editSignals')}<input value={edits.signals} onChange={e=>setEdits(x=>({...x,signals:e.target.value}))} placeholder={tr('icp.signalsPlaceholder')}/></label>
   </div>}
   {!readyForDiscovery(current)&&<p className="note" role="status">{tr('quick.needZone')}</p>}
   {error&&<p className="note" role="alert">{error}</p>}
   <div className="quick-actions quick-final">
    <button type="button" className="primary" disabled={disabled||!projectId||!readyForDiscovery(current)} onClick={()=>run(()=>onApi.confirm(projectId!,current))}>{tr('quick.launch')} →</button>
    <button type="button" disabled={disabled} onClick={()=>{if(editing&&current)setProposal(current);setEditing(v=>!v)}}>{editing?tr('quick.doneEditing'):tr('quick.edit')}</button>
   </div>
   <p className="quick-advanced"><button type="button" className="text-button" disabled={disabled||!projectId} onClick={()=>run(()=>onApi.manual(projectId,current))}>{tr('quick.advanced')}</button></p>
  </div>}
  {step!==3&&error&&<p className="note" role="alert">{error}</p>}
  {step===1&&<p className="quick-advanced"><button type="button" className="text-button" disabled={disabled} onClick={()=>run(()=>onApi.manual(null,null))}>{tr('quick.manual')}</button></p>}
 </section>;
}
