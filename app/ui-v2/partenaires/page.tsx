import {PartnerBench} from '../../../src/ui/v2/partners/PartnerBench.tsx';

// Programme partenaires bench (Preview only: the /ui-v2 layout answers 404 unless UI_V2_BENCH_ENABLED). ?view=space|admin
export default async function PartnerBenchPage({searchParams}:{searchParams:Promise<{view?:string}>}){
 const {view}=await searchParams;
 return <PartnerBench view={view==='admin'?'admin':'space'}/>;
}
