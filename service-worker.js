'use strict';
const CACHE = 'flow-shell-v5-5.0.1-20261004';
// Activate only when the user presses the update button, then reload that tab.
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
const SHELL = ['index.html', 'styles.css', 'legal.css', 'app.js', 'flow-core.js', 'flow-backup.js', 'flow-sync-core.mjs', 'bank-import.js', 'flow-pwa.js', 'flow-cloud.js', 'firebase-config.js', 'push-config.json', 'manifest.webmanifest', 'privacy.html', 'credits.html', 'assets/icons.svg', 'assets/mobile-icon-192.png', 'assets/mobile-icon-512.png', 'assets/logo-mark.svg', 'assets/favicon.svg'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await Promise.all(SHELL.map(async path => { try { const response = await fetch(new URL(path, self.registration.scope), { cache: 'reload' }); if (response.ok) await cache.put(new URL(path, self.registration.scope), response); } catch (_) { /* Retry lazily without preventing app use. */ } }));
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('flow-shell-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  const relative = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (request.mode !== 'navigate' && !SHELL.includes(relative)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), key = new URL(relative || 'index.html', self.registration.scope);
    try { const response = await fetch(request, { cache: 'no-cache' }); if (response.ok && response.type === 'basic') await cache.put(key, response.clone()); return response; }
    catch (_) { return await cache.match(key) || (request.mode === 'navigate' ? await cache.match(new URL('index.html', self.registration.scope)) : null) || new Response('Connexion indisponible', { status: 503 }); }
  })());
});
self.addEventListener('push', event => {
  // Never display sender-provided amounts, labels, names or financial content on a lock screen.
  event.waitUntil(self.registration.showNotification('Flōw', {
    body: 'Un rappel est disponible dans ton espace. Ouvre Flōw pour le consulter.',
    icon: new URL('assets/mobile-icon-192.png', self.registration.scope).href,
    badge: new URL('assets/mobile-icon-192.png', self.registration.scope).href,
    tag: 'flow-reminder', data: { url: new URL('index.html#dashboard', self.registration.scope).href }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL('index.html#dashboard', self.registration.scope).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) { await existing.focus(); existing.postMessage({ type: 'FLOW_OPEN_NOTIFICATIONS' }); }
    else await self.clients.openWindow(target);
  })());
});
