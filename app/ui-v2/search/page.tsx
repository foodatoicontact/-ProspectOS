import {SearchBench} from '../../../src/ui/v2/search/SearchBench.tsx';
import {BENCH_STATES,type BenchState} from '../../../src/ui/v2/search/fixture.ts';

// Recherche 2.0 bench (Preview only: the /ui-v2 layout answers 404 unless UI_V2_ENABLED). ?state=results|empty|loading|
// error|quota|start|demo — frozen states, or the real panel in demo mode. No network call.
export default async function SearchBenchPage({searchParams}:{searchParams:Promise<{state?:string}>}){
 const {state}=await searchParams;
 const initial=state==='demo'||BENCH_STATES.includes(state as BenchState)?state as BenchState|'demo':'results';
 return <SearchBench initial={initial}/>;
}
