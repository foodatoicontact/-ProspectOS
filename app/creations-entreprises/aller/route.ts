import {NextResponse,type NextRequest} from 'next/server';
import {CREATIONS_HUB,zoneBySlug} from '../../../src/domain/company-creations';

// The zone picker's GET form (no JavaScript needed): only a slug of the closed list is followed; anything else goes back
// to the France page. Same-origin relative redirect, never an address taken from the request.
export function GET(request:NextRequest){
 const slug=request.nextUrl.searchParams.get('zone')??'';
 const zone=zoneBySlug(slug);
 const path=zone?`/${CREATIONS_HUB}/${zone.kind==='department'?zone.department.slug:zone.region.slug}`:`/${CREATIONS_HUB}`;
 return NextResponse.redirect(new URL(path,request.nextUrl.origin),303);
}
