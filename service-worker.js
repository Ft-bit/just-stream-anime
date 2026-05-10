self.addEventListener('fetch', (event) => {
  // Basic worker to satisfy PWA requirements
  event.respondWith(fetch(event.request));
});
