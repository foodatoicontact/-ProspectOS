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
const I18N_KEYS=/^ '(?:nav\.selfOutreach|so\.[A-Za-z.]+)':.*\n/gm;
export function withoutSelfOutreach(src:string):string{
 let out=src;
 for(const f of PAGE_FRAGMENTS)out=out.split(f).join('');
 out=out.replace(I18N_KEYS,'');
 if(/SelfOutreach|selfOutreach|soOn|setSoOn|self_outreach|'so\./.test(out))throw Error('a Self-Outreach fragment outside the known ones');
 return out;
}
