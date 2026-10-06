// Private Site navigation always goes through the hosted authentication gate.
// Retire caches created by previous public/offline versions.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('fret-notes-offline-')).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
