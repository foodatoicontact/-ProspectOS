import {llmsTxt} from '../../src/domain/geo';
// llmstxt.org: what an AI assistant should know about ProspectOS, with links (src/domain/geo.ts).
export const dynamic='force-static';
export function GET(){return new Response(llmsTxt(),{headers:{'content-type':'text/plain; charset=utf-8','cache-control':'public, max-age=3600'}})}
