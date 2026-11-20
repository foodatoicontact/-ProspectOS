// Web presence diagnostic (web-presence.ts): its observation types and card titles, with no dependency, so the
// evidence review in the browser can read them without pulling cheerio or node:crypto into the client bundle.
export const WEB_PRESENCE_TYPES=[
 'WEB_AGENCY_CREDIT','WEB_CMS','WEB_COPYRIGHT_OLD','WEB_NO_HTTPS','WEB_NO_MOBILE_VIEWPORT',
 'WEB_QUOTE_REQUEST_FOUND','WEB_NO_QUOTE_REQUEST_SEEN','WEB_ONLINE_BOOKING_FOUND','WEB_NO_ONLINE_BOOKING_SEEN',
] as const;
export type WebPresenceType=typeof WEB_PRESENCE_TYPES[number];
export function isWebPresenceType(type:string):type is WebPresenceType{return (WEB_PRESENCE_TYPES as readonly string[]).includes(type)}

// Card titles in the evidence review. A local dictionary: the shared i18n files are frozen.
const TITLES:Record<'fr'|'en',Record<WebPresenceType,string>>={
 fr:{WEB_AGENCY_CREDIT:'Site : prestataire crédité',WEB_CMS:'Site : outil de création',WEB_COPYRIGHT_OLD:'Site : copyright ancien',WEB_NO_HTTPS:'Site : sans HTTPS',
  WEB_NO_MOBILE_VIEWPORT:'Site : mobile non déclaré',WEB_QUOTE_REQUEST_FOUND:'Site : demande de devis en ligne',WEB_NO_QUOTE_REQUEST_SEEN:'Site : pas de devis en ligne repéré',
  WEB_ONLINE_BOOKING_FOUND:'Site : rendez-vous en ligne',WEB_NO_ONLINE_BOOKING_SEEN:'Site : pas de rendez-vous en ligne repéré'},
 en:{WEB_AGENCY_CREDIT:'Website: credited provider',WEB_CMS:'Website: built with',WEB_COPYRIGHT_OLD:'Website: old copyright',WEB_NO_HTTPS:'Website: no HTTPS',
  WEB_NO_MOBILE_VIEWPORT:'Website: no mobile viewport',WEB_QUOTE_REQUEST_FOUND:'Website: online quote request',WEB_NO_QUOTE_REQUEST_SEEN:'Website: no online quote seen',
  WEB_ONLINE_BOOKING_FOUND:'Website: online booking',WEB_NO_ONLINE_BOOKING_SEEN:'Website: no online booking seen'},
};
export function webPresenceTitle(type:WebPresenceType,locale:'fr'|'en'):string{return TITLES[locale][type]}
export const WEB_PRESENCE_NOTE_EN='Website diagnostic: context only, never counted in the score. Check it on the source.';
// Title of the folded section that groups these facts in the evidence review: neutral, for every trade.
export const WEB_PRESENCE_SECTION:Record<'fr'|'en',string>={fr:'Site web : diagnostic technique (pour information)',en:'Website: technical check (for information)'};
