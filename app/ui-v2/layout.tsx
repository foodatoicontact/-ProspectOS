import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {connection} from 'next/server';
import {uiV2Enabled} from '../../src/ui/v2/flag.ts';
import {tokensCss} from '../../src/ui/v2/tokens.ts';
import '../../src/ui/v2/foundations.css';
import './gallery.css';

// UI-1 Preview surface. Decided per request (connection(): never prerendered, so the flag is read at runtime, not frozen
// with the build environment). Flag OFF → the same 404 as any unknown URL; the root layout and "/" are untouched.
export const metadata:Metadata={title:'Fondations UI v2 (Preview)',robots:{index:false,follow:false}};

export default async function UiV2Layout({children}:{children:React.ReactNode}){
 await connection();
 if(!uiV2Enabled(process.env))notFound();
 return <>
  <style href="pos-ui-tokens" precedence="default">{tokensCss()}</style>
  {children}
 </>;
}
