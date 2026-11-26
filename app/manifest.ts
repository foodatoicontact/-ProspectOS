import type {MetadataRoute} from 'next';
// ProspectOS installable (PWA, docs/PWA.md): the web app manifest. Same icons as the favicon (app/icon.png, resized; the
// maskable ones on the icon's own green), standalone display, opening on /app — the application, not the homepage.
export const THEME_COLOR='#236c53';
export default function manifest():MetadataRoute.Manifest{
 return {
  id:'/app',
  name:'ProspectOS',
  short_name:'ProspectOS',
  description:'Prospection B2B fondée sur les preuves : vos prospects, leurs signaux et vos livraisons de veille.',
  lang:'fr',
  dir:'ltr',
  start_url:'/app',
  scope:'/',
  display:'standalone',
  orientation:'portrait',
  theme_color:THEME_COLOR,
  background_color:'#f6f7f4',
  categories:['business','productivity'],
  icons:[
   {src:'/icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
   {src:'/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
   {src:'/icons/maskable-192.png',sizes:'192x192',type:'image/png',purpose:'maskable'},
   {src:'/icons/maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
  ],
 };
}
