// Self-Outreach (docs/SELF_OUTREACH.md, migration 035) adds a few exact fragments to app/page.tsx (import, flag state,
// legacy nav entry, panel, v2 account-menu entry, legacy page heading) and its own keys to src/i18n/{fr,en}.ts. Byte-identical pins written
// by other blocks (UI v2, WEB-2, Zero-Friction) compare those files with older baselines: they compare them WITHOUT these
// fragments, so each pin still proves its own scope. Removing anything else is impossible: after stripping, no Self-Outreach trace may remain.
const PAGE_FRAGMENTS=[
 "import {SelfOutreachPanel} from '../src/components/SelfOutreachPanel';\n",
 'const [soOn,setSoOn]=useState(false);',
 'setSoOn(acc.self_outreach_enabled===true);',
 ",...(mode==='live'&&soOn?[['outreach','✉',tr('nav.selfOutreach')]]:[])",
 " {view==='outreach'&&mode==='live'&&soOn&&project&&<SelfOutreachPanel key={`so-${projectId}`} projectId={projectId} api={api} locale={locale}/>}\n",
 // v2 shell: the account-menu entry (the screen itself is the legacy panel inside the shell, like Bêta Analytics).
 ",selfOutreach:mode==='live'&&soOn?()=>{setV2Nav(null);setView('outreach');setFromList(false)}:null",
 // Legacy page heading: the Self-Outreach title and subtitle instead of the overview's.
 "view==='outreach'?tr('so.pageTitle'):",
 "view==='outreach'?tr('so.pageSubtitle'):",
];
// Veille dédiée (migration 043, owner request 15 nov. 2026) is set aside the same way: its account state, the two v2
// account-menu entries and the two v2 screens — nothing in the legacy shell, nothing in the i18n files.
const DEDICATED_FRAGMENTS=[
 " // Veille dédiée (migration 043): set from the account answer; shown in the v2 shell only.\n const [dedicatedAccess,setDedicatedAccess]=useState({enabled:false,client:false,proposals:0,statements:0});\n",
 ";setDedicatedAccess({enabled:acc.dedicated_tracking?.enabled===true,client:acc.dedicated_tracking?.client===true,proposals:Number(acc.dedicated_tracking?.proposals)||0,statements:Number(acc.dedicated_tracking?.statements)||0})",
 // The sign-in notice (proposal to accept, statement to validate), passed to the shell.
 " notice={mode==='live'&&dedicatedAccess.client&&view!=='dedicated'&&<v2.DedicatedNotice proposals={dedicatedAccess.proposals} statements={dedicatedAccess.statements} onOpen={()=>{setV2Nav(null);setView('dedicated');setFromList(false)}}/>}",
 "dedicated:mode==='live'&&dedicatedAccess.client?()=>{setV2Nav(null);setView('dedicated');setFromList(false)}:null,dedicatedPending:dedicatedAccess.proposals+dedicatedAccess.statements,dedicatedAdmin:mode==='live'&&dedicatedAccess.enabled&&entitlementPlan==='INTERNAL'?()=>{setV2Nav(null);setView('dedicated-admin');setFromList(false)}:null,",
 "   :view==='dedicated'&&mode==='live'&&dedicatedAccess.client?<v2.DedicatedClient api={api} token={token}/>\n   :view==='dedicated-admin'&&mode==='live'&&dedicatedAccess.enabled&&entitlementPlan==='INTERNAL'?<v2.DedicatedAdmin api={api}/>\n",
];
const I18N_KEYS=/^ '(?:nav\.selfOutreach|so\.[A-Za-z.]+)':.*\n/gm;
export function withoutSelfOutreach(src:string):string{
 let out=src;
 for(const f of DEDICATED_FRAGMENTS)out=out.split(f).join('');
 if(/dedicatedAccess|DedicatedClient|DedicatedAdmin|DedicatedNotice|dedicated_tracking/.test(out))throw Error('a veille dédiée fragment outside the known ones');
 for(const f of PAGE_FRAGMENTS)out=out.split(f).join('');
 out=out.replace(I18N_KEYS,'');
 if(/SelfOutreach|selfOutreach|soOn|setSoOn|self_outreach|'so\./.test(out))throw Error('a Self-Outreach fragment outside the known ones');
 return out;
}
