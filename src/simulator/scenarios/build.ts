// Builders for the fictional fixtures: dates are counted back from the scenario's fixed reference date, so a scenario is
// identical on every run. Signal confidence comes from the product's own rule (signalConfidence), never typed by hand.
import type {Evidence} from '../../domain/core.ts';
import type {IntentSignal} from '../../domain/intent.ts';
import type {PublicContentItem} from '../../outreach/angle.ts';
import {signalConfidence,type SignalType,type SignalSourceType} from '../../signals/types.ts';

const DAY=86_400_000;
export const daysBefore=(ref:string,days:number)=>new Date(Date.parse(ref)-days*DAY).toISOString();
export const dayBefore=(ref:string,days:number)=>daysBefore(ref,days).slice(0,10);

// A proof for an ICP criterion. VERIFIED carries who verified it (here: the simulation itself, never a real person).
export function ev(ref:string,domain:string,id:string,criterion:string,excerpt:string,status:'VERIFIED'|'NOT_VERIFIED'|'INFERRED_UNCONFIRMED',days:number,path='/'):Evidence{
 return {id,criterion,value:true,status,source_url:`https://${domain}${path}`,excerpt,observed_at:daysBefore(ref,days),verified_by:status==='VERIFIED'?'simulation':null};
}
// A dated, sourced signal. The event date is the fact's own date; it was read one day later.
export function sig(ref:string,domain:string,id:string,signal_type:SignalType,title:string,excerpt:string,status:'VERIFIED'|'PENDING_REVIEW',days:number,source_type:SignalSourceType,path='/actualites'):IntentSignal{
 const event_date=dayBefore(ref,days);
 return {id,signal_type,status,title,excerpt,source_url:`https://${domain}${path}`,source_domain:domain,confidence:signalConfidence(source_type,event_date,null),event_date,published_at:null,observed_at:daysBefore(ref,Math.max(0,days-1)),matched_terms:[]};
}
export function content(ref:string,domain:string,id:string,text:string,status:'VERIFIED'|'PENDING_REVIEW',days:number,path='/blog'):PublicContentItem{
 return {id,status,pinned:false,source_type:'official_website',source_url:`https://${domain}${path}`,source_domain:domain,author:null,content:text,published_at:daysBefore(ref,days),observed_at:daysBefore(ref,Math.max(0,days-1))};
}
