// TomOS service worker — app-shell cache so the PWA opens instantly and
// survives a flaky connection. API calls always go to the network (no stale
// to-dos/email), falling back to cache only when offline.
const CACHE = "tomos-v1";
const SHELL = [
  "/",
  "/static/styles.css",
  "/static/app.js",
  "/static/icon-192.png",
  "/static/icon-512.png",
  "/manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isApi = ["/todos", "/calendar", "/emails", "/refresh", "/briefing", "/health"].some(
    (p) => url.pathname.startsWith(p)
  );

  if (isApi) {
    // Network-first for live data.
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
  } else {
    // Cache-first for the static shell.
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});
