/**
 * ESSENTIALS public site — installable app shell.
 *
 * Page navigations are network-first so a deploy is picked up immediately, with
 * the cached shell as the offline fallback. Hashed build assets are cache-first
 * because their filenames change on every release. API and auth traffic is never
 * cached: those responses can carry personal data.
 */
const CACHE = "essentials-site-v1";
const PRECACHE = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never put API responses, auth callbacks, or uploaded media in the app cache.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(async () => {
          const shell = await caches.match("/");
          if (shell) return shell;
          return (await caches.match("/offline.html")) ?? Response.error();
        }),
    );
    return;
  }

  if (/\.(?:js|css|png|svg|jpg|jpeg|webp|gif|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});
