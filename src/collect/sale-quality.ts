// Weekly watch on the sort of the BODACC « Ventes et cessions » notices (migration 054, owner decision 25 nov. 2026). The
// sort is automatic (src/domain/bodacc-purchase.ts); what can break it is the register changing its wording. Each collection
// run stores how many notices each rule decided; once a week the last 7 days are compared with the 4 weeks before. Counts
// and rule ids only: no notice, no name, no text reaches this module or the alert.
import {SALE_KINDS,SALE_RULES,type SaleKind,type SaleRule} from '../domain/bodacc-purchase.ts';

export const RULE_KIND:Record<SaleRule,SaleKind>={origin_forced:'FORCED_SALE',text_forced:'FORCED_SALE',origin_contribution:'CONTRIBUTION',
 origin_merger:'MERGER',category_purchase:'PURCHASE',start_after_purchase:'PURCHASE',origin_purchase:'PURCHASE',category_contribution:'CONTRIBUTION',
 text_merger:'MERGER',text_contribution:'CONTRIBUTION',text_sale:'PURCHASE',text_head_office_move:'UNDETERMINED',no_rule:'UNDETERMINED'};
// Thresholds, on the period 26 Oct.–24 Nov. 2026 (4 893 notices): purchases 50 %, mergers 46 %, contributions 2.8 %,
// court-ordered sales 0.7 %, undetermined 0.35 %.
export const SHIFT_POINTS=10;          // a kind whose share moves by more than 10 points against the 4 weeks before
export const UNDETERMINED_MAX=0.03;    // more than 3 % of notices that no rule could sort
export const MIN_NOTICES=50;           // fewer notices than this in a week: the collection itself is suspect

export type RuleCounts=Partial<Record<string,number>>;
export type Week={week_start:string;runs:number;rules:RuleCounts};
export type QualityAlert=
 {code:'NO_NOTICES';notices:number}|
 {code:'UNKNOWN_RULE';rule:string}|
 {code:'UNDETERMINED_HIGH';share:number}|
 {code:'SHARE_SHIFT';kind:SaleKind;before:number;after:number};
export type QualityReport={week_start:string|null;notices:number;shares:Record<SaleKind,number>;baseline:Record<SaleKind,number>|null;alerts:QualityAlert[]};

const KNOWN=new Set<string>(SALE_RULES);
function kinds(rules:RuleCounts):{total:number;by:Record<SaleKind,number>;unknown:string[]}{
 const by=Object.fromEntries(SALE_KINDS.map(k=>[k,0])) as Record<SaleKind,number>;let total=0;const unknown:string[]=[];
 for(const [rule,n] of Object.entries(rules)){const c=Number(n)||0;if(c<=0)continue;total+=c;
  if(KNOWN.has(rule))by[RULE_KIND[rule as SaleRule]]+=c;else{unknown.push(rule);by.UNDETERMINED+=c}}
 return {total,by,unknown};
}
const shares=(k:{total:number;by:Record<SaleKind,number>})=>Object.fromEntries(SALE_KINDS.map(x=>[x,k.total?Math.round(k.by[x]/k.total*1000)/1000:0])) as Record<SaleKind,number>;

// weeks: newest first, as public.bodacc_sale_rule_weeks returns them. Pure.
export function checkSaleQuality(weeks:readonly Week[]):QualityReport{
 const [current,...previous]=weeks;
 const now=kinds(current?.rules??{});
 const alerts:QualityAlert[]=[];
 if(now.total<MIN_NOTICES)alerts.push({code:'NO_NOTICES',notices:now.total});
 for(const rule of now.unknown)alerts.push({code:'UNKNOWN_RULE',rule:rule.slice(0,40)});
 const s=shares(now);
 if(now.total>=MIN_NOTICES&&s.UNDETERMINED>UNDETERMINED_MAX)alerts.push({code:'UNDETERMINED_HIGH',share:s.UNDETERMINED});
 const before=previous.slice(0,4).reduce<RuleCounts>((acc,w)=>{for(const [r,n] of Object.entries(w.rules))acc[r]=(acc[r]??0)+(Number(n)||0);return acc},{});
 const base=kinds(before);const b=base.total>=MIN_NOTICES?shares(base):null;
 if(b&&now.total>=MIN_NOTICES)for(const k of SALE_KINDS)if(Math.abs(s[k]-b[k])*100>SHIFT_POINTS)alerts.push({code:'SHARE_SHIFT',kind:k,before:b[k],after:s[k]});
 return {week_start:current?.week_start??null,notices:now.total,shares:s,baseline:b,alerts};
}

// Rule counts of one batch of notices, for the collection run (parseBodacc). Pure.
export function countRules(rules:readonly SaleRule[]):Record<string,number>{
 const out:Record<string,number>={};for(const r of rules)out[r]=(out[r]??0)+1;return out;
}

const pct=(x:number)=>`${(x*100).toFixed(1).replace('.',',')} %`;
const LABEL:Record<SaleKind,string>={PURCHASE:'rachats',CONTRIBUTION:'apports',MERGER:'fusions et restructurations',FORCED_SALE:'ventes judiciaires',UNDETERMINED:'indéterminées'};
export function alertText(r:QualityReport):string{
 const lines=r.alerts.map(a=>a.code==='NO_NOTICES'?`Seulement ${a.notices} annonces « Ventes et cessions » collectées sur la semaine : la collecte est peut-être arrêtée.`
  :a.code==='UNKNOWN_RULE'?`Règle inconnue dans les comptes : ${a.rule}.`
  :a.code==='UNDETERMINED_HIGH'?`${pct(a.share)} des annonces n'ont pu être classées (seuil ${pct(UNDETERMINED_MAX)}) : le BODACC a peut-être changé ses libellés.`
  :`Part des ${LABEL[a.kind]} : ${pct(a.before)} sur les 4 semaines précédentes, ${pct(a.after)} cette semaine (écart > ${SHIFT_POINTS} points).`);
 return [`Contrôle hebdomadaire du tri BODACC — semaine du ${r.week_start??'?'} (${r.notices} annonces).`,'',...lines,'',
  'Répartition de la semaine : '+SALE_KINDS.map(k=>`${LABEL[k]} ${pct(r.shares[k])}`).join(', ')+'.',
  'Aucune annonce ni aucun nom dans ce message : uniquement des comptes par règle (migration 054).'].join('\n');
}
