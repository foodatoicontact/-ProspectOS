export type Locale='fr'|'en';
export const LOCALE_STORAGE_KEY='prospectos-locale';
// Existing users, and the very first render (server + pre-hydration client, where localStorage/
// navigator are unavailable), always see French — browser-language detection only ever applies once,
// client-side, and only to a visitor who has never made an explicit choice (see useLocale.ts).
export const DEFAULT_LOCALE:Locale='fr';
export function detectBrowserLocale(navigatorLanguage:string|undefined):Locale{
 if(!navigatorLanguage)return DEFAULT_LOCALE;
 return navigatorLanguage.toLowerCase().startsWith('fr')?'fr':'en';
}
