/**
 * Service worker for the public positron.today PWA.
 *
 * Strategy: network-first with cache fallback — users always see fresh
 * articles when online, and a previously visited page when offline.
 *
 * Bump CACHE_NAME to invalidate the offline cache after a breaking change
 * (e.g. asset path rename). The "activate" handler below then cleans up old
 * caches automatically.
 */

const CACHE_NAME = "positron-today-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Drop any caches from earlier versions of this SW.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Don't cache cross-origin requests (analytics pings, external images, etc.).
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(req);
      if (response.ok) {
        const clone = response.clone();
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, clone);
      }
      return response;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      // Offline and no cached match — last-resort fallback to the homepage
      // so the app shell doesn't appear broken.
      const shell = await caches.match("/");
      if (shell) return shell;
      throw new Error("Offline and no cached response available");
    }
  })());
});
