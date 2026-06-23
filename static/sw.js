// TomOS service worker — network-first so every deploy shows up immediately.
// The cache is only an offline fallback for the app shell. (Earlier versions
// were cache-first, which made new deploys appear stale — bad for fast iteration.)
const CACHE = "tomos-v9";
const SHELL = ["/", "/static/styles.css", "/static/app.js", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const cacheable =
    url.pathname === "/" || url.pathname === "/manifest.json" || url.pathname.startsWith("/static");

  // Network-first everywhere; fall back to cache only when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (cacheable) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
