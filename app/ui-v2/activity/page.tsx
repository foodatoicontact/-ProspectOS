import {ActivityBench,type ActivityBenchState} from '../../../src/ui/v2/activity/ActivityBench.tsx';

// Activité 2.0 bench (the /ui-v2 layout answers 404 unless UI_V2_ENABLED and UI_V2_BENCH_ENABLED — never in Production).
// ?state=actions|empty|error|overview. Frozen data, no network call. (The list lives here: a value exported by a client
// module is only a reference on the server.)
const STATES:readonly ActivityBenchState[]=['actions','empty','error','overview'];
export default async function ActivityBenchPage({searchParams}:{searchParams:Promise<{state?:string}>}){
 const {state}=await searchParams;
 return <ActivityBench initial={STATES.includes(state as ActivityBenchState)?state as ActivityBenchState:'actions'}/>;
}
