'use client';
import {type Locale,translate,type TKey} from '../i18n';
// Demo mode, said plainly at the top of the demo: search results are synthetic, and real searches need an
// account (7-day free trial). Static copy only; the button leads to sign-up, it never activates anything.
export function DemoModeBanner({locale,onTryReal}:{locale:Locale;onTryReal:()=>void}){
 const tr=(k:TKey)=>translate(locale,k);
 return <section className="demo-mode-banner" aria-labelledby="demo-mode-banner-title">
  <div>
   <h2 id="demo-mode-banner-title">{tr('demoBanner.title')}</h2>
   <p>{tr('demoBanner.synthetic')}</p>
   <p>{tr('demoBanner.trial')}</p>
  </div>
  <button type="button" className="primary" onClick={onTryReal}>{tr('demoBanner.cta')}</button>
 </section>;
}
