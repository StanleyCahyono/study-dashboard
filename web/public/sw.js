/* Offline support: caches only this site's own files (the app itself).
 * Your study data is never here; it lives in the browser's local storage. */
const CACHE = "study-web-v1";
const SCOPE = new URL(self.registration.scope).pathname;
const SHELL = ["", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png"].map((p) => SCOPE + p);

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  const html = await (await cache.match(SCOPE)).text();
  const assets = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).pathname);
  await cache.addAll(assets);
}

self.addEventListener("install", (event) => event.waitUntil(precache().then(() => self.skipWaiting())));
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  ),
);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(SCOPE, copy));
          }
          return res;
        })
        .catch(() => caches.match(SCOPE, { ignoreVary: true })),
    );
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
