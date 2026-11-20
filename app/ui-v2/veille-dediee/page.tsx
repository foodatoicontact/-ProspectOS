import {DedicatedBench} from '../../../src/ui/v2/dedicated/DedicatedBench.tsx';

// Veille dédiée bench (Preview only: the /ui-v2 layout answers 404 unless UI_V2_BENCH_ENABLED). ?view=client|admin|proposal|bell
export default async function DedicatedBenchPage({searchParams}:{searchParams:Promise<{view?:string}>}){
 const {view}=await searchParams;
 return <DedicatedBench view={view==='admin'?'admin':view==='proposal'?'proposal':view==='bell'?'bell':'client'}/>;
}
