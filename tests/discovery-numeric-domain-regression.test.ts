import test from 'node:test';
import assert from 'node:assert/strict';
import {DiscoveryService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {assessCandidateQuality} from '../src/discovery/candidate-quality.ts';
import {CandidateSchema,ObservationSchema,type Candidate} from '../src/discovery/types.ts';

// Production regression (smoke after 862bed3: stage=normalize, NORMALIZATION_FAILED, TypeError): a dotted
// number in a Brave snippet ("Publié le 23.09.2026") was taken for a cited company domain; tldts accepts
// the unknown "2026" suffix, `https://09.2026` is not a valid URL host, and the publicUrl refinement threw
// a raw TypeError that failed the whole run. "1.500" did not throw — it silently became the website
// `https://1.500`. No network: the real BraveProvider and a fake fetch only.
const QUERY='Entreprises en France qui recherchent des freelances Paid Media pour des missions longues ou récurrentes';
const provider=new BraveProvider('test-key');
function normalize(description:string,url='https://www.example-jobs.fr/paid-media',title='Missions freelance Paid Media'):Candidate{
 const raw:Record<string,unknown>={title,url,description};
 raw.__quality=assessCandidateQuality(raw as {title:string;url:string;description?:string},'France');raw.__context={query:QUERY,categories:[]};
 return provider.normalizeResult(raw);
}
// Any http(s) URL whose host is made only of digits and dots — an IP-shaped "website" made up from a number.
const NUMERIC_HOST=/https?:\/\/[\d.]+(?=[/"?#]|$)/;

for(const token of ['23.09.2026','0.08','v2.0','450.000','1.500','12.000']){
 test(`dotted number "${token}" is never a company domain and never becomes a website`, () => {
  const c=normalize(`Mission freelance Paid Media — référence ${token} — missions longues ou récurrentes.`);
  assert.equal(c.website,null);assert.equal(c.canonical_url,null);
  const meta=c.raw_metadata as Record<string,unknown>;
  assert.equal(meta.company_domain,null);assert.notEqual(meta.company_domain_method,'domain_in_text');
  assert.doesNotMatch(JSON.stringify(c),NUMERIC_HOST,'no https://1.500-style URL anywhere in the candidate');
 });
}

for(const [domain,website] of [['acme.fr','https://acme.fr'],['grandfrais.com','https://grandfrais.com'],['freelance.dev','https://freelance.dev'],['acme.co.uk','https://acme.co.uk']]){
 test(`a real cited domain is still recognized: ${domain}`, () => {
  const c=normalize(`Mission freelance Paid Media longue chez notre client, détails sur ${domain}.`);
  assert.equal(c.website,website);assert.equal(c.canonical_url,website);
  const meta=c.raw_metadata as Record<string,unknown>;
  assert.equal(meta.company_domain,domain);assert.equal(meta.company_domain_method,'domain_in_text');
 });
}

test('a real domain next to dotted numbers is still the only one cited', () => {
 const c=normalize('Publié le 23.09.2026 : 1.500 missions Paid Media, taux 0.08, voir acme.fr pour les missions longues.');
 assert.equal(c.website,'https://acme.fr');
 assert.doesNotMatch(JSON.stringify(c),NUMERIC_HOST);
});

test('publicUrl fails validation instead of throwing on an unparseable URL', () => {
 const base={name:'Acme',canonical_url:null,website:null,city:null,address:null,phone:null,discovered_source:'brave',source_url:'https://acme.fr/',source_title:'t',discovery_timestamp:new Date().toISOString(),confidence:.5,raw_metadata:{},deduplication_key:'k'};
 for(const [field,value] of [['website','https://09.2026'],['website','https://0.08'],['canonical_url','https://v2.0'],['source_url','::::'],['website','not a url']] as const){
  let result:ReturnType<typeof CandidateSchema.safeParse>|undefined;
  assert.doesNotThrow(()=>{result=CandidateSchema.safeParse({...base,[field]:value})},`${field}=${value} must not throw`);
  assert.equal(result!.success,false,`${field}=${value} must be rejected`);
  assert.throws(()=>CandidateSchema.parse({...base,[field]:value}),(e:unknown)=>Array.isArray((e as {issues?:unknown}).issues),'parse reports a validation error, never a TypeError');
 }
 assert.equal(CandidateSchema.safeParse({...base,website:'https://acme.fr'}).success,true);
 const obs={criterion:null,observation_type:'x',claim:'c',value:null,status:'UNKNOWN',source_url:'https://09.2026',source_title:'t',source_excerpt:'',source_type:'search_result',confidence:.5,collected_at:new Date().toISOString(),expires_at:new Date().toISOString(),content_hash:'h'};
 assert.doesNotThrow(()=>ObservationSchema.safeParse(obs));assert.equal(ObservationSchema.safeParse(obs).success,false);
});

// Per-result isolation in find_prospects.
type Finish={count:number;metrics:Record<string,unknown>;error?:string};
class Repo implements DiscoveryRepository {
 finished:Finish[]=[];saved:unknown[]=[];
 async start(){return {id:'run-1',provider:'brave',status:'running',result_count:0,error_message:null}}
 async existing(){return []}
 async saveResults(_run:unknown,rows:{candidate:Candidate}[]){this.saved=rows;return rows.map((r,i)=>({id:String(i),normalized_payload:r.candidate,dedupe_status:'unique' as const,duplicate_of:null,status:'pending' as const,prospect_id:null}))}
 async finish(_id:string,count:number,metrics:Record<string,unknown>,error?:string){this.finished.push({count,metrics,error})}
 async prospect():Promise<never>{throw Error('unused')}
 async projectCriteria(){return []}
 async consumeAnalysis(){}
 async saveObservations(){return []}
}
const input={project_id:'p',query:QUERY,location:'France',categories:[],max_results:10};
function run(results:unknown[],tweak?:(p:BraveProvider)=>void){
 let requests=0;const brave=new BraveProvider('BRAVE-KEY-SECRET',(async()=>{requests++;return new Response(JSON.stringify({web:{results}}),{status:200})}) as typeof fetch);tweak?.(brave);
 const repo=new Repo();const logs:Record<string,unknown>[]=[];
 return {repo,logs,requests:()=>requests,done:new DiscoveryService(repo,brave,e=>logs.push(e)).find_prospects(input)};
}
const good=(n:number)=>({title:`Agence ${n} recrute un freelance Paid Media`,url:`https://agence-${n}.fr/carrieres`,description:'Missions freelance Paid Media longues et récurrentes.'});
const sensitive={title:'   ',url:'https://acme-secrete.fr/jobs?token=tok_secret',description:'contact@acme-secrete.fr'};

test('the production shape (a date in a snippet) now completes the run instead of DISCOVERY_FAILED', async () => {
 const r=run([{...good(1),description:'Publié le 23.09.2026 — missions longues ou récurrentes Paid Media.'},good(2)]);
 const found=await r.done;
 assert.equal(found.status,'completed');assert.equal(found.results.length,2);
 assert.deepEqual(r.repo.finished.map(f=>f.error),[undefined]);assert.equal(r.repo.finished[0]!.metrics.normalization_rejected,0);
 assert.doesNotMatch(JSON.stringify(found.results),NUMERIC_HOST);
});

test('one result failing normalization is dropped alone and counted; the others are kept', async () => {
 const r=run([good(1),sensitive,good(2)]);
 const found=await r.done;
 assert.equal(found.status,'completed');assert.equal(found.results.length,2);
 assert.equal(r.repo.finished.length,1);assert.equal(r.repo.finished[0]!.error,undefined);assert.equal(r.repo.finished[0]!.count,2);
 assert.equal(r.repo.finished[0]!.metrics.normalization_rejected,1);
 assert.equal(r.requests(),1,'still exactly one Brave request — no retry');
 const rejected=r.logs.filter(l=>l.event==='normalization_rejected');
 assert.equal(rejected.length,1);assert.equal(rejected[0]!.cause,'NORMALIZATION_INVALID');assert.equal(rejected[0]!.fields,'name:too_small');
 assert.ok(!r.logs.some(l=>l.error==='DISCOVERY_FAILED'));
 const text=JSON.stringify(r.logs);for(const s of ['acme-secrete','tok_secret','contact@','BRAVE-KEY-SECRET'])assert.ok(!text.includes(s),`log must not contain ${s}`);
});

test('a thrown TypeError in normalization is isolated the same way', async () => {
 const r=run([good(1),good(2),good(3)],p=>{const real=p.normalizeResult.bind(p);let i=0;p.normalizeResult=raw=>{if(i++===1)throw new TypeError('Invalid URL https://09.2026');return real(raw)}});
 const found=await r.done;
 assert.equal(found.results.length,2);assert.equal(r.repo.finished[0]!.metrics.normalization_rejected,1);
 const rejected=r.logs.find(l=>l.event==='normalization_rejected')!;
 assert.equal(rejected.cause,'NORMALIZATION_FAILED');assert.equal(rejected.error_name,'TypeError');
 assert.doesNotMatch(JSON.stringify(r.logs),/09\.2026|https?:/);
});

test('all results rejected: the run completes with 0 results, not DISCOVERY_FAILED', async () => {
 const r=run([sensitive,{...sensitive,url:'https://acme-secrete.fr/jobs/2?token=tok_secret'}]);
 const found=await r.done;
 assert.equal(found.status,'completed');assert.equal(found.results.length,0);
 assert.deepEqual(r.repo.finished.map(f=>[f.count,f.error,f.metrics.normalization_rejected]),[[0,undefined,2]]);
 assert.deepEqual(r.repo.saved,[]);
});
