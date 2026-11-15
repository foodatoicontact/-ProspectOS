// Notification centre (migration 044, src/notifications): events of the veille dédiée journal become notifications —
// for the client (proposal, delivery, statement, termination) and, for the administrator only, acceptance, validation and
// reminder; « unread » is what came after the user's own seen_at; a bell in the top bar and the side navigation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {toNotification,CLIENT_KINDS,ADMIN_KINDS,type JournalEvent} from '../src/notifications/model.ts';
import {handleNotifications} from '../src/notifications/api.ts';
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const json=(value:unknown,status=200)=>Response.json(value,{status});
const ev=(kind:string,detail:Record<string,unknown>,at='2026-11-16T09:00:00Z'):JournalEvent=>({id:1,kind,detail,created_at:at,contract_id:'c',statement_id:null});
const opts={label:'Veille Île-de-France',seenAt:'2026-11-15T00:00:00Z',proposalPending:true,statementPending:true};

test('client notifications: proposal (to do while not accepted), delivery, statement, termination',()=>{
 const p=toNotification(ev('PROPOSAL_SENT',{version:1}),{audience:'client',...opts})!;
 assert.deepEqual([p.title,p.pending,p.unread,p.target],['Nouvelle proposition de veille',true,true,'dedicated']);
 assert.match(p.body,/« Veille Île-de-France »/);
 const d=toNotification(ev('DELIVERY_CREATED',{number:3,items:22}),{audience:'client',...opts})!;
 assert.deepEqual([d.title,d.body],['Livraison n° 3 disponible','22 entreprises à appeler · « Veille Île-de-France ».']);
 const s=toNotification(ev('STATEMENT_GENERATED',{month:'2027-01-01',amount_ht_cents:17900}),{audience:'client',...opts})!;
 assert.match(s.title,/Relevé de janvier 2027 à valider/);assert.match(s.body,/179,00\s€ HT · à valider avant le 5/);
 assert.equal(toNotification(ev('CONTRACT_TERMINATED',{access_until:'2027-06-01T00:00:00Z'}),{audience:'client',...opts})!.title,'Veille résiliée');
 assert.equal(toNotification(ev('PROPOSAL_SENT',{},'2026-11-14T00:00:00Z'),{audience:'client',...opts})!.unread,false,'before seen_at: read');
 assert.equal(toNotification(ev('ITEM_OPENED',{}),{audience:'client',...opts}),null,'internal events are not notifications');
 assert.equal(toNotification(ev('PROPOSAL_ACCEPTED',{}),{audience:'client',...opts}),null,'an admin event never reaches a client');
});
test('administrator notifications: acceptance, validation, reminder — to the admin screen',()=>{
 const a=toNotification(ev('PROPOSAL_ACCEPTED',{version:2,trial_starts_on:'2026-11-16'}),{audience:'admin',...opts})!;
 assert.deepEqual([a.title,a.target],['Proposition acceptée','dedicated-admin']);assert.match(a.body,/version 2 · essai à partir du 16 novembre 2026/);
 assert.match(toNotification(ev('STATEMENT_VALIDATED',{month:'2027-01-01',signed_count:3,amount_ht_cents:53700,late:true}),{audience:'admin',...opts})!.body,/3 signatures · 537,00\s€ HT \(en retard\)/);
 assert.match(toNotification(ev('STATEMENT_REMINDER',{month:'2027-01-01'}),{audience:'admin',...opts})!.title,/non validé/);
 assert.deepEqual([...CLIENT_KINDS],['PROPOSAL_SENT','DELIVERY_CREATED','STATEMENT_GENERATED','CONTRACT_TERMINATED']);
 assert.deepEqual([...ADMIN_KINDS],['PROPOSAL_ACCEPTED','STATEMENT_VALIDATED','STATEMENT_REMINDER']);
});
test('routes: flag off = empty list; « seen » is best effort; nothing for another path',async()=>{
 const db={rpc:async()=>({error:{message:'relation does not exist'}}),from:()=>{throw Error('no read with the flag off')}} as never;
 const deps={dedicatedEnabled:false,admin:false,now:()=>new Date('2026-11-16T10:00:00Z')};
 assert.equal(await handleNotifications(new Request('https://x/api/v1/prospects'),['prospects'],db,json,deps),null);
 assert.deepEqual(await (await handleNotifications(new Request('https://x/api/v1/notifications'),['notifications'],db,json,deps))!.json(),{items:[],unread:0});
 const seen=await handleNotifications(new Request('https://x/api/v1/notifications/seen',{method:'POST'}),['notifications','seen'],db,json,deps);
 assert.deepEqual(await seen!.json(),{seen:false},'before migration 044: no error, the bell just stays unread');
 const api=read('src/notifications/api.ts');
 assert.match(api,/if\(own\)q=q\.in\('organization_id',orgs\)/,'client events: the caller’s own organizations only');
 assert.match(api,/deps\.admin\?read\(ADMIN_KINDS,false\)/,'administrator events only for the administrator');
 assert.match(read('app/api/v1/[...path]/route.ts'),/admin:\(ent as \{plan\?:string;status\?:string\}\|null\)\?\.plan==='INTERNAL'&&\(ent as \{status\?:string\}\)\.status==='ACTIVE'/);
});
test('bell: in the top bar and the side navigation, live accounts only; opening it marks the notifications read',()=>{
 const page=read('app/page.tsx');
 assert.ok(page.includes("bell={mode==='live'?v=><v2.NotificationBell api={api} variant={v} onOpen={t=>{setV2Nav(null);setView(t);setFromList(false)}}/>:undefined}"));
 const shell=read('src/ui/v2/shell/AppShell.tsx');
 assert.match(shell,/bell=\{bell\?\.\('top'\)\}/);assert.match(shell,/bell=\{bell\?\.\('side'\)\}/);
 const bell=read('src/ui/v2/shell/NotificationBell.tsx');
 assert.match(bell,/api\('notifications\/seen','POST',\{\}\)/);assert.match(bell,/aria-label=\{label\}/);assert.match(bell,/Aucune notification pour l’instant\./);
});
