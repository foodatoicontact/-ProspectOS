import type {Metadata} from 'next';
import {cache} from 'react';
import {PublicSeoPage} from '../../src/components/PublicSeoPage';
import {RegionCreationsBlock,creationsMetadata,hubSeoPage} from '../../src/components/CompanyCreations';
import {fetchRegionCreations} from '../../src/domain/company-creations';

// Prerendered at build time, regenerated at most once a day (ISR). During the build only, a register that does not answer
// yields the page without numbers (links to every department) so a deployment never depends on it; at run time the
// error is thrown instead, which keeps the last good page online until the register answers again.
export const revalidate=86400;

const load=cache(async()=>{
 let region:Awaited<ReturnType<typeof fetchRegionCreations>>|null=null;
 try{region=await fetchRegionCreations()}
 catch(e){if(process.env.NEXT_PHASE!=='phase-production-build')throw e}
 return {region,page:hubSeoPage(region,new Date().toISOString().slice(0,10))};
});

export async function generateMetadata():Promise<Metadata>{return creationsMetadata((await load()).page)}

export default async function Page(){
 const {region,page}=await load();
 return <PublicSeoPage page={page}><RegionCreationsBlock region={region} page={page}/></PublicSeoPage>;
}
