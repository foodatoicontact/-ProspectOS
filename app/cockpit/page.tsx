import type {Metadata} from 'next';
import {tokensCss} from '../../src/ui/v2/tokens';
import {CockpitApp} from '../../src/ui/v2/cockpit/CockpitApp';
import '../../src/ui/v2/foundations.css';
import '../../src/ui/v2/dedicated/dedicated.css';
import '../../src/ui/v2/cockpit/cockpit.css';
// Cockpit administrateur (migration 056): the administrator's feed. The database checks the INTERNAL entitlement and RLS
// hides every row from anyone else; this page only shows what the API answers. Never indexed.
export const metadata:Metadata={title:{absolute:'Cockpit | ProspectOS'},robots:{index:false,follow:false}};
export default function Page(){
 return <main className="pos-ui" style={{minHeight:'100vh',background:'var(--pos-bg)'}}>
  <style href="pos-ui-tokens" precedence="default">{tokensCss()}</style>
  <CockpitApp/>
 </main>;
}
