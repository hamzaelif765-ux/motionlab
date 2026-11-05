// MotionLab v4 service worker: network-first for the app page (always fresh), cache-first for models/CDN files.
const C='ml4-v1';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;
 const same=new URL(r.url).origin===location.origin;
 e.respondWith(caches.open(C).then(async c=>{const hit=await c.match(r);
  const net=fetch(r).then(x=>{if(x.ok||x.type==='opaque')c.put(r,x.clone());return x}).catch(()=>hit);
  return same?(net.then(x=>x||hit)):(hit||net)}))});
