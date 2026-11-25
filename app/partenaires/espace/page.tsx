import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {PARTNERS} from '../../../src/partners/flag';
import {tokensCss} from '../../../src/ui/v2/tokens';
import {PartnerApp} from '../../../src/ui/v2/partners/PartnerApp';
import '../../../src/ui/v2/foundations.css';
import '../../../src/ui/v2/dedicated/dedicated.css';
// Programme partenaires (052): the partner's space. Behind NEXT_PUBLIC_PARTNERS_ENABLED (404 otherwise); never indexed.
export const metadata:Metadata={title:{absolute:'Espace partenaire | ProspectOS'},robots:{index:false,follow:false}};
export default function Page(){
 if(!PARTNERS)notFound();
 return <main className="pos-ui" style={{minHeight:'100vh',background:'var(--pos-bg)'}}>
  <style href="pos-ui-tokens" precedence="default">{tokensCss()}</style>
  <PartnerApp mode="space"/>
 </main>;
}
