// sw.js (compatível com GitHub Pages + teu sistema atual)
const CACHE_VERSION = "gf-v1.0.9"; // MUDA este valor sempre que fizeres update

const APP_SHELL = [
  "/DC-gestao1/",
  "/DC-gestao1/index.html",
  "/DC-gestao1/script.js",
  "/DC-gestao1/manifest.webmanifest",
  "/DC-gestao1/icons/icon-192.png",
  "/DC-gestao1/icons/icon-512.png"
];


self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : null)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // só GET (evita interferir com requests especiais)
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // só cacheia o que é do teu domínio (não mexe no Supabase)
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  const isHTML =
    req.mode === "navigate" ||
    path.endsWith("/index.html") ||
    path.endsWith("/");

  const isJS = path.endsWith("/script.js");

  // ✅ NETWORK-FIRST para HTML e JS (evita ficar preso em versão velha)
  if (isHTML || isJS) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // ✅ CACHE-FIRST para o resto (css, icons, etc.)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        return res;
      });
    })
  );
});
