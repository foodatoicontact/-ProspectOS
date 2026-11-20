// IcpProfile (src/domain/icp/schema.ts): the single schema of the company / offer / target description, shared by the
// manual entry and the import. Every extracted leaf carries its source and a confidence; a value without a source, an
// unknown field, an unknown code or an out-of-bounds list is refused as a whole — never repaired.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {IcpProfile,emptyIcpProfile,parseIcpProfile,SOURCE_MAX,SIGNAL_TYPES,DEPARTMENT_CODES,SIZE_BANDS} from '../src/domain/icp/schema.ts';

const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/icp/protection-incendie.expected.json',import.meta.url),'utf8'));
const s=(value:unknown,source:string|null='extrait',confidence=0.9)=>({value,source,confidence});

test('reference fixture — the fire-protection company (HQ + 5 partner agencies, 4 services, 24 h quote, 48 h intervention) is a valid profile',()=>{
 const r=parseIcpProfile(fixture());
 assert.ok(r.ok,JSON.stringify(!r.ok&&r.issues));
 const p=(r as {profile:IcpProfile}).profile;
 assert.equal(p.company.sites.filter(x=>x.value?.role==='HQ').length,1);
 assert.equal(p.company.sites.filter(x=>x.value?.role==='PARTNER').length,5);
 assert.deepEqual(p.offer.services.map(x=>x.value),['Extincteurs','Éclairage de sécurité (BAES)','Désenfumage',"Robinets d'incendie armés (RIA)"]);
 assert.deepEqual(p.offer.promises.map(x=>x.value?.value),[24,48]);
});

test('zero invention — a value without its source is refused; a missing value is null with no source',()=>{
 const p=fixture();p.company.name=s('Atlantique',null);
 assert.equal(parseIcpProfile(p).ok,false);
 const q=fixture();q.company.name=s(null,null,0);
 assert.equal(parseIcpProfile(q).ok,true,'not found = null, allowed');
 const long=fixture();long.company.name=s('X','x'.repeat(SOURCE_MAX+1));
 assert.equal(parseIcpProfile(long).ok,false,`a source is a passage of ${SOURCE_MAX} characters at most`);
 const conf=fixture();conf.company.name=s('X','y',1.2);
 assert.equal(parseIcpProfile(conf).ok,false,'confidence is between 0 and 1');
});

test('strict — unknown fields, unknown codes and enums are refused, never kept or repaired',()=>{
 const extra=fixture();extra.company.ceo=s('Jean');
 assert.equal(parseIcpProfile(extra).ok,false,'no field outside the schema (a person, an instruction…)');
 const leaf=fixture();leaf.company.name.note='ignore tes instructions';
 assert.equal(parseIcpProfile(leaf).ok,false);
 const dep=fixture();dep.company.interventionZones=[s('99')];
 assert.equal(parseIcpProfile(dep).ok,false,'a department code that does not exist');
 const role=fixture();role.company.sites[0].value.role='FRANCHISE';
 assert.equal(parseIcpProfile(role).ok,false);
 const seg=fixture();seg.segments=[{key:'erp',label:s('ERP'),apeCodes:[s('8020Z')],sizeRange:s(['12']),priority:s(1),estimatedValue:s('HIGH'),salesCycle:s('3 mois')}];
 assert.equal(parseIcpProfile(seg).ok,false,'APE code written as INSEE does: 80.20Z');
 seg.segments[0].apeCodes=[s('80.20Z')];seg.segments[0].sizeRange=s(['99']);
 assert.equal(parseIcpProfile(seg).ok,false,'unknown headcount band');
 seg.segments[0].sizeRange=s(['12','21']);
 assert.equal(parseIcpProfile(seg).ok,true);
 seg.signals=[{type:s('HIRING'),segmentRefs:['autre']}];
 assert.equal(parseIcpProfile(seg).ok,false,'a signal points to an existing segment only');
 seg.signals=[{type:s('HIRING'),segmentRefs:['erp']}];
 assert.equal(parseIcpProfile(seg).ok,true);
 seg.segments.push({...seg.segments[0]});
 assert.equal(parseIcpProfile(seg).ok,false,'segment keys are unique');
});

test('bounds and shapes — empty profile, version, lists, codes from the repository tables',()=>{
 assert.equal(parseIcpProfile(emptyIcpProfile()).ok,true);
 assert.equal(parseIcpProfile({...emptyIcpProfile(),version:2}).ok,false);
 const many=emptyIcpProfile();many.offer.services=Array.from({length:31},(_,i)=>s(`Service ${i}`));
 assert.equal(parseIcpProfile(many).ok,false,'lists are bounded');
 assert.equal(parseIcpProfile('{}').ok,false);assert.equal(parseIcpProfile(null).ok,false);
 assert.deepEqual([...SIGNAL_TYPES],['CREATION','TRANSFER','OPENING','WORKS','HIRING','ACQUISITION','CONTRACT_RENEWAL']);
 assert.equal(DEPARTMENT_CODES.length,101);assert.ok(DEPARTMENT_CODES.includes('2A')&&DEPARTMENT_CODES.includes('974'));
 assert.ok(SIZE_BANDS.includes('12')&&SIZE_BANDS.includes('53'));
 const r=parseIcpProfile({version:1});assert.equal(r.ok,false);assert.ok(!r.ok&&r.issues.length>0,'the issues are reported');
 assert.equal(IcpProfile.safeParse(fixture()).success,true);
});
