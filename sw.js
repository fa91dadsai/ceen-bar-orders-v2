'use strict';
const CACHE='ceen2-v1';
const PRECACHE=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('ceen2-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).then(response=>{if(!response.ok)throw new Error('Navigation failed');event.waitUntil(caches.open(CACHE).then(cache=>Promise.all(PRECACHE.map(entry=>cache.match(entry))).then(entries=>{if(entries.some(entry=>!entry))return cache.addAll(PRECACHE);})).catch(()=>{}));return caches.open(CACHE).then(cache=>cache.put('./index.html',response.clone())).then(()=>response);}).catch(()=>caches.match('./index.html')));
 }else{
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(!response.ok)return response;return caches.open(CACHE).then(cache=>cache.put(request,response.clone())).then(()=>response);})));
 }
});
