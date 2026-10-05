import {llmsFullTxt} from '../../src/domain/geo';
// llms.txt plus every public page in full text, for assistants that read one document (src/domain/geo.ts).
export const dynamic='force-static';
export function GET(){return new Response(llmsFullTxt(),{headers:{'content-type':'text/plain; charset=utf-8','cache-control':'public, max-age=3600'}})}
