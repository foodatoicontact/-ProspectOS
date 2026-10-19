// B1 (release gate): once Vercel exposes VERCEL_ENV to the runtime, it describes the environment and the feature flags keep
// controlling the features. Production with VERCEL_ENV=production must behave as Production does today (v2 shell ON,
// benches OFF, A/B OFF, ZF canary measurement written) while the Stripe locks start to bite (TEST key refused, LIVE key
// refused without BILLING_ALLOW_LIVE). Fictitious keys only: none of these values is a real secret.
import test from 'node:test';
import assert from 'node:assert/strict';
import {uiV2Enabled,uiV2BenchEnabled} from '../src/ui/v2/flag.ts';
import {uxAbEnabledFromEnv,uxEnvironment} from '../src/ux/variant.ts';
import {recordZfEvent,zfWritesAllowed} from '../src/server/ux-events.ts';
import {zeroFrictionTodayGate} from '../src/ux/zero-friction.ts';
import {billingConfig} from '../src/server/billing/config.ts';

const PROD={VERCEL_ENV:'production'};
const ORG='4ea4f313-557b-4bfb-84ac-ea106a06e97b',OTHER='11111111-1111-4111-8111-111111111111';
const USER='22222222-2222-4222-8222-222222222222',SESSION='33333333-3333-4333-8333-333333333333';

test('UI v2 — Production with the switch: shell ON; benches OFF even with the bench flag',()=>{
 assert.equal(uiV2Enabled({...PROD,UI_V2_ENABLED:'1'}),true);
 assert.equal(uiV2Enabled({...PROD}),false);
 assert.equal(uiV2BenchEnabled({...PROD,UI_V2_ENABLED:'1'}),false);
 assert.equal(uiV2BenchEnabled({...PROD,UI_V2_ENABLED:'1',UI_V2_BENCH_ENABLED:'1'}),false);
 // Today's Production (VERCEL_ENV not exposed): unchanged.
 assert.equal(uiV2Enabled({UI_V2_ENABLED:'1'}),true);
 assert.equal(uiV2BenchEnabled({UI_V2_ENABLED:'1'}),false);
 // A Preview under review keeps its benches.
 assert.equal(uiV2BenchEnabled({VERCEL_ENV:'preview',UI_V2_ENABLED:'1',UI_V2_BENCH_ENABLED:'1'}),true);
});

test('UI v2 — the public flag answers enabled:true in Production with the switch',async()=>{
 const {GET}=await import('../app/api/public/ui-v2/route.ts');
 const saved={...process.env};
 try{
  Object.assign(process.env,{VERCEL_ENV:'production',UI_V2_ENABLED:'1'});
  assert.deepEqual(await (await GET()).json(),{enabled:true});
 }finally{for(const k of ['VERCEL_ENV','UI_V2_ENABLED'])if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k]}
});

test('UX A/B — stays OFF in Production, even with its switch; the environment is reported',()=>{
 assert.equal(uxAbEnabledFromEnv({...PROD}),false);
 assert.equal(uxAbEnabledFromEnv({...PROD,UX_AB_ENABLED:'1'}),false);
 assert.equal(uxEnvironment({...PROD}),'production');
});

test('ZF events — Production keeps writing for the canary organization, never for another one',async()=>{
 const env={...PROD,ZERO_FRICTION_TODAY_ENABLED:'false',ZERO_FRICTION_TODAY_ORGS:ORG};
 const gate=zeroFrictionTodayGate(env);
 assert.equal(typeof gate,'function');
 const enabledFor=(org:string)=>typeof gate==='function'?gate(org):gate;
 assert.equal(zfWritesAllowed(enabledFor(ORG),env),'ok');
 assert.equal(zfWritesAllowed(enabledFor(OTHER),env),'flag_off');
 const inserts:unknown[]=[];
 const chain={eq:()=>chain,is:()=>chain,limit:async()=>({data:[],error:null})};
 const admin={from:()=>({select:()=>chain,insert:async(row:unknown)=>{inserts.push(row);return {error:null}}})} as never;
 const base={admin,env,userId:USER,kind:'ZF_TODAY_VIEWED',sessionId:SESSION,elapsedMs:1200,interactions:1};
 assert.equal(await recordZfEvent({...base,enabled:enabledFor(ORG),organizationId:ORG}),'recorded');
 assert.equal(await recordZfEvent({...base,enabled:enabledFor(OTHER),organizationId:OTHER}),'flag_off');
 assert.equal(inserts.length,1);
});

test('Billing — Production: TEST key refused; LIVE key refused without BILLING_ALLOW_LIVE, allowed with it',()=>{
 const test_={STRIPE_SECRET_KEY:'sk_test_fixture000',STRIPE_PRICE_BETA:'price_fixture'};
 const live={STRIPE_SECRET_KEY:'sk_live_fixture000',STRIPE_PRICE_BETA:'price_fixture'};
 assert.equal(billingConfig({...PROD,...test_}),null,'a TEST key never reaches Production');
 assert.equal(billingConfig({...PROD,...live}),null,'LIVE needs BILLING_ALLOW_LIVE');
 assert.equal(billingConfig({...PROD,...live,BILLING_ALLOW_LIVE:'false'}),null);
 assert.equal(billingConfig({...PROD,...live,BILLING_ALLOW_LIVE:'true'})?.mode,'live');
 assert.equal(billingConfig({VERCEL_ENV:'preview',...live,BILLING_ALLOW_LIVE:'true'}),null,'never LIVE outside Production');
 assert.equal(billingConfig({VERCEL_ENV:'preview',...test_})?.mode,'test');
});
