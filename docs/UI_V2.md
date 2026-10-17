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

## Notes for UI-2 / UI-3

- Mounting v2 in the app means moving the token `<style>`, `foundations.css` and `ThemeProvider` to where the shell
  renders, still behind `UI_V2_ENABLED` (decided per request, like `/api/public/ux-config`; never in the static layout).
- UI-3 copy: the secondary card action is **« Voir pourquoi »** (not « Pourquoi ? »).
- UI-3 desktop card: avoid over-wide horizontal cards — keep the action close to the content within the 760 px reading
  width.
