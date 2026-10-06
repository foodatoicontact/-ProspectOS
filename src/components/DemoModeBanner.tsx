'use client';
import {type Locale,translate,type TKey} from '../i18n';
// Demo mode, said plainly at the top of the demo: search results are synthetic, and real searches need an
// account (7-day free trial) — or, once the free-trial seats are gone (trialFull), a subscription. Static copy
// only; the button leads to sign-up or to the offers, it never activates anything.
export function DemoModeBanner({locale,trialFull,onTryReal,onSeeOffers}:{locale:Locale;trialFull:boolean;onTryReal:()=>void;onSeeOffers:()=>void}){
 const tr=(k:TKey)=>translate(locale,k);
 return <section className="demo-mode-banner" aria-labelledby="demo-mode-banner-title">
  <div>
   <h2 id="demo-mode-banner-title">{tr('demoBanner.title')}</h2>
   <p>{tr('demoBanner.synthetic')}</p>
   <p>{tr(trialFull?'demoBanner.full':'demoBanner.trial')}</p>
  </div>
  <button type="button" className="primary" onClick={trialFull?onSeeOffers:onTryReal}>{tr(trialFull?'demoBanner.ctaOffers':'demoBanner.cta')}</button>
 </section>;
}
