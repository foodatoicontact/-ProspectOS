import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {connection} from 'next/server';
import {uiV2BenchEnabled} from '../../src/ui/v2/flag.ts';
import {tokensCss} from '../../src/ui/v2/tokens.ts';
import '../../src/ui/v2/foundations.css';
import './gallery.css';

// UI-1 Preview surface. Decided per request (connection(): never prerendered, so the flag is read at runtime, not frozen
// with the build environment). Flag OFF → the same 404 as any unknown URL (no v2 title either: metadata is resolved even
// for a 404); the root layout and "/" are untouched. UI-5C: the benches need their own opt-in (uiV2BenchEnabled) on top of
// UI_V2_ENABLED, which Production sets for the shell — so they are never served in Production.
export function generateMetadata():Metadata{
 return uiV2BenchEnabled(process.env)?{title:'Fondations UI v2 (Preview)',robots:{index:false,follow:false}}:{};
}

export default async function UiV2Layout({children}:{children:React.ReactNode}){
 await connection();
 if(!uiV2BenchEnabled(process.env))notFound();
 return <>
  <style href="pos-ui-tokens" precedence="default">{tokensCss()}</style>
  {children}
 </>;
}
