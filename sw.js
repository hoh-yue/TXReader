const CACHE_NAME = "shiyue-v41";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./icons/icon.svg"];
const ASSET_URLS = new Set(ASSETS.map(path => new URL(path, self.location.href).href));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  // This reader has no remote content. Do not silently turn unrelated or
  // third-party requests into background network/cache work.
  if (requestUrl.origin !== self.location.origin) return;
  if (!ASSET_URLS.has(requestUrl.href) && event.request.mode !== "navigate") return;
  event.respondWith((async () => {
    // A navigation with a query string (for example after clearing data) may
    // not match the cached request URL. Reuse the app shell before attempting
    // any network request.
    const cached = await caches.match(event.request) ||
      (event.request.mode === "navigate" ? await caches.match("./index.html") : null);
    if (cached) return cached;

    try {
      const response = await fetch(event.request);
      if (response.ok && ASSET_URLS.has(requestUrl.href)) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)));
      }
      return response;
    } catch {
      if (event.request.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    }
  })());
});
