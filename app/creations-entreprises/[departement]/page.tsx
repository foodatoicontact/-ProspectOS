import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {cache} from 'react';
import {PublicSeoPage} from '../../../src/components/PublicSeoPage';
import {DepartmentCreationsBlock,creationsMetadata,departmentSeoPage} from '../../../src/components/CompanyCreations';
import {departmentBySlug,fetchDepartmentCreations} from '../../../src/domain/company-creations';

// Rendered on the first visit, then served from the cache and regenerated at most once a day (ISR). Nothing is fetched at
// build time: a register outage can never fail a deployment. If the register does not answer during a regeneration, the
// error keeps the last good page online; on a first visit it is a plain error, never a page of zeros.
export const revalidate=86400;
export const dynamicParams=true;
export async function generateStaticParams(){return []}

type Props={params:Promise<{departement:string}>};
// One register read per render: the metadata and the page share it.
const load=cache(async(slug:string)=>{
 const department=departmentBySlug(slug);
 if(!department)notFound();
 const data=await fetchDepartmentCreations(department);
 return {data,page:departmentSeoPage(data)};
});

export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {page}=await load((await params).departement);
 return creationsMetadata(page);
}

export default async function Page({params}:Props){
 const {data,page}=await load((await params).departement);
 return <PublicSeoPage page={page}><DepartmentCreationsBlock d={data} page={page}/></PublicSeoPage>;
}
