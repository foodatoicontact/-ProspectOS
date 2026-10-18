// WEB-2 — styles of the ProspectOS 2.0 public site, inlined by PublicSiteShell (a <style> element, never a CSS import: a page
// that does not render the v2 envelope keeps exactly its previous stylesheets). Scoped to .pos-ui.pos-public, tokens only
// (no literal colour), so app/globals.css (the legacy green / beige look) is overridden wherever it would leak in.
export const PUBLIC_CSS=String.raw`
.pos-ui.pos-public{--pos-public-gutter:16px;--pos-public-max:1180px;--pos-public-reading:720px;min-height:100vh;min-height:100dvh;
 background:var(--pos-halo),var(--pos-bg);background-attachment:fixed;color:var(--pos-text-1);font-family:var(--pos-font-ui);font-size:var(--pos-text-base);
 line-height:var(--pos-leading-normal);-webkit-font-smoothing:antialiased;overflow-x:clip}
.pos-ui.pos-public *,.pos-ui.pos-public *::before,.pos-ui.pos-public *::after{box-sizing:border-box}
.pos-ui.pos-public :where(h1,h2,h3,h4){font-family:var(--pos-font-display);color:var(--pos-text-1);letter-spacing:-.03em;line-height:var(--pos-leading-tight);margin:0}
.pos-ui.pos-public :where(p){line-height:var(--pos-leading-normal)}
/* Neutralise the bare-element rules of app/globals.css (footer flex 9 px, h1/h2 margins, small) inside the public site, at a
   specificity (0,1,1) that beats them and loses to every class rule below and in home.css. */
.pos-public :is(h1,h2,h3,h4){margin:0}
.pos-public footer{display:block;justify-content:normal;gap:0;font-size:inherit;color:inherit}
.pos-public small{font-size:var(--pos-text-sm);color:var(--pos-text-3)}
.pos-ui.pos-public a:not([class]){color:var(--pos-accent)}
.pos-ui.pos-public a:not([class]):hover{color:var(--pos-accent-hover)}
.pos-ui.pos-public :focus-visible{outline:2px solid var(--pos-accent);outline-offset:2px}
.pos-ui.pos-public :focus:not(:focus-visible){outline:none}
.pos-ui.pos-public [id]{scroll-margin-top:84px}
@media (prefers-reduced-motion:no-preference){html:has(.pos-ui.pos-public){scroll-behavior:smooth}}
.pos-ui .pos-public__wrap{width:100%;max-width:calc(var(--pos-public-max) + 2 * var(--pos-public-gutter));margin:0 auto;padding-inline:var(--pos-public-gutter)}
.pos-ui .pos-public__sr,.pos-ui.pos-public .sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* Logo */
.pos-ui .pos-mark{width:30px;height:30px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--pos-mark-bg);box-shadow:var(--pos-mark-shadow)}
.pos-ui .pos-mark svg{fill:none;stroke:var(--pos-mark-fg);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pos-ui .pos-mark circle{fill:var(--pos-signal-dot);stroke:none}
.pos-ui.pos-public a.pos-public__brand{display:inline-flex;align-items:center;gap:10px;min-height:44px;color:var(--pos-text-1);text-decoration:none;
 font-family:var(--pos-font-display);font-weight:var(--pos-weight-heavy);font-size:var(--pos-text-lg);letter-spacing:-.03em}

/* Buttons (links or buttons): indigo primary, quiet secondary; 44 px targets. */
.pos-ui.pos-public .pos-pbtn{display:inline-flex;align-items:center;justify-content:center;gap:var(--pos-space-2);min-height:44px;
 padding:0 var(--pos-space-4);border:1px solid transparent;border-radius:var(--pos-radius-md);font:inherit;font-weight:var(--pos-weight-semibold);
 font-size:var(--pos-text-base);line-height:1.2;text-decoration:none;cursor:pointer;text-align:center;
 transition:background-color var(--pos-dur-fast) var(--pos-ease-standard),border-color var(--pos-dur-fast) var(--pos-ease-standard)}
.pos-ui.pos-public .pos-pbtn--lg{min-height:48px;padding:var(--pos-space-2) var(--pos-space-5);font-size:var(--pos-text-md)}
.pos-ui.pos-public .pos-pbtn--sm{padding:0 var(--pos-space-3);font-size:var(--pos-text-sm)}
.pos-ui.pos-public .pos-pbtn--primary{background:var(--pos-accent);color:var(--pos-on-accent);box-shadow:var(--pos-shadow-accent)}
.pos-ui.pos-public .pos-pbtn--primary:hover{background:var(--pos-accent-hover);color:var(--pos-on-accent)}
.pos-ui.pos-public .pos-pbtn--secondary{background:var(--pos-surface-card);color:var(--pos-text-1);border-color:var(--pos-border-strong)}
.pos-ui.pos-public .pos-pbtn--secondary:hover{background:var(--pos-surface-inset);color:var(--pos-text-1)}

/* ── Header ─────────────────────────────────────────────────────────────────────────────────────────── */
.pos-ui .pos-public__top{position:sticky;top:0;z-index:5;border-bottom:1px solid var(--pos-glass-border);background:var(--pos-glass);
 -webkit-backdrop-filter:blur(var(--pos-blur-glass)) saturate(150%);backdrop-filter:blur(var(--pos-blur-glass)) saturate(150%)}
.pos-ui .pos-public__bar{display:flex;align-items:center;gap:var(--pos-space-2);min-height:64px;position:relative}
.pos-ui .pos-public__bar>.pos-public__brand{margin-right:auto}
.pos-ui .pos-public__nav{display:none;align-items:center;gap:var(--pos-space-1)}
.pos-ui.pos-public a.pos-public__navlink{display:inline-flex;align-items:center;min-height:44px;padding:0 var(--pos-space-3);border-radius:var(--pos-radius-md);
 color:var(--pos-text-2);font-weight:var(--pos-weight-semibold);text-decoration:none}
.pos-ui.pos-public a.pos-public__navlink:hover{background:var(--pos-accent-soft);color:var(--pos-text-1)}
.pos-ui .pos-public__locale .locale-switch{display:inline-flex;border:1px solid var(--pos-border);border-radius:var(--pos-radius-md);overflow:hidden;background:var(--pos-surface-card)}
.pos-ui.pos-public .pos-public__locale .locale-switch>*{display:inline-flex;align-items:center;justify-content:center;min-width:40px;min-height:44px;padding:0 6px;border:0;border-radius:0;
 background:transparent;color:var(--pos-text-2);font:inherit;font-size:var(--pos-text-xs);font-weight:var(--pos-weight-bold);letter-spacing:.04em;text-decoration:none;cursor:pointer}
.pos-ui.pos-public .pos-public__locale .locale-switch>*:hover{background:var(--pos-accent-soft);color:var(--pos-text-1)}
.pos-ui.pos-public .pos-public__locale .locale-switch>.active{background:var(--pos-accent-soft);color:var(--pos-accent);box-shadow:inset 0 -2px 0 var(--pos-accent)}
.pos-ui.pos-public .pos-public__locale .locale-switch>*:focus-visible{outline-offset:-2px}
.pos-ui .pos-public__menu{position:static}
.pos-ui .pos-public__menu>summary{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:var(--pos-radius-md);
 list-style:none;cursor:pointer;color:var(--pos-text-1);border:1px solid var(--pos-border)}
.pos-ui .pos-public__menu>summary::-webkit-details-marker{display:none}
.pos-ui .pos-public__menu>summary svg{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.pos-ui .pos-public__menu[open]>summary{background:var(--pos-accent-soft)}
.pos-ui .pos-public__menu-panel{position:absolute;right:var(--pos-public-gutter);top:calc(100% + 4px);display:flex;flex-direction:column;align-items:stretch;gap:var(--pos-space-2);
 min-width:200px;padding:var(--pos-space-3);border-radius:var(--pos-radius-lg);background:var(--pos-surface-card);border:1px solid var(--pos-border);box-shadow:var(--pos-shadow-float)}
@media (min-width:640px){
 .pos-ui .pos-public__nav{display:flex}
 .pos-ui .pos-public__menu{display:none}
}
@media (max-width:359px){.pos-ui .pos-public__bar>.pos-public__brand>span:not(.pos-mark){position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}

/* ── Hero, sections, cards ──────────────────────────────────────────────────────────────────────────── */
.pos-ui .pos-public__hero{padding:var(--pos-space-8) 0 var(--pos-space-6)}
.pos-ui .pos-public__hero .pos-public__wrap{max-width:calc(var(--pos-public-reading) + 2 * var(--pos-public-gutter))}
.pos-ui .pos-public__eyebrow{margin:0 0 var(--pos-space-3);font-size:var(--pos-text-xs);font-weight:var(--pos-weight-bold);letter-spacing:.12em;text-transform:uppercase;color:var(--pos-accent)}
.pos-ui .pos-public__h1{font-size:clamp(30px,7.4vw,48px);font-weight:var(--pos-weight-heavy);letter-spacing:-.04em;line-height:1.1;text-wrap:balance}
.pos-ui .pos-public__lead{margin:var(--pos-space-4) 0 0;font-size:var(--pos-text-lg);color:var(--pos-text-2);line-height:var(--pos-leading-normal)}
.pos-ui .pos-public__meta{margin:var(--pos-space-3) 0 0;font-size:var(--pos-text-sm);color:var(--pos-text-3)}
.pos-ui .pos-public__section{padding:var(--pos-space-5) 0}
.pos-ui .pos-public__section--reading>.pos-public__wrap{max-width:calc(var(--pos-public-reading) + 2 * var(--pos-public-gutter))}
.pos-ui .pos-public__card{padding:var(--pos-space-5);background:var(--pos-surface-card);border:1px solid var(--pos-border);border-radius:var(--pos-radius-xl);box-shadow:var(--pos-shadow-card)}

/* Long-form reading (SEO articles, legal text): one 720 px column, 17 px body, generous rhythm. */
.pos-ui .pos-public__prose{font-size:17px;line-height:1.7;color:var(--pos-text-2)}
.pos-ui .pos-public__prose h2{margin:var(--pos-space-8) 0 var(--pos-space-4);font-size:clamp(23px,5vw,30px);font-weight:var(--pos-weight-heavy);letter-spacing:-.035em;line-height:1.2;color:var(--pos-text-1)}
.pos-ui .pos-public__prose>section:first-child>h2,.pos-ui .pos-public__prose>h2:first-child{margin-top:var(--pos-space-4)}
.pos-ui .pos-public__prose h3{margin:var(--pos-space-6) 0 var(--pos-space-2);font-size:var(--pos-text-xl);font-weight:var(--pos-weight-heavy);letter-spacing:-.02em;color:var(--pos-text-1)}
.pos-ui .pos-public__prose p{margin:0 0 var(--pos-space-4)}
.pos-ui .pos-public__prose ul,.pos-ui .pos-public__prose ol{margin:0 0 var(--pos-space-5);padding-left:24px}
.pos-ui .pos-public__prose li{margin-bottom:var(--pos-space-2)}
.pos-ui .pos-public__prose li::marker{color:var(--pos-accent)}
.pos-ui .pos-public__prose b,.pos-ui .pos-public__prose strong{color:var(--pos-text-1)}
.pos-ui.pos-public .pos-public__prose a{font-weight:var(--pos-weight-semibold);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
.pos-ui .pos-public__prose .seo-callout{margin:var(--pos-space-5) 0;padding:var(--pos-space-5);border-radius:var(--pos-radius-xl);background:var(--pos-surface-card);
 border:1px solid var(--pos-border);box-shadow:var(--pos-shadow-card);border-left:4px solid var(--pos-accent)}
.pos-ui .pos-public__prose .seo-callout p{margin:0}
.pos-ui .pos-public__prose .seo-callout .seo-callout-title{margin-bottom:var(--pos-space-2);font-family:var(--pos-font-display);font-weight:var(--pos-weight-heavy);font-size:var(--pos-text-lg);color:var(--pos-text-1)}
.pos-ui .pos-public__prose .muted{font-size:var(--pos-text-md);color:var(--pos-text-3)}

/* FAQ: every question and answer visible (indexable), one card each. */
.pos-ui .pos-public__faq{display:grid;gap:var(--pos-space-3);margin-top:var(--pos-space-4)}
.pos-ui .pos-public__faq .pos-public__card h3{margin:0 0 var(--pos-space-2);font-size:var(--pos-text-lg)}
.pos-ui .pos-public__faq .pos-public__card p{margin:0}

/* Closing call to action */
.pos-ui .pos-public__cta{padding:var(--pos-space-7) 0}
.pos-ui .pos-public__cta .pos-public__wrap{max-width:calc(var(--pos-public-reading) + 2 * var(--pos-public-gutter))}
.pos-ui .pos-public__cta-panel{padding:var(--pos-space-6);border-radius:var(--pos-radius-sheet);background:var(--pos-surface-card);border:1px solid var(--pos-border);box-shadow:var(--pos-shadow-float)}
.pos-ui .pos-public__cta-panel h2{font-size:clamp(22px,5vw,28px);font-weight:var(--pos-weight-heavy);letter-spacing:-.035em}
.pos-ui .pos-public__cta-panel p{margin:var(--pos-space-2) 0 var(--pos-space-5);color:var(--pos-text-2);font-size:var(--pos-text-md)}

/* Related pages */
.pos-ui .pos-public__related{padding:0 0 var(--pos-space-8)}
.pos-ui .pos-public__related .pos-public__wrap{max-width:calc(var(--pos-public-reading) + 2 * var(--pos-public-gutter))}
.pos-ui .pos-public__related-h{display:block;margin:0 0 var(--pos-space-3);font-size:var(--pos-text-xs);font-weight:var(--pos-weight-bold);letter-spacing:.12em;text-transform:uppercase;color:var(--pos-text-3)}
.pos-ui .pos-public__related-list{display:grid;gap:var(--pos-space-2)}
.pos-ui.pos-public a.pos-public__related-link{display:flex;align-items:center;justify-content:space-between;gap:var(--pos-space-3);min-height:52px;padding:var(--pos-space-3) var(--pos-space-4);
 border-radius:var(--pos-radius-lg);background:var(--pos-surface-card);border:1px solid var(--pos-border);color:var(--pos-text-1);font-weight:var(--pos-weight-semibold);text-decoration:none}
.pos-ui.pos-public a.pos-public__related-link:hover{border-color:var(--pos-accent);color:var(--pos-accent)}
.pos-ui .pos-public__related-link span[aria-hidden]{color:var(--pos-accent)}

/* ── Footer ─────────────────────────────────────────────────────────────────────────────────────────── */
.pos-ui.pos-public .pos-public__footer{margin-top:var(--pos-space-6);border-top:1px solid var(--pos-hairline);background:var(--pos-glass-solid)}
.pos-ui .pos-public__footer-grid{display:grid;gap:var(--pos-space-6);padding-top:var(--pos-space-8);padding-bottom:var(--pos-space-6)}
.pos-ui .pos-public__footer-h{margin:0 0 var(--pos-space-2);font-size:var(--pos-text-xs);font-weight:var(--pos-weight-bold);letter-spacing:.12em;text-transform:uppercase;color:var(--pos-text-3)}
.pos-ui .pos-public__footer ul{list-style:none;margin:0;padding:0;display:grid;gap:0 var(--pos-space-5);grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
.pos-ui.pos-public .pos-public__footer ul a{display:inline-flex;align-items:center;min-height:44px;color:var(--pos-text-2);text-decoration:none;font-size:var(--pos-text-sm)}
.pos-ui.pos-public .pos-public__footer ul a:hover{color:var(--pos-accent);text-decoration:underline}
.pos-ui .pos-public__copy{padding-top:var(--pos-space-4);padding-bottom:var(--pos-space-6);border-top:1px solid var(--pos-hairline);font-size:var(--pos-text-sm);color:var(--pos-text-3)}

/* ── /tarifs: the existing offers block (same markup and words), v2 surfaces ────────────────────────── */
.pos-ui .pos-public__offers{padding:var(--pos-space-2) 0 var(--pos-space-6)}
.pos-ui .pos-public .pricing-page,.pos-ui.pos-public .pricing-page{display:grid;gap:var(--pos-space-4)}
.pos-ui.pos-public .pricing-trial{display:flex;flex-direction:column;align-items:flex-start;gap:var(--pos-space-4);padding:var(--pos-space-5);border-radius:var(--pos-radius-xl);
 background:var(--pos-surface-card);border:1px solid var(--pos-border);box-shadow:var(--pos-shadow-card);border-top:3px solid var(--pos-accent)}
.pos-ui.pos-public .pricing-trial p{margin:0}
.pos-ui.pos-public .pricing-trial-title{font-family:var(--pos-font-display);font-size:var(--pos-text-xl);letter-spacing:-.02em;color:var(--pos-text-1)}
.pos-ui.pos-public .pricing-trial .muted{margin-top:var(--pos-space-2);font-size:var(--pos-text-md);color:var(--pos-text-2)}
.pos-ui.pos-public .pricing-cards{display:grid;gap:var(--pos-space-4)}
.pos-ui.pos-public .plan-card{display:flex;flex-direction:column;gap:var(--pos-space-3);padding:var(--pos-space-6);border-radius:var(--pos-radius-xl);background:var(--pos-surface-card);
 border:1px solid var(--pos-border);box-shadow:var(--pos-shadow-card)}
.pos-ui.pos-public .plan-card.plan-emphasis{border:1.5px solid var(--pos-accent);box-shadow:var(--pos-shadow-float)}
.pos-ui.pos-public .plan-head h3{font-size:var(--pos-text-xl);font-weight:var(--pos-weight-heavy);letter-spacing:-.02em}
.pos-ui.pos-public .plan-price{margin:0;display:flex;align-items:baseline;gap:6px;color:var(--pos-text-2)}
.pos-ui.pos-public .plan-price b{font-family:var(--pos-font-display);font-size:44px;font-weight:var(--pos-weight-heavy);letter-spacing:-.045em;line-height:1;color:var(--pos-text-1)}
.pos-ui.pos-public .plan-for{margin:0;color:var(--pos-text-2)}
.pos-ui.pos-public .plan-quotas,.pos-ui.pos-public .plan-points{list-style:none;margin:0;padding:0;display:grid;gap:var(--pos-space-2)}
.pos-ui.pos-public .plan-quotas{padding:var(--pos-space-3) 0;border-top:1px solid var(--pos-hairline);border-bottom:1px solid var(--pos-hairline)}
.pos-ui.pos-public .plan-quotas li,.pos-ui.pos-public .plan-points li{position:relative;padding-left:24px;color:var(--pos-text-1)}
.pos-ui.pos-public .plan-quotas li::before,.pos-ui.pos-public .plan-points li::before{content:'';position:absolute;left:2px;top:.45em;width:10px;height:6px;
 border-left:2px solid var(--pos-accent);border-bottom:2px solid var(--pos-accent);transform:rotate(-45deg)}
.pos-ui.pos-public .plan-points li{color:var(--pos-text-2);font-size:var(--pos-text-sm)}
.pos-ui.pos-public .plan-cta{margin-top:auto;padding-top:var(--pos-space-2)}
.pos-ui.pos-public .plan-cta .button,.pos-ui.pos-public .pricing-trial .primary{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;padding:var(--pos-space-2) var(--pos-space-5);
 border-radius:var(--pos-radius-md);border:1px solid var(--pos-border-strong);background:var(--pos-surface-card);color:var(--pos-text-1);font-weight:var(--pos-weight-semibold);
 font-size:var(--pos-text-md);text-decoration:none;text-align:center}
.pos-ui.pos-public .plan-cta .button:hover{background:var(--pos-surface-inset);color:var(--pos-text-1)}
.pos-ui.pos-public .plan-cta .button.primary,.pos-ui.pos-public .pricing-trial .primary{background:var(--pos-accent);border-color:transparent;color:var(--pos-on-accent);box-shadow:var(--pos-shadow-accent)}
.pos-ui.pos-public .plan-cta .button.primary:hover,.pos-ui.pos-public .pricing-trial .primary:hover{background:var(--pos-accent-hover);color:var(--pos-on-accent)}
.pos-ui.pos-public .pricing-team{margin:0;padding:var(--pos-space-4) var(--pos-space-5);border-radius:var(--pos-radius-lg);background:var(--pos-surface-card);border:1px solid var(--pos-border);color:var(--pos-text-2)}
.pos-ui.pos-public .pricing-team b{color:var(--pos-text-1)}
.pos-ui.pos-public .pricing-note{margin:0;font-size:var(--pos-text-sm);color:var(--pos-text-3)}

/* ── Legal pages: the text untouched, a calm reading layout ────────────────────────────────────────── */
.pos-ui .pos-public__legal-nav{display:flex;flex-wrap:wrap;gap:var(--pos-space-2);margin-top:var(--pos-space-5)}
.pos-ui.pos-public .pos-public__legal-nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 var(--pos-space-4);border-radius:var(--pos-radius-pill);
 border:1px solid var(--pos-border);background:var(--pos-surface-card);color:var(--pos-text-2);font-weight:var(--pos-weight-semibold);font-size:var(--pos-text-sm);text-decoration:none}
.pos-ui.pos-public .pos-public__legal-nav a:hover{border-color:var(--pos-accent);color:var(--pos-text-1)}
.pos-ui.pos-public .pos-public__legal-nav a[aria-current="page"]{background:var(--pos-accent-soft);border-color:var(--pos-accent);color:var(--pos-accent)}
.pos-ui .pos-public__toc{margin:0 0 var(--pos-space-5);padding:var(--pos-space-4) var(--pos-space-5);border-radius:var(--pos-radius-lg);background:var(--pos-surface-card);border:1px solid var(--pos-border)}
.pos-ui .pos-public__toc>summary{display:flex;align-items:center;min-height:44px;cursor:pointer;font-weight:var(--pos-weight-bold);color:var(--pos-text-1)}
.pos-ui .pos-public__toc ol{margin:var(--pos-space-2) 0 0;padding-left:20px;font-size:var(--pos-text-sm);line-height:1.5}
.pos-ui .pos-public__toc li{margin:0}
.pos-ui.pos-public .pos-public__toc a{display:block;padding:12px 0;line-height:1.35;color:var(--pos-text-2);text-decoration:none}
.pos-ui.pos-public .pos-public__toc a:hover{color:var(--pos-accent);text-decoration:underline}
.pos-ui .pos-public__legal{padding:var(--pos-space-5);border-radius:var(--pos-radius-xl);background:var(--pos-surface-card);border:1px solid var(--pos-border);box-shadow:var(--pos-shadow-card)}
.pos-ui .pos-public__legal>section+section{border-top:1px solid var(--pos-hairline);margin-top:var(--pos-space-6)}
.pos-ui .pos-public__legal h2{margin-top:var(--pos-space-6)}
.pos-ui .pos-public__legal>section:first-child>h2{margin-top:0}
.pos-ui.pos-public .pos-public__legal .missing{display:inline-block;padding:1px 8px;border-radius:var(--pos-radius-pill);background:var(--pos-status-verify-bg);color:var(--pos-status-verify-fg);font-weight:var(--pos-weight-bold);font-size:var(--pos-text-sm)}

/* ── Wider screens ──────────────────────────────────────────────────────────────────────────────────── */
@media (min-width:480px){.pos-ui.pos-public .pricing-trial .primary{width:auto}}
@media (min-width:768px){
 .pos-ui.pos-public{--pos-public-gutter:32px}
 .pos-ui .pos-public__hero{padding:var(--pos-space-10) 0 var(--pos-space-7)}
 .pos-ui.pos-public .pricing-trial{flex-direction:row;align-items:center;justify-content:space-between;padding:var(--pos-space-6)}
 .pos-ui.pos-public .pricing-trial .primary{flex-shrink:0}
 .pos-ui.pos-public .pricing-cards{grid-template-columns:repeat(2,minmax(0,1fr))}
 .pos-ui .pos-public__related-list{grid-template-columns:repeat(2,minmax(0,1fr))}
 .pos-ui .pos-public__footer-grid{grid-template-columns:minmax(0,.6fr) minmax(0,1.6fr) minmax(0,.8fr)}
 .pos-ui .pos-public__legal{padding:var(--pos-space-8)}
 .pos-ui .pos-public__cta-panel{padding:var(--pos-space-8)}
}
@media (min-width:1024px){.pos-ui.pos-public{--pos-public-gutter:40px}}

/* ── Accessibility fallbacks ────────────────────────────────────────────────────────────────────────── */
@media (prefers-reduced-motion:reduce){.pos-ui.pos-public .pos-pbtn{transition:none}}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.pos-ui .pos-public__top{background:var(--pos-glass-solid)}}
@media (prefers-reduced-transparency:reduce){.pos-ui .pos-public__top{background:var(--pos-glass-solid);-webkit-backdrop-filter:none;backdrop-filter:none}}
@media (prefers-contrast:more){
 .pos-ui.pos-public{--pos-border:var(--pos-border-strong);--pos-hairline:var(--pos-border-strong);--pos-text-3:var(--pos-text-2)}
 .pos-ui .pos-public__top{background:var(--pos-glass-solid);-webkit-backdrop-filter:none;backdrop-filter:none}
}
@media (forced-colors:active){
 .pos-ui.pos-public .pos-pbtn,.pos-ui .pos-public__menu>summary,.pos-ui.pos-public .pos-public__locale .locale-switch>*,.pos-ui.pos-public .plan-cta .button,.pos-ui.pos-public .pricing-trial .primary{border:1px solid ButtonText}
 .pos-ui .pos-public__card,.pos-ui .pos-public__legal,.pos-ui .pos-public__cta-panel,.pos-ui.pos-public .plan-card,.pos-ui.pos-public .pricing-trial,.pos-ui .pos-public__toc{border:1px solid CanvasText}
 .pos-ui.pos-public .pos-public__locale .locale-switch>.active,.pos-ui.pos-public .pos-public__legal-nav a[aria-current="page"]{outline:2px solid Highlight;outline-offset:-3px}
 .pos-ui.pos-public .plan-quotas li::before,.pos-ui.pos-public .plan-points li::before{border-color:CanvasText}
 .pos-ui.pos-public :focus-visible{outline-color:Highlight}
}
`;
