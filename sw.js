// App-shell cache only. Desk data (GitHub Gist) is never cached here. No web push in plan B.
// Network-first for everything same-origin (bypassing the HTTP cache), cache only as offline fallback.
const VERSION = "3";
const CACHE = "desk-shell-v" + VERSION;
const SHELL = ["./", "index.html", "app.css?v=3", "app.js?v=3", "chart.js?v=3", "manifest.json",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, u = new URL(req.url);
  if (u.origin !== self.location.origin || req.method !== "GET") return; // data goes straight to network
  const nav = req.mode === "navigate";
  // navigate requests can't be re-wrapped with an init, so fetch by URL; always skip the HTTP cache
  const net = nav ? fetch(u.origin + u.pathname + u.search, { cache: "no-store", credentials: "same-origin" })
                  : fetch(new Request(req, { cache: "no-store" }));
  e.respondWith(net.then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(nav ? "index.html" : req, copy)); }
    return r;
  }).catch(() => caches.match(nav ? "index.html" : req).then(r => r || caches.match(req, { ignoreSearch: true }))
    .then(r => r || caches.match("index.html"))));
});
