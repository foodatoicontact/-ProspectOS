import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {cache} from 'react';
import {PublicSeoPage} from '../../../src/components/PublicSeoPage';
import {DepartmentCreationsBlock,ZoneCreationsBlock,creationsMetadata,departmentSeoPage,regionSeoPage} from '../../../src/components/CompanyCreations';
import {fetchDepartmentCreations,fetchRegionCreations,zoneBySlug} from '../../../src/domain/company-creations';

// One page per French department and per region of several departments. Rendered on the first visit, then served from
// the cache and regenerated at most once a day (ISR). Nothing is fetched at build time: a register outage can never fail
// a deployment. If the register does not answer during a regeneration, the error keeps the last good page online; on a
// first visit it is a plain error, never a page of zeros. A slug outside the closed list is a 404.
export const revalidate=86400;
export const dynamicParams=true;
export async function generateStaticParams(){return []}

type Props={params:Promise<{zone:string}>};
// One register read per render: the metadata and the page share it.
const load=cache(async(slug:string)=>{
 const zone=zoneBySlug(slug);
 if(!zone)notFound();
 if(zone.kind==='department'){const data=await fetchDepartmentCreations(zone.department);return {kind:zone.kind,data,page:departmentSeoPage(data)} as const}
 const data=await fetchRegionCreations(zone.region);
 return {kind:zone.kind,data,region:zone.region,page:regionSeoPage(data,zone.region)} as const;
});

export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {page}=await load((await params).zone);
 return creationsMetadata(page);
}

export default async function Page({params}:Props){
 const z=await load((await params).zone);
 return <PublicSeoPage page={z.page}>{z.kind==='department'?<DepartmentCreationsBlock d={z.data} page={z.page}/>:<ZoneCreationsBlock z={z.data} page={z.page} region={z.region}/>}</PublicSeoPage>;
}
