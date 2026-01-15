/* sw.js — Gestão Fácil */
const CACHE_VERSION = "gf-v1.0.7"; // MUDA sempre que atualizares

const APP_SHELL = [
  "./",
  "./index.html",
  "./script.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : null)))
      ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // só cachear o que é do mesmo domínio
  if (url.origin !== self.location.origin) return;

  // ✅ NETWORK-FIRST para a página e para o JS (evita ficar preso em JS velho)
  const isHTML = req.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname === "/" ;
  const isJS = url.pathname.endsWith("/script.js");

  if (isHTML || isJS) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // ✅ CACHE-FIRST para o resto
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => cached);
    })
  );
});

