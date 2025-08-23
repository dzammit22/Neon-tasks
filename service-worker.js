// Simple offline cache for NEON/TASKS
const CACHE = "neon-tasks-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/Cyberpunk App.csv" // optional; if missing fetch will fail silently
];

self.addEventListener("install", (e)=>{
  e.waitUntil(
    caches.open(CACHE).then(c=> c.addAll(ASSETS.filter(Boolean))).then(()=> self.skipWaiting())
  );
});
self.addEventListener("activate", (e)=>{
  e.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))) 
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e)=>{
  const req = e.request;
  if(req.method !== "GET") return;
  e.respondWith(
    caches.match(req).then(cached=>{
      const fetchPromise = fetch(req).then(res=>{
        const copy = res.clone();
        caches.open(CACHE).then(c=> c.put(req, copy)).catch(()=>{});
        return res;
      }).catch(()=> cached || new Response("Offline", {status:200}));
      return cached || fetchPromise;
    })
  );
});