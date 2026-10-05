// ProspectOS Pro team, application side (database: tests/team-pro-db.mjs, real parallel sessions:
// tests/team-pool-concurrency-realpg.sh): invitation tokens drawn by the server and stored as a hash only, the
// confirmed e-mail checked by the database, invitations accepted before any free-trial claim, a teammate's
// identical search reused through the normal pipeline without any external request, and the team shown in the
// account.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {newInviteToken,inviteTokenHash,isInviteToken,teamError,TEAM_ERRORS} from '../src/server/team.ts';
import {ReusedResultsProvider} from '../src/discovery/providers/reused.ts';
import {DiscoveryService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {summarizeRuns} from '../src/discovery/run-history.ts';
import type {Candidate} from '../src/discovery/types.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';
import {localizeApiErrorMessage} from '../src/i18n/errors.ts';

const read=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');

test('token: 256 random bits, URL-safe; only its SHA-256 ever reaches the database',()=>{
 const a=newInviteToken(),b=newInviteToken();
 assert.match(a,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(a,b);assert.ok(isInviteToken(a));
 assert.equal(inviteTokenHash(a),createHash('sha256').update(a).digest('hex'));
 for(const bad of ['', 'short', 'x'.repeat(44), 'a'.repeat(42)+'!', null, 42])assert.equal(isInviteToken(bad as unknown),false);
});

test('errors: every database refusal becomes a stable code and a clear FR/EN message, never the raw text',()=>{
 for(const [db,[code]] of Object.entries(TEAM_ERRORS)){
  const mapped=teamError(Error(`ERROR: ${db}`))!;assert.equal(mapped.code,code);assert.doesNotMatch(mapped.error,/_/);
  assert.ok(localizeApiErrorMessage(mapped.error,code,'en')!==mapped.error||code==='TEAM_INVITATION_INVALID','EN translation');
 }
 assert.equal(teamError(Error('something else')),null);
 assert.equal(teamError(Error('invitation_email_mismatch'))!.code,'TEAM_INVITATION_EMAIL_MISMATCH');
});

test('routes: invite draws the token server-side and sends only its hash; accept checks the format first',async()=>{
 const route=await read('../app/api/v1/[...path]/route.ts');
 const block=route.slice(route.indexOf("if(id==='team'"),route.indexOf("if(id==='delete'"));
 assert.match(block,/const token=newInviteToken\(\);const \{data,error:rpcError\}=await db\.rpc\('create_team_invitation',\{p_email:String\(body\.email\?\?''\)\.slice\(0,254\),p_token_hash:inviteTokenHash\(token\)\}\)/);
 assert.match(block,/link:inviteLink\(request,token\)/);
 assert.match(block,/if\(!isInviteToken\(body\.token\)\)return json\(\{error:TEAM_ERRORS\.invitation_invalid\[1\],code:TEAM_ERRORS\.invitation_invalid\[0\]\},400\)/);
 assert.match(block,/await db\.rpc\('accept_team_invitation',\{p_token_hash:inviteTokenHash\(body\.token\)\}\)/);
 for(const rpc of ['list_team','list_team_invitations','revoke_team_invitation','remove_team_member','leave_team'])assert.match(block,new RegExp(`db\\.rpc\\('${rpc}'`));
 assert.doesNotMatch(block,/createAdminClient|SERVICE_ROLE/,'team actions run as the user, under the database checks');
});

test('account: a team membership is the active workspace; a team member never claims a free trial',async()=>{
 const route=await read('../app/api/v1/[...path]/route.ts');
 assert.match(route,/const membership=memberships\.find\(\(m:any\)=>m\.role==='member'\)\?\?memberships\[0\]\?\?null;/);
 const page=await read('../app/page.tsx');
 assert.match(page,/if\(!entitlement&&acc\.role!=='member'\)\{try\{const activated=await api\('account\/activate-trial'/);
 // the invitation is accepted BEFORE the account is read, so a new teammate never takes a free-trial seat
 assert.match(page,/const invite=readPendingInvite\(\);if\(invite\)await acceptPendingInvite\(invite,t\);\s*const acc=await api\('account','GET',undefined,t\)/);
});

test('invite link: kept across sign-up and e-mail confirmation in this tab only, removed from the address bar',async()=>{
 const page=await read('../app/page.tsx');
 assert.match(page,/const invite=new URLSearchParams\(window\.location\.search\)\.get\('invite'\);if\(invite&&\/\^\[A-Za-z0-9_-\]\{43\}\$\/\.test\(invite\)\)\{try\{sessionStorage\.setItem\(INVITE_KEY,invite\)\}catch\{\}/);
 assert.match(page,/u\.searchParams\.delete\('invite'\)/);
 assert.ok(fr['team.invitePending']&&en['team.invitePending']);
});

// ——— reuse ———
const cand=(name:string):Candidate=>({name,canonical_url:null,website:null,city:'LYON',address:null,phone:null,discovered_source:'registry',source_url:`https://annuaire-entreprises.data.gouv.fr/entreprise/${name}`,source_title:name,discovery_timestamp:'2026-10-04T10:00:00.000Z',confidence:1,
 raw_metadata:{source_class:'COMPANY_CANDIDATE',source_type:'public_registry',entity_type:'COMPANY',siren:name,novelty:{status:'SEEN'},review_priority:{level:'LOW',reasons:[]}},deduplication_key:`siren:${name}`} as unknown as Candidate);
class Repo implements DiscoveryRepository {
 saved:Candidate[]=[];metrics:Record<string,unknown>={};
 async start(_i:unknown,provider:string){return {id:'run-2',provider,status:'running',result_count:0,error_message:null}}
 async existing(){return []}
 async saveResults(_r:unknown,rows:{candidate:Candidate}[]){this.saved=rows.map(r=>r.candidate);return rows.map((r,i)=>({id:String(i),normalized_payload:r.candidate,dedupe_status:'unique' as const,duplicate_of:null,status:'pending' as const,prospect_id:null}))}
 async finish(_id:string,_n:number,m:Record<string,unknown>){this.metrics=m}
 async prospect():Promise<never>{throw Error('unused')}
 async projectCriteria(){return []}
 async consumeAnalysis(){}
 async saveObservations(){return []}
}
test('reuse: the stored results go through the normal pipeline — no request, fresh labels, who and when recorded',async()=>{
 const provider=new ReusedResultsProvider('registry',[cand('111111111'),cand('222222222'),{bad:true}],{run_id:'run-1',by_email:'owner@t',started_at:'2026-10-04T10:00:00Z'});
 const repo=new Repo();
 const out=await new DiscoveryService(repo,provider).find_prospects({project_id:'p2',query:'industriel',location:'Auvergne-Rhône-Alpes',categories:['industriel'],max_results:20,optional_filters:{provider:'registry'}});
 assert.equal(out.provider,'registry');assert.equal(repo.saved.length,2,'an unusable stored row is dropped like any provider row');
 assert.equal(repo.metrics.search_requests,0);assert.equal(repo.metrics.reused_from_run_id,'run-1');assert.equal(repo.metrics.reused_from_email,'owner@t');assert.equal(repo.metrics.reused_from_started_at,'2026-10-04T10:00:00Z');
 assert.equal((repo.saved[0]!.raw_metadata as any).review_priority.reasons.includes('public_registry'),true,'labels recomputed for this project');
 const [run]=summarizeRuns([{id:'run-2',query:'industriel',location:'x',categories:[],provider:'registry',status:'completed',started_at:'2026-10-05T10:00:00Z',completed_at:null,result_count:2,metrics:repo.metrics}]);
 assert.deepEqual(run!.reused,{by_email:'owner@t',started_at:'2026-10-04T10:00:00Z'});
 assert.equal(summarizeRuns([run!])[0]!.reused?.by_email,'owner@t');
});

test('reuse: wired before any provider request, never for “search new” nor the TEST source',async()=>{
 const api=await read('../src/discovery/api.ts');
 assert.match(api,/const reusable=name!=='fixture'&&input\.optional_filters\.search_mode!=='search_new'\?await findReusableDiscovery\(db,input,name\):null;/);
 assert.match(api,/start:\(i:DiscoveryInput,p:string\)=>startReusedDiscovery\(db,i,p,reusable\.run_id\)/);
 assert.match(fr['discovery.reusedNote'],/aucune requête externe ni quota/);assert.ok(en['discovery.reusedNote']);
 const panel=await read('../src/components/DiscoveryPanel.tsx');
 assert.match(panel,/\{current\?\.reused&&<p role="status" className="note discovery-reused">/);
});

test('account UI: a team section — owner invites/revokes/removes, member sees the team and can leave',async()=>{
 const section=await read('../src/components/TeamSection.tsx');
 assert.doesNotMatch(section,/localStorage|fetch\(/);
 for(const k of ['team.title','team.invite','team.inviteLink','team.copy','team.revoke','team.remove','team.leave','team.seats','team.readOnly','team.proOnly'])assert.ok(fr[k as keyof typeof fr]&&en[k as keyof typeof en],k);
 assert.match(fr['team.seats'],/\{n\}.*\{max\}/);
 const page=await read('../app/page.tsx');
 assert.match(page,/<TeamSection locale=\{locale\}/);
});

test('offers: Pro says what the team gives — up to 5 accounts, one shared base and quota',()=>{
 assert.equal(fr['offers.proPoint2'],'Jusqu’à 5 comptes : base de données et quotas partagés');
 assert.equal(en['offers.proPoint2'],'Up to 5 accounts: shared database and quotas');
});
