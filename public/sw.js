// ProspectOS — service worker (PWA, docs/PWA.md). Minimal on purpose:
//  * cache: the public pages, the application shell (/app, /) and the build's static files, so the app opens without a
//    network; NEVER an API answer (/api/…), a request carrying credentials, or a private page (cockpit, partner spaces,
//    private demo pages). No customer data is ever kept offline: the shell holds no data, the data comes from the API.
//  * push: shows the notification sent by ProspectOS (payload {kind,url} only) in the device's language; a click opens
//    the app on the link.
const VERSION='prospectos-sw-v1';
const SHELL=['/app','/','/icons/icon-192.png','/icons/icon-512.png'];
const PRIVATE=/^\/(api|cockpit|partenaires\/(espace|admin)|d)(\/|$)/;
const NOTIFY={
 fr:{
  DELIVERY:{title:'Nouvelle livraison de veille',body:'Votre nouvelle liste d’entreprises est prête dans ProspectOS.'},
  SIGNALS:{title:'Nouveaux signaux',body:'De nouveaux signaux sont à vérifier sur vos prospects surveillés.'},
  TRIAL_ENDED:{title:'Votre essai est terminé',body:'Choisissez une offre pour continuer à utiliser ProspectOS.'},
 },
 en:{
  DELIVERY:{title:'New watch delivery',body:'Your new list of companies is ready in ProspectOS.'},
  SIGNALS:{title:'New signals',body:'New signals are waiting for review on the prospects you monitor.'},
  TRIAL_ENDED:{title:'Your trial has ended',body:'Choose a plan to keep using ProspectOS.'},
 },
};

self.addEventListener('install',event=>{
 event.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

function cacheable(request,url){
 return request.method==='GET'&&url.origin===self.location.origin&&!PRIVATE.test(url.pathname)&&!request.headers.has('authorization');
}
self.addEventListener('fetch',event=>{
 const request=event.request;const url=new URL(request.url);
 if(!cacheable(request,url))return;
 // The build's files never change under the same name: cache first.
 if(url.pathname.startsWith('/_next/static/')){
  event.respondWith(caches.match(request).then(hit=>hit||fetch(request).then(res=>{
   if(res.ok){const copy=res.clone();caches.open(VERSION).then(c=>c.put(request,copy))}return res})));
  return;
 }
 // Pages: the network first (always the latest page), the cached copy when offline; a page never seen offline falls back
 // to the application shell. Only plain HTML answers are kept, without query string.
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).then(res=>{
   if(res.ok&&!url.search&&(res.headers.get('content-type')||'').includes('text/html')){const copy=res.clone();caches.open(VERSION).then(c=>c.put(url.pathname,copy))}
   return res;
  }).catch(()=>caches.match(url.pathname).then(hit=>hit||caches.match('/app'))));
  return;
 }
 if(url.pathname.startsWith('/icons/')){
  event.respondWith(caches.match(request).then(hit=>hit||fetch(request)));
 }
});

self.addEventListener('push',event=>{
 let data={};try{data=event.data?event.data.json():{}}catch(e){data={}}
 const lang=(self.navigator&&self.navigator.language||'fr').toLowerCase().startsWith('fr')?'fr':'en';
 const text=NOTIFY[lang][data.kind];
 if(!text)return;
 const url=typeof data.url==='string'&&data.url.startsWith('/')?data.url:'/app';
 event.waitUntil(self.registration.showNotification(text.title,{body:text.body,icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',tag:data.kind,data:{url}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=(event.notification.data&&event.notification.data.url)||'/app';
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
  for(const c of list){if(new URL(c.url).origin===self.location.origin&&'focus' in c){c.navigate(url);return c.focus()}}
  return self.clients.openWindow(url);
 }));
});
