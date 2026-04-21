/**
 * Minimal service worker — required for Chrome PWA install prompt.
 * Uses a network-first strategy: always tries the network, falls back
 * to cache for previously visited pages when offline.
 *
 * Version comes from the ?v= query string on the registration URL so each
 * deploy yields a fresh CACHE_NAME and SW script URL; the activate handler
 * purges old caches, and the registration code reloads open tabs.
 */

const SW_VERSION = new URLSearchParams(self.location.search).get("v") || "dev";
const CACHE_NAME = "positron-admin-v" + SW_VERSION;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  // Only cache GET requests for pages/assets (not API calls)
  if (event.request.method !== "GET") return;
  if (event.request.url.includes("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone and cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
