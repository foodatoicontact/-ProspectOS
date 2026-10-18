# ProspectOS 2.0 — UI v2

Reference: ZF-UI0 (design architecture) and the validated V2 visual prototype. This file covers **UI-1 Fondations**;
later phases (UI-2 shell, UI-3 Today 2.0, …) add their own sections.

## Flag and activation

- `UI_V2_ENABLED` — server-side, read **per request** (`src/ui/v2/flag.ts`). OFF unless `"true"`/`"1"`.
  Hard OFF when the runtime reports `VERCEL_ENV=production`; because Production does not always expose `VERCEL_ENV`
  (P0 debt, `docs/ZERO_FRICTION.md`), the variable must only ever be set on **Preview**.
- UI-1 has one surface: **`/ui-v2`**, a bench page for the foundations (no data, no API call, no analytics).
  Flag OFF → the same 404 as any unknown URL. `robots: noindex, nofollow`; not in the sitemap.
- With the flag OFF, nothing else changes: the root layout, `globals.css`, `/` (`app/page.tsx`) and `TodayPanel` do not
  import, load or reference the v2 layer. The v2 CSS is a separate chunk loaded only by `/ui-v2`.

## Tokens (`src/ui/v2/tokens.ts`)

Single source of truth, three layers:

1. **Palette** — the only literal colours of the v2 UI (indigo, violet, cyan, green, amber, slate, rose, ink, mist, night, frost).
2. **Semantic roles per theme** (`light`, `dark`, same keys): `bg`, surfaces (`surface-shell|drawer|sheet|card|inset|muted`),
   `glass`, `glass-solid`, `glass-border`, borders, `text-1|2|3`, `accent*`, `ai`, `signal*`, and for each status
   (`contact`, `verify`, `engage`, `watch`, `excluded`, `verified`, `declared`) a `-fg`, `-bg`, `-dot`. Effects: shadows,
   glass highlight, signal glow, logo mark, halos. Alpha variants are **derived** (`alpha(palette.x, a)`), never typed.
3. **Scales** — space (4 px), radius, fonts, type sizes, weights, durations/easings, blur, sizes (44 px target, 760 px
   reading width, 448 px drawer), z-index.

`tokensCss()` emits CSS custom properties `--pos-*` scoped to `.pos-ui` (dark via `[data-theme="dark"]`; when no script
ran, `prefers-color-scheme` decides). The `/ui-v2` layout injects it with React's hoisted `<style precedence>`.

Colour semantics (ZF-UI0): indigo = primary action, focus, active; violet = AI only; cyan = signal and sourced data;
green = CONTACT only; amber = to verify; blue-grey = watch/wait; rose = excluded/error. A status is never colour alone.

UI-1 adjustment 1 — Light: base `#EEF2F8` (lighter and cooler than the prototype's `#E4E8F4`); the colour comes from the
halos. Contrast checks led to slightly deeper light `text-3`, `signal` and contact text than the prototype.

### Contrast (tested)

`tests/ui-v2-foundations.test.ts` measures WCAG 2.x ratios, **on the worst background**: translucent surfaces are
composited over the base colour and over each halo at its peak. Text 1–3 ≥ 4.5:1 on every surface; signal ≥ 4.5:1;
accent ≥ 3:1 as UI (focus ring) and ≥ 4.5:1 as text on cards; every badge label ≥ 4.5:1 on its fill; button label on
primary ≥ 4.5:1 — in both themes.

## Theme: Light / Dark / System without flash (`theme.ts`, `ThemeProvider.tsx`)

- Preference in `localStorage["pos-theme"]` (`light|dark|system`, default `system`). Server-side profile copy: later.
- An inline ES5 script, first child of the `.pos-ui` root, sets `data-theme`/`data-theme-pref` **during HTML parsing**
  (works even if no JS bundle loads). The provider re-applies in `useLayoutEffect` (soft navigations, dev remount),
  follows the device live in System mode and syncs other tabs (`storage` event).
- React never renders `data-theme`: server HTML, hydration and first paint always agree. `<html>` is not modified;
  `html:has(.pos-ui[data-theme=…])` themes overscroll and scrollbars.
- `ThemeSwitcher` (Clair / Sombre / Système) is the control UI-2 puts in the account menu.

## Primitives

| File | Exports | Contract |
|---|---|---|
| `primitives.tsx` | `Icon` | 24 grid, single stroke; `aria-hidden` unless `label` given |
| | `Button` | `primary` (one per decision), `secondary`, `quiet`, `danger`; `sm/md/lg` all ≥ 44 px hit area; `loading` → `aria-busy`, disabled, no layout shift; `type="button"` default |
| | `StatusBadge` | label + icon + tone; `declared` (dashed, person icon, neutral) never looks like `verified` |
| | `Chip`, `ChipGroup` | toggle `aria-pressed`; group `role="group"` + label; `segmented` = one line, scrolls in itself at 320 px |
| `panels.tsx` | `Sheet` | native modal `<dialog>`: top layer, inert page, Tab wraps inside, Esc / scrim / drag-down close, focus returns to the opener, safe-area padding |
| | `ContextDrawer` | non-modal panel inside the workspace (448 px): focus to its title on open, Esc closes, focus returns; no focus trap (the list stays reachable) |
| | `ContextPanel`, `useIsDesktop` | drawer ≥ 1024 px, sheet below — same content |
| `status.ts` | `STATUS_META`, `statusForSection` | Today section → badge (WATCH never shown as CONTACT) |
| `icons.ts` | `ICONS`, `IconName` | navigation, meaning (signal, ai, statuses), actions, theme |

## Accessibility and fallbacks (`foundations.css`)

- Focus ring 2 px accent, offset 2 px, never removed. Targets ≥ 44 px.
- `prefers-reduced-motion`: fades only, ≤ 120 ms, no displacement; Sheet closes without exit animation; spinner static.
- `prefers-reduced-transparency` and no `backdrop-filter` support: glass, drawer and sheet become opaque (`glass-solid`).
- `prefers-contrast: more`: opaque surfaces, strong borders, `text-3` → `text-2`.
- `forced-colors`: system colours, visible boundaries, pressed chip outlined in `Highlight`.
- Halos are static. Every rule is scoped `.pos-ui …` (specificity 0,2,0 beats the legacy element rules without `!important`).

## Verification (UI-1)

- `npm test` (1930 + UI-1 tests), `tsc`, `next build`: `/` stays static, `/ui-v2` dynamic.
- Flag-OFF parity: the 16 prerendered pages of this branch are byte-identical to `main` 4af8af6 once build hashes are
  normalised, and `/` loads the same CSS file (same content hash).
- Browser (Playwright, local build): no flash with JS bundles blocked (5 storage/device combinations), hydration without
  errors, persistence, Sheet/Drawer keyboard behaviour, adaptive panel at 1440/390, reduced motion, 320 px without
  horizontal scroll, forced colours, flag OFF → 404.

## UI-2 — App shell

**Activation.** `app/page.tsx` asks `GET /api/public/ui-v2` (dynamic, `no-store`, `{enabled:boolean}`) once on load. Only
when it answers `true` does it `import()` the shell (`src/ui/v2/shell/AppShell.tsx`, with `foundations.css` and
`shell.css`). Otherwise the page renders exactly as before: same DOM (verified against `main` on 12 states, demo
mode, 390 and 1440 px), same CSS file for `/`. **The real Production guard is the absence of `UI_V2_ENABLED` there**:
the runtime does not reliably expose `VERCEL_ENV` (P0 debt), so the `VERCEL_ENV==="production"` check in `flag.ts` is
defence in depth only.

**Layouts.** ≤ 640 px and 641–1023 px: fixed TopBar (`ProspectOS · [Projet ▼] · [Avatar]`, safe-area top) and fixed
BottomNav (Aujourd’hui · Prospects · Recherche · Activité, safe-area bottom); the tablet range only adds margin around
the workspace. ≥ 1024 px: SideNav (project on top; 4 primary entries; Sources, Paramètres; account at the bottom) and the
workspace. Removed from the v2 envelope: legacy sidebar, breadcrumb, "Espace connecté" pill, marketing page titles,
global Export CSV / Add prospect (now actions of the Prospects entry), "Vous gardez la main" box.

**Navigation → existing screens** (`src/ui/v2/shell/nav.ts`, no new screen):

| Entry | Screen |
|---|---|
| Aujourd’hui | ZF1 Today if enabled; else NBA "À faire"; else the prospects list (demo) |
| Prospects | prospects list / detail |
| Recherche | Discovery (same history behaviour as "Trouver des prospects") |
| Activité | "À faire" when Today exists (advanced mode); else the overview |
| Sources | Discovery (its source choice is the only sources screen that exists) |
| Paramètres | Offer & ICP |

Two entries leading to the same screen: the one chosen stays `aria-current`. Without a project, Recherche/Sources open
the existing project creation. A v2 session opens on Aujourd’hui (or its closest screen).

**Account menu** (Sheet on mobile, Popover on desktop): Compte, Organisation et équipe, Données et confidentialité
(the existing account dialog, scrolled to the part), Offre et cible, Sources, Langue, Thème (UI-1 ThemeSwitcher),
Se déconnecter; Bêta Analytics only for an INTERNAL plan. Demo: Offre et cible, Sources, Langue, Thème,
Réinitialiser / Quitter la démo.

**Existing screens inside the shell.** Rendered unchanged in `.pos-legacy`: their own paper, ink, type and focus in
every theme (the base rules of `foundations.css` skip `.pos-legacy`). In the dark theme the shell is dark and the
screens stay light until UI-3 / UI-5 migrate them. Legacy dialogs (account, project, prospect, pricing…) are rendered
outside the shell, unchanged.

**Tests.** `tests/ui-v2-shell.test.ts` (navigation model, flag route, flag-OFF parity of `page.tsx`, accessibility
contracts, styles). Browser checks (Playwright, local build, demo mode): mobile and desktop navigation, project
switching and creation, account menu, theme switch and persistence, language, keyboard, Esc / focus return, sign-out,
320 px, tablet, reduced motion, forced colours; DOM parity with `main` when the flag is off.

## UI-3 — Today 2.0

**Gate.** Rendered by the v2 shell (`screen` slot) only when `UI_V2_ENABLED` (shell loaded) **and**
`ZERO_FRICTION_TODAY_ENABLED` (live account, `zfOn`) are on; otherwise the legacy `TodayPanel` is unchanged. Code:
`src/ui/v2/today/` (`model.ts`, `TodayV2.tsx`, `today.css`), loaded with the shell's dynamic import.

**Data.** Same calls as `TodayPanel` (`ensure-fresh` then `home`, recomputation only when stale or after a data change),
same ZF1 model (`buildTodayModel` / `cardOf`), same engine order (sections contact → verify → engage → watch, engine
ranking inside). WAIT / DISMISS never take a card. No change to the NBA engine, scores or thresholds.

**Level 1 card** (in this order): company · signal (cyan dot + TYPE, then place · age) · status badge · one short
explanation (+ how many pieces of information are missing) · one action · "Voir pourquoi". Summary = compact filter
chips `n à contacter · n à vérifier · n en veille` (ZF1.1 counts), not KPI cards.

**Colours.** Indigo = primary action; green = CONTACT only ("Préparer le message", `--pos-action-contact`, badge);
amber = to verify; blue-grey = watch; cyan = signal.

**Actions (ZF1.1).** CONTACT → Préparer le message (record); ENGAGE → Voir la conversation (record); WATCH + signal not
reviewed → Vérifier le signal (panel: source, confirm / reject → existing `signals/{id}/review`); WATCH + FIT incomplete
→ Compléter les informations (panel); WATCH with nothing to do → "aucune action nécessaire".

**Level 2** ("Voir pourquoi", Sheet on mobile / ContextDrawer on desktop): signal, source (link), freshness (age), place,
what the source says, favourable criteria (verified), missing information — never a score. **Level 3** ("Détails
avancés", inside level 2): scores (opportunity, FIT, coverage, INTENT, TIMING, freshness, evidence quality), rule,
evidence states (signal, FIT profile, FIT basis), statements with their provenance, raw place.

**Completion.** Lists what is verified and what is missing, explains that information counts once a source documents
it, and opens the company record to add evidence with the existing workflow. "Déclarer une information sans source" is
shown disabled: "Cette option sera disponible prochainement." No migration, no Evidence change, no DECLARED status
(USER_DECLARED is UI-4).

**Observability.** New `ZF_WHY_OPENED` (level 2). `ZF_ADVANCED_DETAILS_OPENED` is emitted from level 3 only. ZF event
payloads now carry `project_id` (the organization stays the row column). The legacy TodayPanel is unchanged.

**Bench.** `/ui-v2/today?set=canary|all|empty` (404 unless `UI_V2_ENABLED`): Today 2.0 in the real shell with frozen
NBA rows (the 3 stored 6XPOS recommendations; synthetic rows for the other actions), events listed instead of sent.

## UI-5A — Prospects 2.0

`src/ui/v2/prospects/` (`ProspectsV2.tsx`, `model.ts`, `prospects.css`), rendered by the v2 shell for the Prospects entry
when `UI_V2_ENABLED` is on (outside the quick start). Flag off, `app/page.tsx` renders the legacy list and record unchanged
(`tests/ui-v2-prospects.test.ts` compares that markup with main byte for byte). The legacy code stays until UI-5C.

**Same data, same handlers.** The list receives the legacy `visible` array (same search, status filter and order). The
record calls the legacy functions (status, evidence, verification, channels, analysis, message: prepare / save / approve /
copy) and opens the legacy dialogs. The panels that load data themselves (observations, signals, public content, writing
style, feedback) are the same components with the same props, in a v2-themed island (`.pos-island`). Export and add are
actions of the screen itself, no longer of the envelope. Nothing is sent: a person prepares, approves and copies a message.

**List.** Each row has the name, the place (or "Localisation à confirmer"), the human status, and the FIT said in words:
Vérifié, Estimé or À documenter, with what is left ("1 source à vérifier", "déclaré par vous"). There is never a /100. On
mobile each row is a touch card; from 641 px rows are dense, one line each. Keyboard: ↑ / ↓ move between rows, Enter opens.

**Record.** The record goes company → situation (one sentence) → signals and context → evidence by criterion → message →
commercial status and channels → session history → "Détails avancés", which is closed by default and is the only place
with scores (FIT, coverage, INTENT). Evidence keeps three bases apart:
- VERIFIED is a proof (green check, source link);
- USER_DECLARED is "Déclaré par vous": person icon, slate colour, dashed border, never green, no source;
- NOT_VERIFIED / INFERRED are to check (amber), with "J’ai vérifié la source : valider".

**Navigation.** The legacy screen always selects a prospect; v2 shows the list until a record is opened (from the list,
Today, To do, Search, or after adding one). "Retour aux prospects" brings the list back and focuses the row. Opening
another record starts without the previous record's draft.

**Bench.** `/ui-v2/prospects` (Preview, same flag): the real screen and panels (demo mode) with frozen data. The browser
was checked with Playwright: 320 px, 390 px dark, 1440 px, keyboard, reduced motion, actions.

## UI-5B — Recherche 2.0

`src/ui/v2/search/` (`SearchV2.tsx`, `search.css`), rendered by the v2 shell for the Recherche entry when `UI_V2_ENABLED`
is on. Flag off, `app/page.tsx` renders the legacy Discovery screen unchanged (`tests/ui-v2-search.test.ts` compares
everything before the v2 branch, and the legacy return, with main byte for byte).

**What it is.** The v2 envelope of the search: the title "Recherche", its purpose in one sentence (each result is to be
checked at its source before it becomes a prospect), the notice and paywall banners, and the existing `DiscoveryPanel`.
The panel is the same element with the same props as on the legacy screen, mounted once. That covers the form,
providers, runs, quotas, novelty, review priority, add / ignore, history and replay. It is restyled with tokens only
(`.pos-ui .pos-search`), in light and dark. Its markup, its responsive grid and its logic are unchanged.

**What does not change.** Nothing in `src/components/DiscoveryPanel.tsx`, `src/discovery/**`, the providers, scoring,
quotas, NBA / ZF, Stripe or pricing. Every state stays written (Candidat, Nouveau, Ajouté…), never shown by colour alone.

**Limit.** The panel's form and results are restyled, not rewritten. Rewriting them natively means extracting
DiscoveryPanel's logic (runs, polling, add / ignore, history) out of its markup. That is a refactor of the Discovery
screen, outside this phase.

**Bench.** `/ui-v2/search` (Preview, same flag): the real panel in demo mode (synthetic TEST companies, local storage
only, no network). The browser was checked with Playwright at 320 px, 390 px dark and 1440 px light and dark (run, add,
ignore, history).

## WEB-1 / WEB-2 — Public site 2.0

**One flag, chosen at build time.** `NEXT_PUBLIC_WEB_V2_ENABLED` ("1"/"true", `src/ui/v2/public/flag.ts`) covers the whole public
site: `/`, `/tarifs`, `/a-propos`, the SEO pages and the legal pages.
- **Why build time.** Next inlines the flag into the server render and the browser bundle, so the version of a page is decided
  before its first paint. There is no fetch and no swap; WEB-1's runtime endpoint `/api/public/web-v2-home` is removed.
- **Changing it.** It needs a redeploy, by design.
- **Rename.** WEB-1's `WEB_V2_HOME_ENABLED` was never merged and only existed on the branch Preview, so it was renamed cleanly.
  The `NEXT_PUBLIC_` prefix is what makes the browser bundle see the same value.
- **Where it is set.** Only on the Preview of `feat/web-v2-home`. Production has no such variable.

**Three envelopes, one look.**
- **Homepage.** `app/page.tsx` renders `HomeV2` through `next/dynamic` (server-rendered, so its CSS is linked in the HTML), and
  only in a build with the flag.
- **SEO pages, `/tarifs` and `/a-propos`.** `PublicSeoPage` renders `SeoPageV2`.
- **Legal pages.** `LegalPage` renders `LegalPageV2`.

All three use `PublicSiteShell`, `PublicHeader`, `PublicFooter`, `PublicHero`, `PublicSection`, `PublicCard` and `PublicCTA`
(`src/ui/v2/public/PublicSite.tsx`).
- **Header.** ProspectOS · Tarifs · FR | EN · Me connecter. On phones, Tarifs and the language go into a native `<details>`
  menu. On the French-only server pages, EN leads to `/?lang=en`, and "Me connecter" leads to `/#connexion` (the existing
  sign-in tab of the homepage card).
- **Footer.** Every content page, the legal pages and contact.
- **Styles.** The public styles (`styles.ts`) and the tokens are inlined as `<style>` elements by the shell, never imported as
  CSS. That is why a page built without the flag keeps exactly main's stylesheets. Tokens only, scoped to `.pos-ui.pos-public`.
  The bare-element rules of `globals.css` (`footer`, `h1`/`h2` margins, `small`) are neutralised there.

**What does not change.**
- **Text, prices and data.** The SEO texts (`seo-content.ts`), the legal pages, prices, quotas, trial, plans, i18n and demo
  data are main's. `tests/web-v2-site.test.ts` pins their hashes.
- **SEO pages.** H1, H2, H3, blocks, FAQ (every answer stays visible), call to action, related links and JSON-LD are the same
  nodes in new components. Metadata comes from the unchanged `generateMetadata` / `metadata` exports.
- **Legal pages.** The page's own `<section>`s are rendered as written. Each one only gets an `id`, so that a table of contents
  derived from its `<h2>` can link to it.
- **Flag off.** Every public route serves main's HTML, CSS and scripts.

**Known and out of scope.**
- **Demo.** "Voir une démonstration sans compte" opens the application in demo mode (the legacy app, or the UI-2 shell when
  `UI_V2_ENABLED`). Its data names real restaurants; changing them is a product decision, not a restyle.
- **Language.** The SEO and legal pages exist in French only.

## Notes for UI-2 / UI-3

- Mounting v2 in the app means moving the token `<style>`, `foundations.css` and `ThemeProvider` to where the shell
  renders, still behind `UI_V2_ENABLED` (decided per request, like `/api/public/ux-config`; never in the static layout).
- UI-3: done ("Voir pourquoi", 720 px reading column, actions right under the content).
