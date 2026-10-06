// The register's headcount filter as typed in the search form: both bounds, whole numbers, min ≤ max — or no
// filter at all. A half-filled or inconsistent pair is never "fixed" into a filter the user did not ask for.
export type Headcount={min:number;max:number};
export function headcountFromInputs(min:string,max:string):Headcount|null{
 if(!/^\d+$/.test(min.trim())||!/^\d+$/.test(max.trim()))return null;
 const lo=Number(min),hi=Number(max);
 return lo>=0&&hi>=1&&hi<=1000000&&lo<=hi?{min:lo,max:hi}:null;
}
export const sameHeadcount=(a:Headcount|null|undefined,b:Headcount|null|undefined)=>(a?.min??null)===(b?.min??null)&&(a?.max??null)===(b?.max??null);
