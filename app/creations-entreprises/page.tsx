import type {Metadata} from 'next';
import {cache} from 'react';
import {PublicSeoPage} from '../../src/components/PublicSeoPage';
import {ZoneCreationsBlock,creationsMetadata,franceSeoPage} from '../../src/components/CompanyCreations';
import {fetchFranceCreations} from '../../src/domain/company-creations';

// France: every region and every department, with a zone picker. Prerendered at build time, regenerated at most once a
// day (ISR). During the build only, a register that does not answer yields the page without numbers (picker and links to
// every zone) so a deployment never depends on it; at run time the error is thrown instead, which keeps the last good page
// online until the register answers again.
export const revalidate=86400;

const load=cache(async()=>{
 let z:Awaited<ReturnType<typeof fetchFranceCreations>>|null=null;
 try{z=await fetchFranceCreations()}
 catch(e){if(process.env.NEXT_PHASE!=='phase-production-build')throw e}
 return {z,page:franceSeoPage(z,new Date().toISOString().slice(0,10))};
});

export async function generateMetadata():Promise<Metadata>{return creationsMetadata((await load()).page)}

export default async function Page(){
 const {z,page}=await load();
 return <PublicSeoPage page={page}><ZoneCreationsBlock z={z} page={page}/></PublicSeoPage>;
}
