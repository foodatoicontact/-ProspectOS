'use client';
// Recherche 2.0 (UI-5B, docs/UI_V2.md) — the v2 "Recherche" entry. Rendered by the v2 shell only (UI_V2_ENABLED); flag
// OFF, app/page.tsx renders the legacy Discovery screen exactly as before.
// The search itself — form, providers, runs, quotas, novelty, review priority, add / ignore, history, replay — is the
// existing DiscoveryPanel, passed in by app/page.tsx with the very props of the legacy screen plus `view`: its state and
// actions composed natively by SearchNative.tsx. Nothing here calls the API, starts a search or decides.
import type {ReactNode} from 'react';
import './search.css';
import type {Locale} from '../../../i18n/locale.ts';
import {Button,Icon} from '../primitives.tsx';

export const SEARCH_TEXT:Record<Locale,{title:string;intro:string;dismiss:string}>={
 fr:{title:'Recherche',intro:'Trouvez des entreprises qui correspondent à votre cible. Chaque résultat reste à vérifier à la source avant de devenir un prospect.',
  dismiss:'Fermer le message'},
 en:{title:'Search',intro:'Find companies that match your target. Every result is to be checked at its source before it becomes a prospect.',
  dismiss:'Dismiss message'},
};

export type SearchV2Props={locale:Locale;
 top:ReactNode;notice:string;onDismissNotice:()=>void;paywall:{text:string;action:string;onAction:()=>void;onDismiss:()=>void}|null;
 // The legacy DiscoveryPanel element, with the legacy props and view={SearchNative}.
 panel:ReactNode};

export function SearchV2(p:SearchV2Props){
 const t=SEARCH_TEXT[p.locale];
 return <div className="pos-search" data-testid="search-v2">
  <div className="pos-search__main">
   {p.top}
   {p.paywall&&<div className="pos-banner pos-banner--verify" role="status"><p>{p.paywall.text}</p>
    <Button variant="primary" size="sm" onClick={p.paywall.onAction}>{p.paywall.action}</Button>
    <Button variant="quiet" size="sm" aria-label={t.dismiss} onClick={p.paywall.onDismiss}><Icon name="close" size={16}/></Button></div>}
   {p.notice&&<div className="pos-banner" role="status"><p>{p.notice}</p>
    <Button variant="quiet" size="sm" aria-label={t.dismiss} onClick={p.onDismissNotice}><Icon name="close" size={16}/></Button></div>}
   <header className="pos-search__head">
    <h2 className="pos-search__title">{t.title}</h2>
    <p className="pos-search__intro">{t.intro}</p>
   </header>
   {p.panel}
  </div>
 </div>;
}
