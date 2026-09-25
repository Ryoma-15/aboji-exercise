const CACHE_NAME = "aboji-home-test-v1";
const ASSETS = [
  "./home-screen-test.html",
  "./manifest.webmanifest",
  "./app-icon-180.png",
  "./app-icon-192.png",
  "./app-icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});