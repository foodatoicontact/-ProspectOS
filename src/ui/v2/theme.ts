// Light / Dark / System. The preference lives in localStorage (immediate display, ZF-UI0); a server-side profile copy is
// a later phase. The same rules run twice: as an inline script during HTML parsing (no flash before hydration) and in
// ThemeProvider after hydration — both come from this file so they cannot disagree.
export type ThemePreference='light'|'dark'|'system';
export type ResolvedTheme='light'|'dark';
export const THEME_STORAGE_KEY='pos-theme';
export const THEME_PREFERENCES:readonly ThemePreference[]=['light','dark','system'];
export const DEFAULT_THEME_PREFERENCE:ThemePreference='system';
export const DARK_QUERY='(prefers-color-scheme: dark)';

export function parseThemePreference(v:unknown):ThemePreference{
 return v==='light'||v==='dark'||v==='system'?v:DEFAULT_THEME_PREFERENCE;
}
export function resolveTheme(pref:ThemePreference,systemDark:boolean):ResolvedTheme{
 return pref==='system'?(systemDark?'dark':'light'):pref;
}
// Attributes set on the `.pos-ui` root. CSS reads data-theme; data-theme-pref is informative (tests, debugging).
export function themeAttributes(pref:ThemePreference,systemDark:boolean):{'data-theme':ResolvedTheme;'data-theme-pref':ThemePreference}{
 return {'data-theme':resolveTheme(pref,systemDark),'data-theme-pref':pref};
}
// Inline, ES5, self-contained: runs as the first child of the `.pos-ui` root, before any themed content is parsed.
// Every failure (storage blocked, no matchMedia) falls back to the CSS default, which already follows the device.
export function themeInitScript():string{
 return `(function(){try{var el=document.currentScript&&document.currentScript.parentElement;if(!el)return;var p=null;`
  +`try{p=window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}`
  +`if(p!=="light"&&p!=="dark"&&p!=="system")p=${JSON.stringify(DEFAULT_THEME_PREFERENCE)};`
  +`var d=p==="dark"||(p==="system"&&!!window.matchMedia&&window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches);`
  +`el.setAttribute("data-theme",d?"dark":"light");el.setAttribute("data-theme-pref",p)}catch(e){}})();`;
}
