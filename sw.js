'use strict';
const CACHE='ceen2-v55';
const PRECACHE=['./','./index.html','./manifest.webmanifest','./global-catalog.json','./recipes-global.json','./checklists.css','./checklists-data.js','./checklists-store.js','./checklists-backup.js','./checklists-view.js','./checklists-actions.js','./checklists-library.js','./checklists-editor-ui.js','./checklists-manage.js','./tasks-global.json','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('ceen2-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request.url,{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('Navigation failed');event.waitUntil(caches.open(CACHE).then(cache=>Promise.all(PRECACHE.map(entry=>cache.match(entry))).then(entries=>{if(entries.some(entry=>!entry))return cache.addAll(PRECACHE);})).catch(()=>{}));return caches.open(CACHE).then(cache=>cache.put('./index.html',response.clone())).then(()=>response);}).catch(()=>caches.match('./index.html')));
 }else{
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(!response.ok)return response;return caches.open(CACHE).then(cache=>cache.put(request,response.clone())).then(()=>response);})));
 }
});
