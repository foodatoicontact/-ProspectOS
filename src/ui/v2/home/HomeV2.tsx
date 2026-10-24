'use client';
// WEB-1 / WEB-2 — the ProspectOS 2.0 public homepage (docs/UI_V2.md), rendered by app/page.tsx in place of the legacy welcome
// screen when the site is built with NEXT_PUBLIC_WEB_V2_ENABLED (Preview), inside the shared public envelope (same header and
// footer as /tarifs, the SEO and the legal pages). Presentation only: the sign-up / sign-in card, the trial CTA wording, the
// demo link and the pricing dialog are the exact nodes and labels of app/page.tsx, passed in, so nothing commercial (trial,
// prices, CTA destination, legal, signup backend) can differ from main.
import {useEffect,useRef,useState,type ReactNode} from 'react';
import '../foundations.css';
import '../today/today.css';
import './home.css';
import {Button,Icon,StatusBadge} from '../primitives.tsx';
import {Mark,PublicFooter,PublicHeader,PublicSiteShell} from '../public/PublicSite.tsx';
import type {Locale} from '../../../i18n/locale.ts';
import {HOME_COPY,HERO_DEMO_ID,demoCompanies,type DemoCompany,type HomeCopy} from './copy.ts';

export type HomeV2Props={locale:Locale;localeSwitch:ReactNode;authCard:ReactNode;onLocale:(l:Locale)=>void;
 cta:{label:string;sub:string|null};demoLabel:string;onDemo:()=>void;loginLabel:string;onLogin:()=>void;contactLabel:string;children?:ReactNode};

function SignalLine({c,prefix}:{c:DemoCompany;prefix:string}){
 return <div className="pos-signal">
  <p className="pos-signal__type"><span className="pos-sigdot" aria-hidden="true"/><span><span className="pos-visually-hidden">{prefix}</span>{c.signal}</span></p>
  <p className="pos-signal__meta">{c.meta}</p>
 </div>;
}

// The Today 2.0 card (same markup and classes as src/ui/v2/today/TodayV2.tsx), fed by an invented company.
function DemoCard({c,locale,copy,headingLevel,actions}:{c:DemoCompany;locale:Locale;copy:HomeCopy;headingLevel:'h2'|'h3';actions?:ReactNode}){
 const H=headingLevel;
 return <article className={`pos-tcard pos-tcard--${c.status}`} aria-labelledby={`pos-home-card-${c.id}`}>
  <div className="pos-tcard__head"><span className="pos-tcard__initial" aria-hidden="true">{c.name[0]}</span><H id={`pos-home-card-${c.id}`} className="pos-tcard__name">{c.name}</H></div>
  <SignalLine c={c} prefix={copy.demo.signalPrefix}/>
  <StatusBadge status={c.status} locale={locale} className="pos-tcard__status"/>
  <p className="pos-tcard__why">{c.explanation}{c.note&&<span className="pos-tcard__note"> {c.note}</span>}</p>
  {actions??<div className="pos-tcard__actions">
   {c.action?<span className={`pos-btn pos-btn--${c.action.tone} pos-btn--sm`}>{c.action.label}</span>:<p className="pos-tcard__none">{copy.product.none}</p>}
   <span className="pos-btn pos-btn--quiet pos-btn--sm">{copy.demo.why}</span>
  </div>}
 </article>;
}

type Panel='why'|'complete'|null;
function HeroDemo({locale,copy,panel,setPanel}:{locale:Locale;copy:HomeCopy;panel:Panel;setPanel:(p:Panel)=>void}){
 const c=demoCompanies(locale).find(x=>x.id===HERO_DEMO_ID)!;
 const d=copy.demo;
 const opener=useRef<HTMLButtonElement|null>(null);
 const toggle=(p:Exclude<Panel,null>,el:HTMLButtonElement)=>{opener.current=el;setPanel(panel===p?null:p)};
 // Closing returns the focus to the button that opened the detail (or "Voir pourquoi" when the hero link opened it).
 const close=()=>{setPanel(null);(opener.current??document.querySelector<HTMLButtonElement>('.pos-home__why-btn'))?.focus()};
 return <div className="pos-home__stage pos-glass" id="demo" data-testid="home-demo">
  <p className="pos-home__stage-label"><Icon name="today" size={16}/>{copy.product.today}<span className="pos-home__fict">{d.label}</span></p>
  <DemoCard c={c} locale={locale} copy={copy} headingLevel="h2" actions={<div className="pos-tcard__actions">
   <Button variant="primary" size="sm" aria-expanded={panel==='complete'} aria-controls="pos-home-panel" onClick={e=>toggle('complete',e.currentTarget)}>{c.action!.label}</Button>
   <Button variant="quiet" size="sm" iconEnd="chevron-down" aria-expanded={panel==='why'} aria-controls="pos-home-panel" onClick={e=>toggle('why',e.currentTarget)}
    className={panel==='why'?'pos-home__why-btn is-open':'pos-home__why-btn'}>{d.why}</Button>
  </div>}/>
  <div id="pos-home-panel" className="pos-home__panel" hidden={!panel} role="region" aria-labelledby="pos-home-panel-title" data-testid="home-demo-panel">
   {panel&&<>
    <div className="pos-home__panel-head"><h3 id="pos-home-panel-title">{panel==='why'?d.whyTitle:d.completeTitle}</h3>
     <button type="button" className="pos-iconbtn" aria-label={d.close} onClick={close}><Icon name="close" size={18}/></button></div>
    {panel==='why'?<>
     <h4 className="pos-l2__h">{d.now}</h4>
     <p className="pos-l2__quote">{d.nowText}</p>
     <dl className="pos-facts"><div className="pos-facts__row"><dt>{d.source}</dt><dd>{d.sourceText}</dd></div></dl>
     <h4 className="pos-l2__h">{d.matching}</h4>
     <ul className="pos-checks">{d.matchingItems.map(x=><li key={x}><Icon name="verified" size={18} className="pos-checks__ok"/><span>{x}<small>{d.verified}</small></span></li>)}</ul>
    </>:<p className="pos-complete__intro">{d.completeText}</p>}
    <h4 className="pos-l2__h">{d.missing}</h4>
    <ul className="pos-checks">{d.missingItems.map(x=><li key={x}><Icon name="verify" size={18} className="pos-checks__todo"/><span>{x}<small>{d.todo}</small></span></li>)}</ul>
   </>}
  </div>
  <p className="pos-home__caption">{d.caption}</p>
 </div>;
}

// A still picture of Today 2.0 built from the real components: never focusable, described once for assistive technologies.
function TodayPreview({locale,copy,theme}:{locale:Locale;copy:HomeCopy;theme:'light'|'dark'}){
 const cs=demoCompanies(locale);const p=copy.product;
 const count=(s:DemoCompany['status'])=>cs.filter(c=>c.status===s).length;
 return <figure className="pos-home__shot" role="img" aria-label={theme==='light'?p.mockAria:p.mockDarkAria} data-testid={`home-preview-${theme}`}>
  <div className="pos-home__frame" aria-hidden="true" inert>
   <div className="pos-home__frame-bar"><Mark/><b>{p.today}</b><span>{p.project}</span><span className="pos-home__fict">{copy.demo.label}</span></div>
   <div className="pos-home__frame-body">
    <div className="pos-chips pos-chips--segmented pos-glass">
     {(['contact','verify','watch'] as const).map(s=><span key={s} className={`pos-chip pos-chip--${s}`}>
      <span className="pos-chip__dot"/><b className="pos-chip__count">{count(s)}</b><span>{p.counts[s]}</span></span>)}
    </div>
    <ul className="pos-today__list">{cs.map(c=><li key={c.id}><DemoCard c={c} locale={locale} copy={copy} headingLevel="h3"/></li>)}</ul>
   </div>
  </div>
 </figure>;
}

export function HomeV2({locale,localeSwitch,authCard,onLocale,cta,demoLabel,onDemo,loginLabel,onLogin,contactLabel,children}:HomeV2Props){
 const copy=HOME_COPY[locale];
 const [panel,setPanel]=useState<Panel>(null);
 const authRef=useRef<HTMLDivElement>(null);
 // "Me connecter": the existing sign-in view of the existing card, then the card itself (focus on its first field).
 function login(){
  onLogin();
  requestAnimationFrame(()=>{const el=authRef.current;if(!el)return;el.scrollIntoView({block:'start'});el.querySelector<HTMLInputElement>('input[type="email"]')?.focus({preventScroll:true})});
 }
 // Arrivals from the other public pages: "Me connecter" (/#connexion) and EN (/?lang=en), handled once, then the URL is cleaned.
 const arrived=useRef(false);
 useEffect(()=>{if(arrived.current)return;arrived.current=true;
  const u=new URL(window.location.href);const lang=u.searchParams.get('lang');
  if(lang==='fr'||lang==='en'){onLocale(lang);u.searchParams.delete('lang');window.history.replaceState(window.history.state,'',u.toString())}
  if(u.hash==='#connexion')login();
 },[]);// eslint-disable-line react-hooks/exhaustive-deps
 const header=<PublicHeader labels={{...copy.nav,login:loginLabel}} locale={localeSwitch}
  login={<button type="button" className="pos-pbtn pos-pbtn--secondary pos-pbtn--sm" onClick={login}>{loginLabel}</button>}/>;
 return <PublicSiteShell className="pos-home" lang={locale} header={header} footer={<PublicFooter labels={{...copy.footer,contact:contactLabel}}/>}>
  <div data-testid="home-v2">

  <main>
   <section className="pos-home__hero pos-home__wrap" aria-labelledby="pos-home-title">
    <div className="pos-home__hero-copy">
     <p className="pos-home__eyebrow">{copy.hero.eyebrow}</p>
     <h1 id="pos-home-title" className="pos-home__title">{copy.hero.title}</h1>
     <p className="pos-home__lines">{copy.hero.lines.map((l,i)=><span key={l} className={`pos-home__line pos-home__line--${i}`}>{l}</span>)}</p>
     <p className="pos-home__lead">{copy.hero.subtitle}</p>
     <div className="pos-home__ctas">
      <a className="pos-btn pos-btn--primary pos-btn--lg" href="#inscription" data-testid="home-cta">{cta.label}</a>
      <a className="pos-btn pos-btn--secondary pos-btn--lg" href="#demo" onClick={()=>setPanel('why')}>{copy.hero.how}</a>
     </div>
     {cta.sub&&<p className="pos-home__cta-sub">{cta.sub}</p>}
     <p className="pos-home__human"><Icon name="verified" size={16}/>{copy.hero.human}</p>
    </div>
    <HeroDemo locale={locale} copy={copy} panel={panel} setPanel={setPanel}/>
   </section>

   <section className="pos-home__section pos-home__wrap" aria-labelledby="pos-home-positioning">
    <h2 id="pos-home-positioning" className="pos-home__statement"><span>{copy.positioning.line1}</span> <span className="pos-home__accent">{copy.positioning.line2}</span></h2>
    <ul className="pos-home__pillars">{copy.positioning.pillars.map((p,i)=><li key={p.key} className={`pos-home__pillar pos-home__pillar--${i}`}>
     <p className="pos-home__pillar-key"><Icon name={(['prospects','signal','verified'] as const)[i]!} size={18}/>{p.key}</p>
     <h3>{p.question}</h3><p>{p.body}</p>
    </li>)}</ul>
   </section>

   <section className="pos-home__section pos-home__wrap" id="fonctionnement" aria-labelledby="pos-home-workflow">
    <h2 id="pos-home-workflow" className="pos-home__h2">{copy.workflow.title}</h2>
    <ol className="pos-home__steps">{copy.workflow.steps.map((s,i)=><li key={s.name} className={i===copy.workflow.steps.length-1?'pos-home__step is-human':'pos-home__step'}>
     <span className="pos-home__step-n" aria-hidden="true">{i+1}</span><div><h3>{s.name}</h3><p>{s.body}</p></div>
    </li>)}</ol>
    <p className="pos-home__motto">{copy.workflow.motto.map(m=><span key={m}>{m}</span>)}</p>
    <p className="pos-home__guarantee"><Icon name="check" size={18}/>{copy.workflow.guarantee}</p>
   </section>

   <section className="pos-home__section pos-home__wrap pos-home__product" aria-labelledby="pos-home-product">
    <div className="pos-home__intro"><h2 id="pos-home-product" className="pos-home__h2">{copy.product.title}</h2><p>{copy.product.body}</p>
     <button type="button" className="pos-home__textlink" onClick={onDemo}>{demoLabel} <span aria-hidden="true">↗</span></button></div>
    <TodayPreview locale={locale} copy={copy} theme="light"/>
   </section>

   <section className="pos-ui pos-home__dark" data-theme="dark" aria-labelledby="pos-home-dark">
    <div className="pos-home__wrap pos-home__product">
     <div className="pos-home__intro"><h2 id="pos-home-dark" className="pos-home__h2">{copy.product.darkTitle}</h2><p>{copy.product.darkBody}</p></div>
     <TodayPreview locale={locale} copy={copy} theme="dark"/>
    </div>
   </section>

   <section className="pos-home__section pos-home__wrap pos-home__signup" aria-labelledby="pos-home-signup">
    <div className="pos-home__intro"><h2 id="pos-home-signup" className="pos-home__h2">{copy.signup.title}</h2><p>{copy.signup.body}</p>
     <ul className="pos-home__points">{copy.signup.points.map(p=><li key={p}><Icon name="check" size={18}/>{p}</li>)}</ul></div>
    <div className="pos-home__auth" ref={authRef}>{authCard}</div>
   </section>
  </main>
  </div>
  <div className="pos-legacy">{children}</div>
 </PublicSiteShell>;
}
