'use client';
// WEB-1 / WEB-2 — the ProspectOS 2.0 public homepage (docs/UI_V2.md), rendered by app/page.tsx in place of the legacy welcome
// screen when the site is built with NEXT_PUBLIC_WEB_V2_ENABLED (Preview), inside the shared public envelope (same header and
// footer as /tarifs, the SEO and the legal pages). Presentation only: the sign-up / sign-in card, the trial CTA wording, the
// demo link and the pricing dialog are the exact nodes and labels of app/page.tsx, passed in, so nothing commercial (trial,
// prices, CTA destination, legal, signup backend) can differ from main.
import {useEffect,useRef,type ReactNode} from 'react';
import '../foundations.css';
import './home.css';
import {Icon} from '../primitives.tsx';
import {PublicFooter,PublicHeader,PublicSiteShell} from '../public/PublicSite.tsx';
import type {Locale} from '../../../i18n/locale.ts';
import {HOME_COPY,type HomeCopy} from './copy.ts';

export type HomeV2Props={locale:Locale;localeSwitch:ReactNode;authCard:ReactNode;onLocale:(l:Locale)=>void;
 cta:{label:string;sub:string|null};demoLabel:string;onDemo:()=>void;loginLabel:string;onLogin:()=>void;contactLabel:string;children?:ReactNode};

// The 80-second presentation video (silent, invented companies). It plays muted only while on screen and never by itself when
// the visitor asked for reduced motion; the controls stay available, and the on-screen text is readable below it.
const HOME_VIDEO_SRC='/videos/prospectos-presentation.mp4';
// Shown before playback (Safari draws nothing otherwise): a frame of the same video — the "why this recommendation" panel, its
// source and excerpt, with the video's own "Exemple fictif · entreprises inventées" label. Not a logo, not a photo.
const HOME_VIDEO_POSTER='/videos/prospectos-presentation-poster.jpg';
function PresentationVideo({copy,demoLabel,onDemo}:{copy:HomeCopy;demoLabel:string;onDemo:()=>void}){
 const v=copy.video;
 const ref=useRef<HTMLVideoElement>(null);
 useEffect(()=>{const el=ref.current;if(!el||typeof IntersectionObserver==='undefined')return;
  const motion=window.matchMedia('(prefers-reduced-motion: no-preference)');
  const io=new IntersectionObserver(([e])=>{if(!e)return;
   if(e.isIntersecting&&motion.matches)el.play().catch(()=>{});else if(!e.isIntersecting)el.pause()},{threshold:.4});
  io.observe(el);return()=>io.disconnect();
 },[]);
 return <section className="pos-home__section pos-home__wrap pos-home__video" id="presentation" aria-labelledby="pos-home-video">
  <div className="pos-home__intro"><h2 id="pos-home-video" className="pos-home__h2">{v.title}</h2><p>{v.body}</p>
   <button type="button" className="pos-home__textlink" onClick={onDemo}>{demoLabel} <span aria-hidden="true">↗</span></button></div>
  <div className="pos-home__video-frame">
   <video ref={ref} src={HOME_VIDEO_SRC} muted loop playsInline controls preload="metadata" aria-label={v.label} poster={HOME_VIDEO_POSTER} data-testid="home-video"/>
  </div>
  <details className="pos-home__transcript"><summary>{v.transcriptLabel}</summary>
   <ol>{v.transcript.map(l=><li key={l}>{l}</li>)}</ol></details>
 </section>;
}

export function HomeV2({locale,localeSwitch,authCard,onLocale,cta,demoLabel,onDemo,loginLabel,onLogin,contactLabel,children}:HomeV2Props){
 const copy=HOME_COPY[locale];
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
 const header=<PublicHeader labels={{...copy.nav,login:loginLabel,creations:locale==='en'?'New businesses (FR)':'Créations d’entreprises'}} locale={localeSwitch}
  login={<button type="button" className="pos-pbtn pos-pbtn--secondary pos-pbtn--sm" onClick={login}>{loginLabel}</button>}/>;
 return <PublicSiteShell className="pos-home" lang={locale} header={header} footer={<PublicFooter labels={{...copy.footer,contact:contactLabel}}/>}>
  <div data-testid="home-v2">

  <main>
   <section className="pos-home__hero pos-home__hero--solo pos-home__wrap" aria-labelledby="pos-home-title">
    <div className="pos-home__hero-copy">
     <p className="pos-home__eyebrow">{copy.hero.eyebrow}</p>
     <h1 id="pos-home-title" className="pos-home__title">{copy.hero.title}</h1>
     <p className="pos-home__lines">{copy.hero.lines.map((l,i)=><span key={l} className={`pos-home__line pos-home__line--${i}`}>{l}</span>)}</p>
     <p className="pos-home__lead">{copy.hero.audience}</p>
     <div className="pos-home__ctas">
      <a className="pos-btn pos-btn--primary pos-btn--lg" href="#inscription" data-testid="home-cta">{cta.label}</a>
      <a className="pos-btn pos-btn--secondary pos-btn--lg" href="#presentation">{copy.hero.how}</a>
     </div>
     {cta.sub&&<p className="pos-home__cta-sub">{cta.sub}</p>}
     <a className="pos-home__textlink pos-home__barometer" href="/creations-entreprises">{copy.hero.barometer} <span aria-hidden="true">→</span></a>
    </div>
   </section>

   <PresentationVideo copy={copy} demoLabel={demoLabel} onDemo={onDemo}/>

   <section className="pos-home__section pos-home__wrap" aria-labelledby="pos-home-positioning">
    <h2 id="pos-home-positioning" className="pos-home__statement"><span>{copy.positioning.line1}</span> <span className="pos-home__accent">{copy.positioning.line2}</span></h2>
    <ul className="pos-home__pillars">{copy.positioning.pillars.map((p,i)=><li key={p.key} className={`pos-home__pillar pos-home__pillar--${i}`}>
     <p className="pos-home__pillar-key"><Icon name={(['prospects','signal','verified'] as const)[i]!} size={18}/>{p.key}</p>
     <h3>{p.question}</h3><p>{p.body}</p>
    </li>)}</ul>
    <p className="pos-home__guarantee"><Icon name="check" size={18}/>{copy.workflow.guarantee}</p>
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
