/* sw.js — Gestão Fácil */
const CACHE_VERSION = "gf-v1.0.5"; // MUDA sempre que atualizares o app

// Ajusta estes caminhos conforme o teu projeto real
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",                 // <-- troca se o teu JS tiver outro nome (ex: ./script.js)
  "./manifest.webmanifest",   // ou ./manifest.json (conforme estiver no teu projeto)
  "./icons/icon-192.png",     // corrigido (antes estava .png.png)
  "./icons/icon-512.png",     // corrigido (antes estava .png.png)
];

// INSTALL: cacheia e força a nova versão a assumir
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ACTIVATE: limpa caches antigas + toma controlo imediatamente
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

// FETCH: offline-first com atualização em background
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // só cachear o que é do mesmo domínio
  if (url.origin !== self.location.origin) return;

  // Navegação (abrir páginas)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put("./", copy));
          return res;
        })
        .catch(() => caches.match("./"))
    );
    return;
  }

  // Ficheiros (css/js/img/etc)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          // guarda no cache para próximas vezes
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => cached);
    })
  );
});
