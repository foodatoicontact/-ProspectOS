import {TodayBench} from '../../../src/ui/v2/today/TodayBench.tsx';

// Today 2.0 bench (Preview only: the /ui-v2 layout answers 404 unless UI_V2_ENABLED). ?set=canary|all|empty
export default async function TodayBenchPage({searchParams}:{searchParams:Promise<{set?:string}>}){
 const {set}=await searchParams;
 return <TodayBench initialSet={set==='all'||set==='empty'?set:'canary'}/>;
}
