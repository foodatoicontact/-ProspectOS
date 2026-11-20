// Pure helpers of the France map (CreationsMap.tsx), testable without a browser.
// Six quantile classes over the metropolitan departments: the map shows contrasts, the exact figure is in the tooltip.
export const MAP_CLASSES=6;
export function quantileBreaks(values:readonly number[],classes=MAP_CLASSES):number[]{
 const s=[...values].sort((a,b)=>a-b);const out:number[]=[];
 for(let i=1;i<classes;i++)out.push(s[Math.floor(i*s.length/classes)]!);
 return out;
}
export const classOf=(v:number,breaks:readonly number[])=>{let i=0;while(i<breaks.length&&v>=breaks[i]!)i++;return i};
